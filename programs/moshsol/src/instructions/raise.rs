use anchor_lang::prelude::*;
use anchor_lang::system_program;

use super::pay_out;
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{Deposited, LaunchCancelled, Refunded};
use crate::math;
use crate::state::{Backer, Launch, LaunchStatus, Platform};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, Platform>>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Backer::INIT_SPACE,
        seeds = [BACKER_SEED, launch.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub backer: Box<Account<'info, Backer>>,
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(!ctx.accounts.platform.params.paused, MoshError::Paused);
    let launch = &mut ctx.accounts.launch;
    let owner = ctx.accounts.owner.key();
    let now = Clock::get()?.unix_timestamp;

    require!(launch.status == LaunchStatus::Raising, MoshError::NotRaising);
    require!(now < launch.raise_deadline, MoshError::RaiseClosed);
    require!(amount > 0, MoshError::ZeroAmount);

    if launch.whitelist_root != [0u8; 32] {
        require!(proof.len() <= MAX_PROOF_LEN, MoshError::NotWhitelisted);
        let leaf = anchor_lang::solana_program::hash::hashv(&[owner.as_ref()]).to_bytes();
        require!(
            math::verify_merkle(&proof, &launch.whitelist_root, leaf),
            MoshError::NotWhitelisted
        );
    }

    let backer = &mut ctx.accounts.backer;
    if backer.owner == Pubkey::default() {
        backer.launch = launch.key();
        backer.owner = owner;
        backer.bump = ctx.bumps.backer;
    }

    // Clip to what is still available so the last depositor never has to guess.
    let room = launch.raise_max - launch.raised;
    require!(room > 0, MoshError::RaiseFull);
    let mut amount = amount.min(room);
    if launch.max_per_wallet > 0 {
        let wallet_room = launch.max_per_wallet.saturating_sub(backer.deposited);
        require!(wallet_room > 0, MoshError::WalletCapReached);
        amount = amount.min(wallet_room);
    }

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: launch.to_account_info(),
            },
        ),
        amount,
    )?;

    if backer.deposited == 0 {
        launch.backer_count = launch.backer_count.saturating_add(1);
    }
    backer.deposited += amount;
    launch.raised += amount;

    emit!(Deposited {
        launch: launch.key(),
        backer: owner,
        amount,
        total_deposited: backer.deposited,
        raised: launch.raised,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelLaunch<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.mint.as_ref()],
        bump = launch.bump,
        has_one = creator @ MoshError::Unauthorized
    )]
    pub launch: Box<Account<'info, Launch>>,
}

/// Creator can abort a raise before it launches; every backer can then refund in full.
pub fn cancel_launch(ctx: Context<CancelLaunch>) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    require!(launch.status == LaunchStatus::Raising, MoshError::NotRaising);
    launch.status = LaunchStatus::Refunding;
    emit!(LaunchCancelled {
        launch: launch.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        mut,
        close = owner,
        seeds = [BACKER_SEED, launch.key().as_ref(), owner.key().as_ref()],
        bump = backer.bump,
        has_one = owner @ MoshError::Unauthorized,
        has_one = launch @ MoshError::Unauthorized
    )]
    pub backer: Box<Account<'info, Backer>>,
}

pub fn refund(ctx: Context<Refund>) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    let now = Clock::get()?.unix_timestamp;

    if launch.status == LaunchStatus::Raising {
        // A raise that missed its minimum by the deadline fails permanently.
        require!(now >= launch.raise_deadline, MoshError::RaiseStillOpen);
        require!(launch.raised < launch.raise_min, MoshError::MinimumReached);
        launch.status = LaunchStatus::Refunding;
    }
    require!(launch.status == LaunchStatus::Refunding, MoshError::NotRefunding);

    let amount = ctx.accounts.backer.deposited;
    require!(amount > 0, MoshError::AlreadyRefunded);
    launch.refunded += amount;
    ctx.accounts.backer.deposited = 0;

    pay_out(
        &launch.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        amount,
    )?;

    emit!(Refunded {
        launch: launch.key(),
        backer: ctx.accounts.owner.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
