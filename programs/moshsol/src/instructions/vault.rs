use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use super::pay_out;
use super::pump_venue::{venue_tokens, venue_view, VenueTrade};
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{BackersPaid, VaultWithdrawn, VaultWithdrawnByDev, WoundDown};
use crate::math;
use crate::state::{Launch, LaunchStatus, Platform, Venue};

#[derive(Accounts)]
pub struct WindDown<'info> {
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump = launch.bump,
        has_one = mint,
        constraint = launch.venue == Venue::Holdfast @ MoshError::WrongVenue
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [CURVE_SEED, launch.key().as_ref()], bump = launch.curve_bump)]
    pub curve_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
}

fn require_dead(launch: &Launch, now: i64) -> Result<()> {
    require!(launch.status == LaunchStatus::Live, MoshError::NotLive);
    require!(
        now >= launch.launched_at.saturating_add(WIND_DOWN_MIN_AGE_SECS),
        MoshError::LaunchTooYoung
    );
    require!(
        now >= launch.last_trade_ts.saturating_add(WIND_DOWN_IDLE_SECS),
        MoshError::RecentTrade
    );
    Ok(())
}

/// Tokens outside the venue and the vault (`supply − held`; burned tokens aren't in the
/// supply) may be at most `dead_holders_bps` of the supply.
fn require_few_outside_holders(launch: &Launch, supply: u64, held: u64) -> Result<()> {
    let outside = supply.checked_sub(held).ok_or(MoshError::MathOverflow)?;
    require!(
        outside <= math::bps(supply, launch.terms.dead_holders_bps)?,
        MoshError::OutsideHolders
    );
    Ok(())
}

