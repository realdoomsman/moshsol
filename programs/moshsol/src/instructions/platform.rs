use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MoshError;
use crate::events::OfficialAgentTermsSet;
use crate::state::{Launch, Platform, PlatformParams};

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
    /// The program's ProgramData account; only its upgrade authority may initialize, which
    /// prevents anyone from front-running initialization after deploy.
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ MoshError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
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
    p.dev_authority = Pubkey::default();
    p.agent_executors = [Pubkey::default(); 15];
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

/// Sets, rotates or (with `Pubkey::default()`) disables the dev key that may call
/// `dev_withdraw_vault`.
pub fn set_dev_authority(ctx: Context<AdminOnly>, dev_authority: Pubkey) -> Result<()> {
    ctx.accounts.platform.dev_authority = dev_authority;
    Ok(())
}

/// Sets, replaces or (all `Pubkey::default()`) unsets the agent wallets that execute the vault
/// agent's pump trades. A registered key may appear once.
pub fn set_agent_executors(ctx: Context<AdminOnly>, executors: [Pubkey; 15]) -> Result<()> {
    for (i, k) in executors.iter().enumerate() {
        require!(
            *k == Pubkey::default() || !executors[..i].contains(k),
            MoshError::InvalidParam
        );
    }
    ctx.accounts.platform.agent_executors = executors;
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

/// Agent terms of the official Holdfast token's launch (the platform's `buyback_mint`), within the platform bounds.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct OfficialAgentTerms {
    pub agent_buy_bps_per_window: u16,
    pub agent_sell_bps_per_window: u16,
    pub agent_max_impact_bps: u16,
    pub agent_band_bps: u16,
    pub agent_window_secs: u32,
    pub ema_period_secs: u32,
}

#[derive(Accounts)]
pub struct SetOfficialAgentTerms<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [PLATFORM_SEED], bump = platform.bump, has_one = admin @ MoshError::Unauthorized)]
    pub platform: Account<'info, Platform>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        constraint = platform.params.buyback_mint != Pubkey::default()
            && launch.mint == platform.params.buyback_mint @ MoshError::Unauthorized
    )]
    pub launch: Box<Account<'info, Launch>>,
}

/// Retunes the agent terms of the official token's launch only: every other launch keeps the terms frozen at its
/// creation. The bounds are the platform's (`PlatformParams::validate`).
pub fn set_official_agent_terms(ctx: Context<SetOfficialAgentTerms>, t: OfficialAgentTerms) -> Result<()> {
    // The official token may spend up to its whole vault per window (dump defense); sells keep the platform cap.
    require!(t.agent_buy_bps_per_window as u64 <= BPS, MoshError::InvalidParam);
    require!(t.agent_sell_bps_per_window <= MAX_AGENT_WINDOW_BPS, MoshError::InvalidParam);
    require!(
        t.agent_max_impact_bps > 0 && t.agent_max_impact_bps <= MAX_AGENT_IMPACT_BPS,
        MoshError::InvalidParam
    );
    require!((MIN_AGENT_BAND_BPS..=MAX_AGENT_BAND_BPS).contains(&t.agent_band_bps), MoshError::InvalidParam);
    require!((MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&t.agent_window_secs), MoshError::InvalidParam);
    require!((MIN_EMA_PERIOD_SECS..=MAX_EMA_PERIOD_SECS).contains(&t.ema_period_secs), MoshError::InvalidParam);
    let launch = &mut ctx.accounts.launch;
    launch.terms.agent_buy_bps_per_window = t.agent_buy_bps_per_window;
    launch.terms.agent_sell_bps_per_window = t.agent_sell_bps_per_window;
    launch.terms.agent_max_impact_bps = t.agent_max_impact_bps;
    launch.terms.agent_band_bps = t.agent_band_bps;
    launch.terms.agent_window_secs = t.agent_window_secs;
    launch.terms.ema_period_secs = t.ema_period_secs;
    emit!(OfficialAgentTermsSet {
        launch: launch.key(),
        mint: launch.mint,
        terms: t,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
