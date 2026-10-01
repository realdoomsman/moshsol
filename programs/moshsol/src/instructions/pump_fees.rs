use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;
use anchor_spl::associated_token::{self, get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, Burn, CloseAccount, Token};

use super::pay_out;
use super::pump_venue::VenueTrade;
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{BuybackBurned, CreatorFeesCollected};
use crate::math;
use crate::pump::{self, BondingCurve, Pool};
use crate::state::{Launch, LaunchStatus, Platform, Venue};

/// Accounts for the PumpSwap leg of `collect_pump_fees` (remaining accounts, once graduated).
pub mod collect_pool {
    pub const WSOL_MINT: usize = 0;
    pub const COIN_CREATOR_VAULT_AUTHORITY: usize = 1;
    pub const COIN_CREATOR_VAULT_ATA: usize = 2;
    /// WSOL ATA of the launch PDA; created and closed inside the instruction.
    pub const LAUNCH_WSOL: usize = 3;
    pub const EVENT_AUTHORITY: usize = 4;
    pub const PROGRAM: usize = 5;
    pub const ASSOCIATED_TOKEN_PROGRAM: usize = 6;
    pub const LEN: usize = 7;
}

#[derive(Accounts)]
pub struct CollectPumpFees<'info> {
    /// Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction).
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        constraint = launch.venue == Venue::Pump @ MoshError::WrongVenue,
        constraint = launch.status == LaunchStatus::Live || launch.status == LaunchStatus::WoundDown @ MoshError::NotLive,
    )]
    pub launch: Box<Account<'info, Launch>>,
    /// CHECK: pump.fun `[creator-vault, launch]`; pump.fun validates it
    #[account(mut)]
    pub creator_vault: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[__event_authority]`
    pub pump_event_authority: UncheckedAccount<'info>,
    /// CHECK: the pump.fun program
    #[account(address = pump::PUMP_PROGRAM_ID @ MoshError::InvalidVenueAccount)]
    pub pump_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Permissionless: sweeps the creator fees pump.fun (and PumpSwap, once graduated — then the
/// `collect_pool` accounts follow as remaining accounts) accrued to the launch, which is the
/// token's creator, and splits them by the launch's terms: `creator_fee_vault_bps` to vault
/// SOL (to backers once the launch is wound down), `burn_share_bps` to the buyback pool, the
/// rest to backers. Being permissionless it never samples the EMA (see
/// `Launch::update_ema_with`).
pub fn collect_pump_fees<'info>(ctx: Context<'_, '_, 'info, 'info, CollectPumpFees<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let launch_info = ctx.accounts.launch.to_account_info();
    let before = launch_info.lamports();

    // Bonding-curve fees: `collect_creator_fee` moves everything above the vault's rent
    // reserve to the creator. Skipped when there is nothing, so the pool leg can still run.
    let reserve = Rent::get()?.minimum_balance(0);
    if ctx.accounts.creator_vault.lamports() > reserve {
        let ix = Instruction {
            program_id: pump::PUMP_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(launch_key, false),
                AccountMeta::new(ctx.accounts.creator_vault.key(), false),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(ctx.accounts.pump_event_authority.key(), false),
                AccountMeta::new_readonly(ctx.accounts.pump_program.key(), false),
            ],
            data: pump::collect_creator_fee_data(),
        };
        invoke(
            &ix,
            &[
                launch_info.clone(),
                ctx.accounts.creator_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.pump_event_authority.to_account_info(),
                ctx.accounts.pump_program.to_account_info(),
            ],
        )?;
    }

    if ctx.accounts.launch.pump.graduated {
        let r = ctx.remaining_accounts;
        require!(r.len() >= collect_pool::LEN, MoshError::InvalidVenueAccount);
        require_keys_eq!(r[collect_pool::PROGRAM].key(), pump::PUMP_AMM_PROGRAM_ID, MoshError::InvalidVenueAccount);
        require_keys_eq!(r[collect_pool::WSOL_MINT].key(), pump::WSOL_MINT, MoshError::InvalidVenueAccount);

        if pump::token_amount(&r[collect_pool::COIN_CREATOR_VAULT_ATA])? > 0 {
            let wsol = &r[collect_pool::LAUNCH_WSOL];
            require_keys_eq!(
                wsol.key(),
                get_associated_token_address(&launch_key, &pump::WSOL_MINT),
                MoshError::InvalidVenueAccount
            );
            // Existence by owner and size, not balance (anyone can send lamports to the
            // address); what the cranker fronts is measured and returned after the close.
            let mut fronted = 0;
            if !pump::is_token_account(wsol) {
                require_keys_eq!(
                    r[collect_pool::ASSOCIATED_TOKEN_PROGRAM].key(),
                    associated_token::ID,
                    MoshError::InvalidVenueAccount
                );
                let cranker_before = ctx.accounts.cranker.lamports();
                associated_token::create_idempotent(CpiContext::new(
                    r[collect_pool::ASSOCIATED_TOKEN_PROGRAM].clone(),
                    associated_token::Create {
                        payer: ctx.accounts.cranker.to_account_info(),
                        associated_token: wsol.clone(),
                        authority: launch_info.clone(),
                        mint: r[collect_pool::WSOL_MINT].clone(),
                        system_program: ctx.accounts.system_program.to_account_info(),
                        token_program: ctx.accounts.token_program.to_account_info(),
                    },
                ))?;
                fronted = cranker_before - ctx.accounts.cranker.lamports();
            }
            let ix = Instruction {
                program_id: pump::PUMP_AMM_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new_readonly(r[collect_pool::WSOL_MINT].key(), false),
                    AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
                    AccountMeta::new_readonly(launch_key, false),
                    AccountMeta::new_readonly(r[collect_pool::COIN_CREATOR_VAULT_AUTHORITY].key(), false),
                    AccountMeta::new(r[collect_pool::COIN_CREATOR_VAULT_ATA].key(), false),
                    AccountMeta::new(wsol.key(), false),
                    AccountMeta::new_readonly(r[collect_pool::EVENT_AUTHORITY].key(), false),
                    AccountMeta::new_readonly(r[collect_pool::PROGRAM].key(), false),
                ],
                data: pump::amm_collect_coin_creator_fee_data(),
            };
            invoke(
                &ix,
                &[
                    r[collect_pool::WSOL_MINT].clone(),
                    ctx.accounts.token_program.to_account_info(),
                    launch_info.clone(),
                    r[collect_pool::COIN_CREATOR_VAULT_AUTHORITY].clone(),
                    r[collect_pool::COIN_CREATOR_VAULT_ATA].clone(),
                    wsol.clone(),
                    r[collect_pool::EVENT_AUTHORITY].clone(),
                    r[collect_pool::PROGRAM].clone(),
                ],
            )?;
            let launch_seeds: &[&[u8]] = &[
                LAUNCH_SEED,
                ctx.accounts.launch.create_key.as_ref(),
                &[ctx.accounts.launch.bump],
            ];
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: wsol.clone(),
                    destination: launch_info.clone(),
                    authority: launch_info.clone(),
                },
                &[launch_seeds],
            ))?;
            if fronted > 0 {
                pay_out(&launch_info, &ctx.accounts.cranker.to_account_info(), fronted)?;
            }
        }
    }

    let amount = launch_info.lamports() - before;
    require!(amount > 0, MoshError::NothingToClaim);
    let launch = &mut ctx.accounts.launch;
    let (to_pool, to_vault, to_backers) = launch.credit_creator_fees(amount)?;
    launch.creator_fees_collected = launch.creator_fees_collected.saturating_add(amount);
    emit!(CreatorFeesCollected {
        launch: launch_key,
        mint: launch.mint,
        amount,
        to_buyback_pool: to_pool,
        to_vault,
        to_backers,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct BuybackBurn<'info> {
    /// The platform's agent authority: it sizes and times the buyback and prices the floor
    /// off-chain. Pays the launch's token account for the buyback mint once; fronts WSOL rent
    /// on PumpSwap.
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        constraint = platform.agent_authority == cranker.key() @ MoshError::Unauthorized
    )]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        constraint = launch.venue == Venue::Pump @ MoshError::WrongVenue,
        constraint = launch.status == LaunchStatus::Live || launch.status == LaunchStatus::WoundDown @ MoshError::NotLive,
    )]
    pub launch: Box<Account<'info, Launch>>,
    /// CHECK: system-owned PDA, the venue `user`
    #[account(mut, seeds = [PUMP_AUTHORITY_SEED, launch.key().as_ref()], bump = launch.pump.authority_bump)]
    pub pump_authority: UncheckedAccount<'info>,
    /// CHECK: must be the platform's buyback mint (the burn changes its supply); the handler
    /// refuses the unset default
    #[account(mut, address = platform.params.buyback_mint @ MoshError::BuybackMintUnset)]
    pub buyback_mint: UncheckedAccount<'info>,
    /// CHECK: ATA(pump_authority, buyback_mint); created on first use, the cranker paying
    #[account(mut, address = get_associated_token_address(&pump_authority.key(), &buyback_mint.key()))]
    pub burn_tokens: UncheckedAccount<'info>,
    /// CHECK: the buyback mint's pump.fun bonding curve; its `complete` flag picks the venue
    #[account(address = pump::bonding_curve_pda(&buyback_mint.key()) @ MoshError::InvalidVenueAccount)]
    pub buyback_curve: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Agent-authority crank (paused with the agent by `agents_paused`): spends up to `max_sol` of
/// the launch's buyback pool on the Holdfast token — on its pump.fun curve while that is open,
/// on its PumpSwap pool after (the venue accounts follow as remaining accounts in the matching
/// layout) — and burns what it bought. Guards: platform must have a buyback mint; at least
/// `MIN_BUYBACK_LAMPORTS`; at most `BUYBACK_MAX_VENUE_BPS` of the venue's quote reserves per
/// call; one call per `BUYBACK_MIN_INTERVAL_SECS` per launch; the fill must reach both
/// `min_tokens_out` (the caller's floor, priced off a reference nobody can move inside this
/// transaction — the venue's own reserves can be, which is why the crank is not permissionless)
/// and `BUYBACK_MIN_FILL_BPS` of the fee-free quote from the reserves as they are.
pub fn buyback_burn<'info>(
    ctx: Context<'_, '_, 'info, 'info, BuybackBurn<'info>>,
    max_sol: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let r = ctx.remaining_accounts;
    require!(!ctx.accounts.platform.params.agents_paused, MoshError::AgentsPaused);
    require_keys_neq!(ctx.accounts.buyback_mint.key(), Pubkey::default(), MoshError::BuybackMintUnset);
    require!(
        now >= ctx.accounts.launch.last_buyback_ts.saturating_add(BUYBACK_MIN_INTERVAL_SECS),
        MoshError::BuybackThrottled
    );

    let curve = BondingCurve::load(&ctx.accounts.buyback_curve)?;
    let graduated = curve.complete;
    let (quote_reserve, base_reserve) = if graduated {
        require!(r.len() >= pump::pool::LEN, MoshError::InvalidVenueAccount);
        require_keys_eq!(
            r[pump::pool::POOL].key(),
            pump::pool_pda(&ctx.accounts.buyback_mint.key()),
            MoshError::InvalidVenueAccount
        );
        let pool = Pool::load(&r[pump::pool::POOL])?;
        require!(
            pool.pool_base_token_account == r[pump::pool::POOL_BASE].key()
                && pool.pool_quote_token_account == r[pump::pool::POOL_QUOTE].key()
                && r[pump::pool::WSOL_MINT].key() == pump::WSOL_MINT,
            MoshError::InvalidVenueAccount
        );
        (
            pump::token_amount(&r[pump::pool::POOL_QUOTE])?,
            pump::token_amount(&r[pump::pool::POOL_BASE])?,
        )
    } else {
        require!(r.len() >= pump::curve::LEN, MoshError::InvalidVenueAccount);
        require_keys_eq!(
            r[pump::curve::BONDING_CURVE].key(),
            ctx.accounts.buyback_curve.key(),
            MoshError::InvalidVenueAccount
        );
        (curve.virtual_quote_reserves, curve.virtual_token_reserves)
    };

    let cap = math::bps(quote_reserve, BUYBACK_MAX_VENUE_BPS)?;
    let amount = ctx.accounts.launch.buyback_pool_sol.min(max_sol).min(cap);
    require!(amount >= MIN_BUYBACK_LAMPORTS, MoshError::BuybackThrottled);
    let quote = math::tokens_out(quote_reserve, base_reserve, amount)?;
    let floor = math::bps(quote, BUYBACK_MIN_FILL_BPS)?;

    let launch_info = ctx.accounts.launch.to_account_info();
    let authority = ctx.accounts.pump_authority.to_account_info();
    let mint_info = ctx.accounts.buyback_mint.to_account_info();
    let burn_info = ctx.accounts.burn_tokens.to_account_info();
    let cranker_info = ctx.accounts.cranker.to_account_info();
    let token_program = ctx.accounts.token_program.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let bump = [ctx.accounts.launch.pump.authority_bump];
    let seeds: &[&[u8]] = &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &bump];
    // Existence by owner and size, never by balance (anyone can send lamports to the address).
    if !pump::is_token_account(&burn_info) {
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: cranker_info.clone(),
                associated_token: burn_info.clone(),
                authority: authority.clone(),
                mint: mint_info.clone(),
                system_program: system_program.clone(),
                token_program: token_program.clone(),
            },
        ))?;
    }
    let venue = VenueTrade {
        launch: &launch_info,
        authority: &authority,
        authority_seeds: seeds,
        mint: &mint_info,
        user_tokens: &burn_info,
        payer: &cranker_info,
        token_program: &token_program,
        system_program: &system_program,
        graduated,
        remaining: r,
        rent_owed: std::cell::Cell::new(0),
        donated: std::cell::Cell::new(0),
    };
    // The venue gets the program's floor; the caller's is checked on the measured fill.
    let (spent, tokens) = venue.buy(amount, floor)?;
    require!(tokens >= floor && tokens >= min_tokens_out && tokens > 0, MoshError::Slippage);

    // Burn everything the account holds, including anything donated to it.
    let burned = pump::token_amount(&burn_info)?;
    token::burn(
        CpiContext::new_with_signer(
            token_program.clone(),
            Burn { mint: mint_info.clone(), from: burn_info.clone(), authority: authority.clone() },
            &[seeds],
        ),
        burned,
    )?;
    venue.settle()?;

    let launch = &mut ctx.accounts.launch;
    launch.buyback_pool_sol -= spent;
    launch.credit_vault(venue.donated.get())?;
    launch.burned_sol = launch.burned_sol.saturating_add(spent);
    launch.burned_tokens = launch.burned_tokens.saturating_add(burned);
    launch.last_buyback_ts = now;
    emit!(BuybackBurned {
        launch: launch_key,
        buyback_mint: ctx.accounts.buyback_mint.key(),
        sol: spent,
        tokens: burned,
        buyback_pool_sol: launch.buyback_pool_sol,
        timestamp: now,
    });
    Ok(())
}
