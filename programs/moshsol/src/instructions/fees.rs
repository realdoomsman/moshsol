use anchor_lang::prelude::*;

use super::pay_out;
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{BackerFeesClaimed, CreatorFeesClaimed, PlatformFeesSwept};
use crate::state::{Backer, Launch, Platform};

#[derive(Accounts)]
pub struct ClaimBackerFees<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.create_key.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        mut,
        seeds = [BACKER_SEED, launch.key().as_ref(), owner.key().as_ref()],
        bump = backer.bump,
        has_one = owner @ MoshError::Unauthorized,
        has_one = launch @ MoshError::Unauthorized
    )]
    pub backer: Box<Account<'info, Backer>>,
}

pub fn claim_backer_fees(ctx: Context<ClaimBackerFees>) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    let backer = &mut ctx.accounts.backer;
    let amount = backer.claimable(launch)?;
    require!(amount > 0, MoshError::NothingToClaim);
    backer.fees_claimed += amount;
    launch.backer_fees_claimed += amount;
    pay_out(
        &launch.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        amount,
    )?;
    emit!(BackerFeesClaimed {
        launch: launch.key(),
        backer: ctx.accounts.owner.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        has_one = creator @ MoshError::Unauthorized
    )]
    pub launch: Box<Account<'info, Launch>>,
}

pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    let amount = launch.creator_fees_unclaimed;
    require!(amount > 0, MoshError::NothingToClaim);
    launch.creator_fees_unclaimed = 0;
    launch.creator_fees_claimed += amount;
    pay_out(
        &launch.to_account_info(),
        &ctx.accounts.creator.to_account_info(),
        amount,
    )?;
    emit!(CreatorFeesClaimed {
        launch: launch.key(),
        creator: ctx.accounts.creator.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

/// Permissionless: always pays to the configured platform fee recipient.
#[derive(Accounts)]
pub struct SweepPlatformFees<'info> {
    #[account(seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, Platform>>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.create_key.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,
    /// CHECK: must equal platform.fee_recipient
    #[account(mut, address = platform.fee_recipient @ MoshError::Unauthorized)]
    pub fee_recipient: UncheckedAccount<'info>,
}

pub fn sweep_platform_fees(ctx: Context<SweepPlatformFees>) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    let amount = launch.platform_fees_unclaimed;
    require!(amount > 0, MoshError::NothingToClaim);
    launch.platform_fees_unclaimed = 0;
    pay_out(
        &launch.to_account_info(),
        &ctx.accounts.fee_recipient.to_account_info(),
        amount,
    )?;
    emit!(PlatformFeesSwept {
        launch: launch.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