/// Permissionless end of a dead launch: once it has been live for `WIND_DOWN_MIN_AGE_SECS`, saw
/// no trade for `WIND_DOWN_IDLE_SECS`, and at most `dead_holders_bps` of the supply sits outside
/// the curve and the vault (checked on real balances, so burns don't block it). The vault's
/// tokens return to the curve, curve + vault SOL is credited to backers pro-rata (claimable
/// with `claim_backer_fees`) and the launch stops trading for good.
pub fn wind_down(ctx: Context<WindDown>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    require_dead(launch, now)?;
    let returned = ctx.accounts.vault_tokens.amount;
    let held = ctx
        .accounts
        .curve_tokens
        .amount
        .checked_add(returned)
        .ok_or(MoshError::MathOverflow)?;
    require_few_outside_holders(launch, ctx.accounts.mint.supply, held)?;

    let sol_to_backers = launch
        .real_sol
        .checked_add(launch.vault_sol)
        .ok_or(MoshError::MathOverflow)?;
    launch.token_reserve = launch
        .token_reserve
        .checked_add(returned)
        .ok_or(MoshError::MathOverflow)?;
    launch.real_sol = 0;
    launch.vault_sol = 0;
    launch.vault_tokens = 0;
    launch.vault_cost_sol = 0;
    launch.credit_backers(sol_to_backers)?;
    launch.status = LaunchStatus::WoundDown;

    if returned > 0 {
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.curve_tokens.to_account_info(),
                    authority: launch.to_account_info(),
                },
                &[seeds],
            ),
            returned,
            TOKEN_DECIMALS,
        )?;
    }

    emit!(WoundDown {
        launch: launch.key(),
        mint: ctx.accounts.mint.key(),
        sol_to_backers,
        tokens_returned: returned,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WindDownPump<'info> {
    /// Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction).
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        has_one = mint,
        constraint = launch.venue == Venue::Pump @ MoshError::WrongVenue
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: system-owned PDA, the venue `user`
    #[account(mut, seeds = [PUMP_AUTHORITY_SEED, launch.key().as_ref()], bump = launch.pump.authority_bump)]
    pub pump_authority: UncheckedAccount<'info>,
    /// CHECK: ATA(pump_authority, mint), the vault's token account
    #[account(mut, address = get_associated_token_address(&pump_authority.key(), &mint.key()))]
    pub vault_tokens: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// `wind_down` for a pump launch: same age, idle and outside-holder rules (idle = since the
/// last agent trade sampled the venue; public trades and cranks don't move `last_trade_ts`
/// there; "held" reads the venue's own token account — bonding curve ATA, or the pool's base
/// account once graduated; the venue accounts follow as remaining accounts — plus the vault).
/// The vault's tokens are then sold into the venue with no impact cap and the proceeds plus
/// vault SOL go to backers. The sale is floored at `BUYBACK_MIN_FILL_BPS` of the fee-free
/// constant-product quote from the reserves as they are (forwarded to the venue as its slippage
/// floor and re-checked on the measured fill): a fill short of it fails the instruction, which
/// anyone can retry. The reference is in-transaction, so what it rules out is the venue taking
/// more than the venue fee; a pre-sell in the same bundle is already bounded by the
/// outside-holder cap. The buyback pool stays for the crank.
pub fn wind_down_pump<'info>(ctx: Context<'_, '_, 'info, 'info, WindDownPump<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let r = ctx.remaining_accounts;
    let floor = {
        let launch = &ctx.accounts.launch;
        require_dead(launch, now)?;
        let view = venue_view(launch, r)?;
        require!(!view.complete, MoshError::CurveComplete);
        let in_vault = crate::pump::token_amount(&ctx.accounts.vault_tokens)?;
        let held = venue_tokens(launch, r)?
            .checked_add(in_vault)
            .ok_or(MoshError::MathOverflow)?;
        require_few_outside_holders(launch, ctx.accounts.mint.supply, held)?;
        let quote = math::sol_out(view.quote_reserve, view.base_reserve, in_vault)?;
        math::bps(quote, BUYBACK_MIN_FILL_BPS)?
    };

    let launch_info = ctx.accounts.launch.to_account_info();
    let authority = ctx.accounts.pump_authority.to_account_info();
    let mint_info = ctx.accounts.mint.to_account_info();
    let vault_info = ctx.accounts.vault_tokens.to_account_info();
    let cranker_info = ctx.accounts.cranker.to_account_info();
    let token_program = ctx.accounts.token_program.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let bump = [ctx.accounts.launch.pump.authority_bump];
    let seeds: &[&[u8]] = &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &bump];
    let venue = VenueTrade {
        launch: &launch_info,
        authority: &authority,
        authority_seeds: seeds,
        mint: &mint_info,
        user_tokens: &vault_info,
        payer: &cranker_info,
        token_program: &token_program,
        system_program: &system_program,
        graduated: ctx.accounts.launch.pump.graduated,
        remaining: r,
        rent_owed: std::cell::Cell::new(0),
        donated: std::cell::Cell::new(0),
    };
    // Sweep the authority even with nothing to sell, so it ends empty.
    venue.absorb()?;
    let in_vault = crate::pump::token_amount(&vault_info)?;
    let (received, sold) = if in_vault > 0 { venue.sell(in_vault, floor)? } else { (0, 0) };
    venue.settle()?;
    require!(sold == in_vault, MoshError::InsufficientLiquidity);
    require!(received >= floor, MoshError::Slippage);

    let launch = &mut ctx.accounts.launch;
    let sol_to_backers = received
        .checked_add(launch.vault_sol)
        .and_then(|s| s.checked_add(venue.donated.get()))
        .ok_or(MoshError::MathOverflow)?;
    launch.vault_sol = 0;
    launch.vault_tokens = 0;
    launch.vault_cost_sol = 0;
    launch.credit_backers(sol_to_backers)?;
    launch.status = LaunchStatus::WoundDown;
    launch.last_trade_ts = now;
    launch.record_volume(received);

    emit!(WoundDown {
        launch: launch_key,
        mint: ctx.accounts.mint.key(),
        sol_to_backers,
        tokens_returned: sold,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AdminWithdrawVault<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [PLATFORM_SEED], bump = platform.bump, has_one = admin @ MoshError::Unauthorized)]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        has_one = mint
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// The vault's token account: the program PDA (Holdfast) or the pump authority's ATA.
    #[account(mut, address = launch.vault_token_account(&launch.key()) @ MoshError::InvalidVenueAccount)]
    pub vault_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal platform.fee_recipient
    #[account(mut, address = platform.fee_recipient @ MoshError::Unauthorized)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = fee_recipient,
        token::token_program = token_program,
    )]
    pub recipient_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the token transfer authority: the launch itself (Holdfast) or its pump authority
    /// PDA (pump launches); verified in the handler against the venue.
    pub token_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Platform admin (the multisig) withdraws vault SOL to the fee recipient and vault tokens to a
