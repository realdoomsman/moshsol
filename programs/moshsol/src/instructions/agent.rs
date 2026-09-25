use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::MoshError;
use crate::events::Trade;
use crate::math;
use crate::state::{Launch, LaunchStatus, Platform};

/// Agents can only move value between the launch's own curve and its own locked vault.
/// No account outside the launch can receive anything from these instructions.
#[derive(Accounts)]
pub struct AgentTrade<'info> {
    pub agent: Signer<'info>,
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        constraint = platform.agent_authority == agent.key() @ MoshError::Unauthorized
    )]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump = launch.bump,
        has_one = mint
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [CURVE_SEED, launch.key().as_ref()], bump = launch.curve_bump)]
    pub curve_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
}

fn prelude(launch: &mut Launch, platform: &Platform, now: i64) -> Result<()> {
    require!(!platform.params.agents_paused, MoshError::AgentsPaused);
    require!(launch.status == LaunchStatus::Live, MoshError::NotLive);
    launch.roll_window(now, &platform.params)?;
    launch.update_ema(now, platform.params.ema_period_secs)
}

/// Buy with vault SOL — only on dips (price at least `band` under the EMA).
pub fn agent_buy(ctx: Context<AgentTrade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
    let params = ctx.accounts.platform.params;
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    prelude(launch, &ctx.accounts.platform, now)?;
    require!(sol_in > 0, MoshError::ZeroAmount);
    require!(sol_in <= launch.vault_sol, MoshError::InsufficientVault);
    require!(
        launch.window_sol_spent + sol_in <= launch.window_buy_cap,
        MoshError::AgentWindowLimit
    );

    let before = launch.price_q64()?;
    let ceiling = launch.ema_price / BPS as u128 * (BPS - params.agent_band_bps as u64) as u128;
    require!(before <= ceiling, MoshError::AgentBuyNotDip);

    let tokens = math::tokens_out(launch.curve_sol(), launch.token_reserve, sol_in)?;
    require!(tokens > 0, MoshError::ZeroAmount);
    require!(tokens < launch.token_reserve, MoshError::InsufficientLiquidity);
    require!(tokens >= min_tokens_out, MoshError::Slippage);

    launch.apply_buy(sol_in, tokens)?;
    launch.vault_sol -= sol_in;
    launch.vault_tokens += tokens;
    let after = launch.price_q64()?;
    require!(
        math::move_bps(before, after) <= params.agent_max_impact_bps as u64,
        MoshError::AgentPriceImpact
    );

    launch.window_sol_spent += sol_in;
    launch.agent_buys = launch.agent_buys.saturating_add(1);
    launch.agent_sol_spent = launch.agent_sol_spent.saturating_add(sol_in);
    launch.record_volume(sol_in);

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

    emit!(Trade {
        launch: launch.key(),
        mint: mint_key,
        trader: ctx.accounts.agent.key(),
        is_buy: true,
        is_agent: true,
        sol_amount: sol_in,
        token_amount: tokens,
        fee: 0,
        price_q64: after,
        ema_q64: launch.ema_price,
        real_sol: launch.real_sol,
        token_reserve: launch.token_reserve,
        vault_sol: launch.vault_sol,
        vault_tokens: launch.vault_tokens,
        timestamp: now,
    });
    Ok(())
}

/// Sell vault tokens — only into rallies (price at least `band` over the EMA).
pub fn agent_sell(ctx: Context<AgentTrade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
    let params = ctx.accounts.platform.params;
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    prelude(launch, &ctx.accounts.platform, now)?;
    require!(tokens_in > 0, MoshError::ZeroAmount);
    require!(tokens_in <= launch.vault_tokens, MoshError::InsufficientVault);
    require!(
        launch.window_tokens_sold + tokens_in <= launch.window_sell_cap,
        MoshError::AgentWindowLimit
    );

    let before = launch.price_q64()?;
    let floor = launch.ema_price / BPS as u128 * (BPS + params.agent_band_bps as u64) as u128;
    require!(before >= floor, MoshError::AgentSellNotRally);

    let sol = math::sol_out(launch.curve_sol(), launch.token_reserve, tokens_in)?;
    require!(sol > 0, MoshError::ZeroAmount);
    require!(sol <= launch.real_sol, MoshError::InsufficientLiquidity);
    require!(sol >= min_sol_out, MoshError::Slippage);

    launch.apply_sell(tokens_in, sol)?;
    launch.vault_tokens -= tokens_in;
    launch.vault_sol += sol;
    let after = launch.price_q64()?;
    require!(
        math::move_bps(before, after) <= params.agent_max_impact_bps as u64,
        MoshError::AgentPriceImpact
    );

    launch.window_tokens_sold += tokens_in;
    launch.agent_sells = launch.agent_sells.saturating_add(1);
    launch.agent_sol_received = launch.agent_sol_received.saturating_add(sol);
    launch.record_volume(sol);

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
        tokens_in,
        TOKEN_DECIMALS,
    )?;

    emit!(Trade {
        launch: launch.key(),
        mint: mint_key,
        trader: ctx.accounts.agent.key(),
        is_buy: false,
        is_agent: true,
        sol_amount: sol,
        token_amount: tokens_in,
        fee: 0,
        price_q64: after,
        ema_q64: launch.ema_price,
        real_sol: launch.real_sol,
        token_reserve: launch.token_reserve,
        vault_sol: launch.vault_sol,
        vault_tokens: launch.vault_tokens,
        timestamp: now,
    });
    Ok(())
}
