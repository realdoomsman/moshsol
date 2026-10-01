use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::MoshError;
use crate::events::Launched;
use crate::math;
use crate::state::{Launch, LaunchStatus, Venue};

#[derive(Accounts)]
pub struct LaunchToken<'info> {
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

/// Opens trading. The bundle buy executes here, before any other trade is possible, so the
/// bundle always gets the first slice of the curve and nobody can snipe ahead of it.
///
/// Who may call:
/// - the creator, any time the minimum is met;
/// - anyone, once the minimum is met and either the deadline passed or the raise is full.
pub fn launch(ctx: Context<LaunchToken>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;

    require!(launch.status == LaunchStatus::Raising, MoshError::NotRaising);
    require!(launch.raised >= launch.raise_min, MoshError::MinimumNotReached);
    let is_creator = ctx.accounts.cranker.key() == launch.creator;
    let ready = now >= launch.raise_deadline || launch.raised >= launch.raise_max;
    require!(is_creator || ready, MoshError::RaiseStillOpen);

    let launch_fee = math::bps(launch.raised, launch.terms.launch_fee_bps)?;
    let net = launch.raised - launch_fee;
    let budget = net - math::bps(net, launch.reserve_bps)?;
    let cap = math::bps(TOTAL_SUPPLY, launch.bundle_supply_bps)?;

    let x = launch.curve_sol();
    let y = launch.token_reserve;
    let mut tokens = math::tokens_out(x, y, budget)?;
    let mut spent = budget;
    if tokens > cap {
        tokens = cap;
        spent = math::sol_in_for_tokens(x, y, cap)?.min(budget);
    }
    require!(tokens > 0, MoshError::InsufficientLiquidity);

    launch.apply_buy(spent, tokens)?;
    launch.status = LaunchStatus::Live;
    launch.launched_at = now;
    launch.platform_fees_unclaimed += launch_fee;
    launch.vault_sol = net - spent;
    launch.vault_tokens = tokens;
    launch.bundle_sol = spent;
    launch.bundle_tokens = tokens;
    launch.vault_cost_sol = spent;
    launch.record_volume(spent);

    let price = launch.price_q64()?;
    launch.ema_price = price;
    launch.last_trade_ts = now;
    launch.window_start = i64::MIN / 2; // force a fresh window
    launch.roll_window(now)?;

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.curve_tokens.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_tokens.to_account_info(),
                authority: launch.to_account_info(),
            },
            &[seeds],
        ),
        tokens,
        TOKEN_DECIMALS,
    )?;

    emit!(Launched {
        launch: launch.key(),
        mint: mint_key,
        raised: launch.raised,
        launch_fee,
        bundle_sol: spent,
        bundle_tokens: tokens,
        vault_sol: launch.vault_sol,
        price_q64: price,
        timestamp: now,
    });
    Ok(())
}