/// token account the fee recipient owns. See `withdraw_vault`.
pub fn admin_withdraw_vault(ctx: Context<AdminWithdrawVault>, sol: u64, tokens: u64) -> Result<()> {
    let a = ctx.accounts;
    withdraw_vault(
        &mut a.launch,
        &a.mint,
        &a.vault_tokens,
        &a.fee_recipient,
        &a.recipient_tokens,
        &a.token_authority,
        &a.token_program,
        sol,
        tokens,
    )?;
    emit!(VaultWithdrawn {
        launch: a.launch.key(),
        mint: a.mint.key(),
        sol,
        tokens,
        recipient: a.fee_recipient.key(),
        recipient_tokens: a.recipient_tokens.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DevWithdrawVault<'info> {
    /// The platform's dev key; receives the SOL.
    #[account(mut)]
    pub dev: Signer<'info>,
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        constraint = platform.dev_authority != Pubkey::default() @ MoshError::DevKeyDisabled,
        constraint = platform.dev_authority == dev.key() @ MoshError::Unauthorized
    )]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        has_one = mint
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// The vault's token account: the program PDA (Holdfast) or the pump authority's ATA.
    #[account(mut, address = launch.vault_token_account(&launch.key()) @ MoshError::InvalidVenueAccount)]
    pub vault_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Any token account of the dev key for the mint (it must exist: the caller creates its ATA
    /// idempotently in the same transaction).
    #[account(
        mut,
        token::mint = mint,
        token::authority = dev,
        token::token_program = token_program,
    )]
    pub recipient_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the token transfer authority: the launch itself (Holdfast) or its pump authority
    /// PDA (pump launches); verified in `withdraw_vault` against the venue.
    pub token_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// The emergency path: the platform's dev key (`platform.dev_authority`, set by the admin)
