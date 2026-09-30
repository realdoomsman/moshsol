use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use super::pay_out;
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::Trade;
use crate::math;
use crate::state::{Launch, LaunchStatus};

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
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
    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader,
        associated_token::token_program = token_program,
    )]
    pub trader_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy(ctx: Context<Buy>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    require!(launch.status == LaunchStatus::Live, MoshError::NotLive);
    require!(sol_in > 0, MoshError::ZeroAmount);
    require!(clock.slot > launch.last_agent_trade_slot, MoshError::SameSlotTrade);
    launch.last_public_trade_slot = clock.slot;

    launch.update_ema(now)?;

    let fee = math::bps_ceil(sol_in, launch.terms.trade_fee_bps)?;
    let net = sol_in - fee;
    let tokens = math::tokens_out(launch.curve_sol(), launch.token_reserve, net)?;
    require!(tokens > 0, MoshError::ZeroAmount);
    require!(tokens < launch.token_reserve, MoshError::InsufficientLiquidity);
    require!(tokens >= min_tokens_out, MoshError::Slippage);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.trader.to_account_info(),
                to: launch.to_account_info(),
            },
        ),
        sol_in,
    )?;

    launch.apply_buy(net, tokens)?;
    launch.distribute_fee(fee)?;
    launch.record_volume(sol_in);

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.curve_tokens.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.trader_tokens.to_account_info(),
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
        trader: ctx.accounts.trader.key(),
        is_buy: true,
        is_agent: false,
        sol_amount: sol_in,
        token_amount: tokens,
        fee,
        price_q64: launch.price_q64()?,
        ema_q64: launch.ema_price,
        real_sol: launch.real_sol,
        token_reserve: launch.token_reserve,
        vault_sol: launch.vault_sol,
        vault_tokens: launch.vault_tokens,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
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
    #[account(
        mut,
        token::mint = mint,
        token::authority = trader,
        token::token_program = token_program,
    )]
    pub trader_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
}

pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    require!(launch.status == LaunchStatus::Live, MoshError::NotLive);
    require!(tokens_in > 0, MoshError::ZeroAmount);
    require!(clock.slot > launch.last_agent_trade_slot, MoshError::SameSlotTrade);
    launch.last_public_trade_slot = clock.slot;

    launch.update_ema(now)?;

    let gross = math::sol_out(launch.curve_sol(), launch.token_reserve, tokens_in)?;
    require!(gross <= launch.real_sol, MoshError::InsufficientLiquidity);
    let fee = math::bps_ceil(gross, launch.terms.trade_fee_bps)?;
    let net = gross - fee;
    require!(net > 0, MoshError::ZeroAmount);
    require!(net >= min_sol_out, MoshError::Slippage);

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.trader_tokens.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.curve_tokens.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        tokens_in,
        TOKEN_DECIMALS,
    )?;

    launch.apply_sell(tokens_in, gross)?;
    launch.distribute_fee(fee)?;
    launch.record_volume(gross);

    pay_out(
        &launch.to_account_info(),
        &ctx.accounts.trader.to_account_info(),
        net,
    )?;

    emit!(Trade {
        launch: launch.key(),
        mint: ctx.accounts.mint.key(),
        trader: ctx.accounts.trader.key(),
        is_buy: false,
        is_agent: false,
        sol_amount: net,
        token_amount: tokens_in,
        fee,
        price_q64: launch.price_q64()?,
        ema_q64: launch.ema_price,
        real_sol: launch.real_sol,
        token_reserve: launch.token_reserve,
        vault_sol: launch.vault_sol,
        vault_tokens: launch.vault_tokens,
        timestamp: now,
    });
    Ok(())
}
