use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::Discriminator;

use crate::constants::*;
use crate::errors::MoshError;
use crate::events::LaunchMigrated;
use crate::state::{Launch, LaunchV2, Platform, PlatformV2};

/// Grows a program-owned account to `new_len`, the payer covering the extra rent (the rent
/// delta, not what the balance lacks: the account's lamports beyond rent are owed to users),
/// and returns a copy of the data that was there.
fn grow<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    new_len: usize,
) -> Result<Vec<u8>> {
    let old = account.try_borrow_data()?.to_vec();
    let rent = Rent::get()?;
    let extra = rent.minimum_balance(new_len) - rent.minimum_balance(old.len());
    if extra > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program.clone(),
                system_program::Transfer { from: payer.clone(), to: account.clone() },
            ),
            extra,
        )?;
    }
    account.realloc(new_len, false)?;
    Ok(old)
}

#[derive(Accounts)]
pub struct MigratePlatform<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: the platform PDA in its pre-payback layout; decoded by hand because the typed
    /// account no longer fits it.
    #[account(mut, seeds = [PLATFORM_SEED], bump, owner = crate::ID)]
    pub platform: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// One-time, admin-only: brings the platform account from the pre-payback layout to the
/// current one (payback params at their defaults, burn share reset to the default). The admin
/// pays the extra rent.
pub fn migrate_platform(ctx: Context<MigratePlatform>) -> Result<()> {
    let info = ctx.accounts.platform.to_account_info();
    let new_len = 8 + Platform::INIT_SPACE;
    require!(info.data_len() == 8 + PlatformV2::INIT_SPACE, MoshError::AlreadyMigrated);
    let old = grow(&info, &ctx.accounts.admin, &ctx.accounts.system_program, new_len)?;
    require!(old[..8] == *Platform::DISCRIMINATOR, MoshError::InvalidParam);
    require!(old[8..40] == *ctx.accounts.admin.key().as_ref(), MoshError::Unauthorized);
    let new = PlatformV2::upgrade_bytes(&old);
    info.try_borrow_mut_data()?[..new.len()].copy_from_slice(&new);
    Ok(())
}

#[derive(Accounts)]
pub struct MigrateLaunch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [PLATFORM_SEED], bump = platform.bump, has_one = admin @ MoshError::Unauthorized)]
    pub platform: Box<Account<'info, Platform>>,
    /// CHECK: a launch account in the pre-payback layout, verified by discriminator and
    /// length; its PDA seeds are checked against the decoded create key.
    #[account(mut, owner = crate::ID)]
    pub launch: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Admin-only: brings a launch created before the backer payback existed to the current
/// layout. Every other instruction assumes the new layout, so this must run on each existing
/// launch right after the upgrade. The admin pays the extra rent; the launch's own lamports
/// stay exactly `rent + owed`. `initial_vault_sol` is only used for launched pump launches
/// (see `LaunchV2::upgrade`); pass 0 otherwise.
pub fn migrate_launch(ctx: Context<MigrateLaunch>, initial_vault_sol: u64) -> Result<()> {
    let info = ctx.accounts.launch.to_account_info();
    let new_len = 8 + Launch::INIT_SPACE;
    require!(info.data_len() == 8 + LaunchV2::INIT_SPACE, MoshError::AlreadyMigrated);
    let old = grow(&info, &ctx.accounts.admin, &ctx.accounts.system_program, new_len)?;
    require!(old[..8] == *Launch::DISCRIMINATOR, MoshError::InvalidParam);
    let create_key = &old[8 + LaunchV2::CREATE_KEY_AT..8 + LaunchV2::CREATE_KEY_AT + 32];
    let bump = old[8 + LaunchV2::BUMP_AT];
    let expected = Pubkey::create_program_address(&[LAUNCH_SEED, create_key, &[bump]], &crate::ID)
        .map_err(|_| MoshError::InvalidParam)?;
    require_keys_eq!(expected, info.key(), MoshError::InvalidParam);
    let new = LaunchV2::upgrade_bytes(&old, initial_vault_sol)?;
    {
        let mut data = info.try_borrow_mut_data()?;
        data[..new.len()].copy_from_slice(&new);
        data[new.len()..].fill(0);
    }
    emit!(LaunchMigrated {
        launch: info.key(),
        mint: Pubkey::new_from_array(old[48..80].try_into().unwrap()),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