/// withdraws vault SOL to itself and vault tokens to its own token account, without the
/// multisig and regardless of `paused` / `agents_paused`. Same accounting as
/// `admin_withdraw_vault` (see `withdraw_vault`); emits `VaultWithdrawnByDev`.
pub fn dev_withdraw_vault(ctx: Context<DevWithdrawVault>, sol: u64, tokens: u64) -> Result<()> {
    let a = ctx.accounts;
    withdraw_vault(
        &mut a.launch,
        &a.mint,
        &a.vault_tokens,
        &a.dev,
        &a.recipient_tokens,
        &a.token_authority,
        &a.token_program,
        sol,
        tokens,
    )?;
    emit!(VaultWithdrawnByDev {
        launch: a.launch.key(),
        mint: a.mint.key(),
        sol,
        tokens,
        by: a.dev.key(),
        recipient_tokens: a.recipient_tokens.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

/// Moves `sol` of vault SOL to `recipient` and `tokens` of vault tokens to `recipient_tokens`.
/// Only the vault's own balances move: curve liquidity, backer accruals and the buyback pool are
/// untouched. The withdrawn tokens take their pro-rata share of the cost basis with them, so the
/// average cost of what stays is unchanged. Works on both venues.
#[allow(clippy::too_many_arguments)]
fn withdraw_vault<'info>(
    launch: &mut Account<'info, Launch>,
    mint: &InterfaceAccount<'info, Mint>,
    vault_tokens: &InterfaceAccount<'info, TokenAccount>,
    recipient: &AccountInfo<'info>,
    recipient_tokens: &InterfaceAccount<'info, TokenAccount>,
    token_authority: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    sol: u64,
    tokens: u64,
) -> Result<()> {
    let launch_key = launch.key();
    require!(sol > 0 || tokens > 0, MoshError::ZeroAmount);
    require!(
        sol <= launch.vault_sol && tokens <= launch.vault_tokens,
        MoshError::InsufficientVault
    );

    if tokens > 0 {
        launch.vault_cost_sol -= launch.vault_cost_of(tokens);
        launch.vault_tokens -= tokens;
        let bump = [launch.bump];
        let pump_bump = [launch.pump.authority_bump];
        let seeds: &[&[u8]] = match launch.venue {
            Venue::Holdfast => {
                require_keys_eq!(token_authority.key(), launch_key, MoshError::InvalidVenueAccount);
                &[LAUNCH_SEED, launch.create_key.as_ref(), &bump]
            }
            Venue::Pump => {
                require_keys_eq!(token_authority.key(), launch.pump_authority(&launch_key), MoshError::InvalidVenueAccount);
                &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &pump_bump]
            }
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                TransferChecked {
                    from: vault_tokens.to_account_info(),
                    mint: mint.to_account_info(),
                    to: recipient_tokens.to_account_info(),
                    authority: token_authority.clone(),
                },
                &[seeds],
            ),
            tokens,
            TOKEN_DECIMALS,
        )?;
    }
    if sol > 0 {
        launch.vault_sol -= sol;
        pay_out(&launch.to_account_info(), recipient, sol)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct PayoutBackers<'info> {
    pub agent: Signer<'info>,
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        constraint = platform.agent_authority == agent.key() @ MoshError::Unauthorized
    )]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        constraint = launch.status == LaunchStatus::Live @ MoshError::NotLive,
    )]
    pub launch: Box<Account<'info, Launch>>,
}

/// Backer payback, cranked by the agent authority (so nobody can force a payout while the
/// vault should be buying a dip; paused with the agent by `agents_paused`) and bounded
/// on-chain: at most once per `payout_interval_secs` (the clock starts at launch), only while
/// liquid vault SOL is at least `payout_mult_bps` × `initial_vault_sol`, never below
/// `min_vault_sol`. The first payout repays the principal (`initial_vault_sol`) in full, every
/// later one is `payout_share_bps` of vault SOL. The amount is credited to backers pro-rata
/// through the fee accumulator (`claim_backer_fees`).
pub fn payout_backers(ctx: Context<PayoutBackers>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.platform.params.agents_paused, MoshError::AgentsPaused);
    let launch = &mut ctx.accounts.launch;
    let terms = launch.terms;
    require!(
        now >= launch.last_payout_ts.saturating_add(terms.payout_interval_secs as i64)
            && launch.vault_sol >= launch.payout_target()?,
        MoshError::PayoutNotDue
    );
    let principal = launch.backers_repaid < launch.initial_vault_sol;
    let amount = if principal {
        launch.initial_vault_sol - launch.backers_repaid
    } else {
        math::bps(launch.vault_sol, terms.payout_share_bps)?
    };
    require!(amount > 0, MoshError::ZeroAmount);
    launch.pay_backers_from_vault(amount)?;
    if principal {
        launch.backers_repaid = launch.initial_vault_sol;
    } else {
        launch.backer_payouts = launch.backer_payouts.checked_add(amount).ok_or(MoshError::MathOverflow)?;
    }
    launch.last_payout_ts = now;
    emit!(BackersPaid {
        launch: launch.key(),
        mint: launch.mint,
        kind: if principal { 0 } else { 1 },
        amount,
        vault_sol_after: launch.vault_sol,
        timestamp: now,
    });
    Ok(())
}
