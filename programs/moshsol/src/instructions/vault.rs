use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use super::pay_out;
use super::pump_venue::{venue_tokens, venue_view, VenueTrade};
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{VaultWithdrawn, WoundDown};
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

/// Permissionless end of a dead launch: once it has been live for `WIND_DOWN_MIN_AGE_SECS`, saw
/// no trade for `WIND_DOWN_IDLE_SECS`, and every token in existence sits in the curve or the vault
/// (checked on real balances, so burns don't block it), nobody else can be owed anything. The
/// vault's tokens return to the curve, curve + vault SOL is credited to backers pro-rata
/// (claimable with `claim_backer_fees`) and the launch stops trading for good.
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
    require!(ctx.accounts.mint.supply == held, MoshError::OutsideHolders);

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
    launch.buyback_sol = 0;
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

/// `wind_down` for a pump launch: same age and idle rules (idle = since the last agent trade
/// sampled the venue; public trades and cranks don't move `last_trade_ts` there); "nobody
/// else holds" reads the venue's own token
/// account (bonding curve ATA, or the pool's base account once graduated; the venue accounts
/// follow as remaining accounts) plus the vault. The vault's tokens are then sold into the
/// venue with no impact cap — with no outside holder nobody can front-run or be hurt by it —
/// and the proceeds plus vault SOL go to backers. The buyback pool stays for the crank.
pub fn wind_down_pump<'info>(ctx: Context<'_, '_, 'info, 'info, WindDownPump<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let r = ctx.remaining_accounts;
    {
        let launch = &ctx.accounts.launch;
        require_dead(launch, now)?;
        let view = venue_view(launch, r)?;
        require!(!view.complete, MoshError::CurveComplete);
        let in_vault = crate::pump::token_amount(&ctx.accounts.vault_tokens)?;
        let held = venue_tokens(launch, r)?
            .checked_add(in_vault)
            .ok_or(MoshError::MathOverflow)?;
        require!(ctx.accounts.mint.supply == held, MoshError::OutsideHolders);
    }

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
    let (received, sold) = if in_vault > 0 { venue.sell(in_vault, 0)? } else { (0, 0) };
    venue.settle()?;
    require!(sold == in_vault, MoshError::InsufficientLiquidity);

    let launch = &mut ctx.accounts.launch;
    let sol_to_backers = received
        .checked_add(launch.vault_sol)
        .and_then(|s| s.checked_add(venue.donated.get()))
        .ok_or(MoshError::MathOverflow)?;
    launch.vault_sol = 0;
    launch.vault_tokens = 0;
    launch.vault_cost_sol = 0;
    launch.buyback_sol = 0;
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
/// token account the fee recipient owns. The withdrawn tokens take their pro-rata share of the
/// cost basis with them, so the average cost of what stays is unchanged. Works on both venues.
pub fn admin_withdraw_vault(ctx: Context<AdminWithdrawVault>, sol: u64, tokens: u64) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    let launch_key = launch.key();
    require!(sol > 0 || tokens > 0, MoshError::ZeroAmount);
    require!(
        sol <= launch.vault_sol && tokens <= launch.vault_tokens,
        MoshError::InsufficientVault
    );

    if tokens > 0 {
        launch.vault_cost_sol -= launch.vault_cost_of(tokens);
        launch.vault_tokens -= tokens;
        let authority = ctx.accounts.token_authority.to_account_info();
        let bump = [launch.bump];
        let pump_bump = [launch.pump.authority_bump];
        let seeds: &[&[u8]] = match launch.venue {
            Venue::Holdfast => {
                require_keys_eq!(authority.key(), launch_key, MoshError::InvalidVenueAccount);
                &[LAUNCH_SEED, launch.create_key.as_ref(), &bump]
            }
            Venue::Pump => {
                require_keys_eq!(authority.key(), launch.pump_authority(&launch_key), MoshError::InvalidVenueAccount);
                &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &pump_bump]
            }
        };
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_tokens.to_account_info(),
                    authority,
                },
                &[seeds],
            ),
            tokens,
            TOKEN_DECIMALS,
        )?;
    }
    if sol > 0 {
        launch.vault_sol -= sol;
        // The buy-back budget is part of vault SOL; it can't outlive it.
        launch.buyback_sol = launch.buyback_sol.min(launch.vault_sol);
        pay_out(
            &launch.to_account_info(),
            &ctx.accounts.fee_recipient.to_account_info(),
            sol,
        )?;
    }

    emit!(VaultWithdrawn {
        launch: launch_key,
        mint: ctx.accounts.mint.key(),
        sol,
        tokens,
        recipient: ctx.accounts.fee_recipient.key(),
        recipient_tokens: ctx.accounts.recipient_tokens.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
