use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MoshError;
use crate::state::{Platform, PlatformParams};

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Platform::INIT_SPACE,
        seeds = [PLATFORM_SEED],
        bump
    )]
    pub platform: Account<'info, Platform>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        has_one = admin @ MoshError::Unauthorized
    )]
    pub platform: Account<'info, Platform>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Account<'info, Platform>,
}

pub fn initialize_platform(
    ctx: Context<InitializePlatform>,
    fee_recipient: Pubkey,
    agent_authority: Pubkey,
    params: PlatformParams,
) -> Result<()> {
    params.validate()?;
    let p = &mut ctx.accounts.platform;
    p.admin = ctx.accounts.admin.key();
    p.pending_admin = Pubkey::default();
    p.fee_recipient = fee_recipient;
    p.agent_authority = agent_authority;
    p.params = params;
    p.launch_count = 0;
    p.bump = ctx.bumps.platform;
    Ok(())
}

pub fn update_platform(ctx: Context<AdminOnly>, params: PlatformParams) -> Result<()> {
    params.validate()?;
    ctx.accounts.platform.params = params;
    Ok(())
}

pub fn set_fee_recipient(ctx: Context<AdminOnly>, fee_recipient: Pubkey) -> Result<()> {
    ctx.accounts.platform.fee_recipient = fee_recipient;
    Ok(())
}

pub fn set_agent_authority(ctx: Context<AdminOnly>, agent_authority: Pubkey) -> Result<()> {
    ctx.accounts.platform.agent_authority = agent_authority;
    Ok(())
}

pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.platform.pending_admin = new_admin;
    Ok(())
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let p = &mut ctx.accounts.platform;
    require!(
        p.pending_admin != Pubkey::default() && p.pending_admin == ctx.accounts.new_admin.key(),
        MoshError::NoPendingAdmin
    );
    p.admin = p.pending_admin;
    p.pending_admin = Pubkey::default();
    Ok(())
}
