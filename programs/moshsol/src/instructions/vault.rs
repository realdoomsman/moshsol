use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use super::pay_out;
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{VaultWithdrawn, WoundDown};
use crate::state::{Launch, LaunchStatus, Platform};

#[derive(Accounts)]
pub struct WindDown<'info> {
    pub cranker: Signer<'info>,
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

/// Permissionless end of a dead launch: once it has been live for `WIND_DOWN_MIN_AGE_SECS`, saw
/// no trade for `WIND_DOWN_IDLE_SECS`, and every token in existence sits in the curve or the vault
/// (checked on real balances, so burns don't block it), nobody else can be owed anything. The
/// vault's tokens return to the curve, curve + vault SOL is credited to backers pro-rata
/// (claimable with `claim_backer_fees`) and the launch stops trading for good.
pub fn wind_down(ctx: Context<WindDown>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    require!(launch.status == LaunchStatus::Live, MoshError::NotLive);
    require!(
        now >= launch.launched_at.saturating_add(WIND_DOWN_MIN_AGE_SECS),
        MoshError::LaunchTooYoung
    );
    require!(
        now >= launch.last_trade_ts.saturating_add(WIND_DOWN_IDLE_SECS),
        MoshError::RecentTrade
    );
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
pub struct AdminWithdrawVault<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [PLATFORM_SEED], bump = platform.bump, has_one = admin @ MoshError::Unauthorized)]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump = launch.bump,
        has_one = mint
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
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
    pub token_program: Program<'info, Token2022>,
}

/// Platform admin (the multisig) withdraws vault SOL to the fee recipient and vault tokens to a
/// token account the fee recipient owns. The withdrawn tokens take their pro-rata share of the
/// cost basis with them, so the average cost of what stays is unchanged.
pub fn admin_withdraw_vault(ctx: Context<AdminWithdrawVault>, sol: u64, tokens: u64) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    require!(sol > 0 || tokens > 0, MoshError::ZeroAmount);
    require!(
        sol <= launch.vault_sol && tokens <= launch.vault_tokens,
        MoshError::InsufficientVault
    );

    if tokens > 0 {
        launch.vault_cost_sol -= launch.vault_cost_of(tokens);
        launch.vault_tokens -= tokens;
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_tokens.to_account_info(),
                    authority: launch.to_account_info(),
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
        launch: launch.key(),
        mint: ctx.accounts.mint.key(),
        sol,
        tokens,
        recipient: ctx.accounts.fee_recipient.key(),
        recipient_tokens: ctx.accounts.recipient_tokens.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
