use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_2022_extensions::{token_metadata_initialize, TokenMetadataInitialize};
use anchor_spl::token_interface::{self, Mint, MintTo, SetAuthority, TokenAccount};

use crate::constants::*;
use crate::errors::MoshError;
use crate::events::LaunchCreated;
use crate::state::{Launch, LaunchStatus, Platform};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateLaunchArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub raise_min: u64,
    pub raise_max: u64,
    /// 0 = no per-wallet cap
    pub max_per_wallet: u64,
    pub duration_secs: i64,
    /// All zero = open raise
    pub whitelist_root: [u8; 32],
    /// Max share of supply the bundle buys at launch
    pub bundle_supply_bps: u16,
    /// Share of the raise kept as SOL in the vault for agents to buy dips
    pub reserve_bps: u16,
}

#[derive(Accounts)]
pub struct CreateLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, Platform>>,
    /// CHECK: must equal platform.fee_recipient; receives the flat create fee
    #[account(mut, address = platform.fee_recipient @ MoshError::Unauthorized)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Launch::INIT_SPACE,
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump
    )]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        init,
        payer = creator,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = launch,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = launch,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [CURVE_SEED, launch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = launch,
        token::token_program = token_program,
    )]
    pub curve_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, launch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = launch,
        token::token_program = token_program,
    )]
    pub vault_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn create_launch(ctx: Context<CreateLaunch>, args: CreateLaunchArgs) -> Result<()> {
    let params = ctx.accounts.platform.params;
    require!(!params.paused, MoshError::Paused);

    require!(
        !args.name.trim().is_empty() && args.name.len() <= MAX_NAME_LEN,
        MoshError::InvalidMetadata
    );
    require!(
        !args.symbol.trim().is_empty() && args.symbol.len() <= MAX_SYMBOL_LEN,
        MoshError::InvalidMetadata
    );
    require!(args.uri.len() <= MAX_URI_LEN, MoshError::InvalidMetadata);
    require!(args.raise_min >= params.min_raise_lamports, MoshError::InvalidParam);
    require!(
        args.raise_max >= args.raise_min && args.raise_max <= MAX_RAISE_LAMPORTS,
        MoshError::InvalidParam
    );
    require!(
        (MIN_RAISE_DURATION_SECS..=MAX_RAISE_DURATION_SECS).contains(&args.duration_secs),
        MoshError::InvalidParam
    );
    require!(
        args.bundle_supply_bps >= MIN_BUNDLE_SUPPLY_BPS
            && args.bundle_supply_bps <= params.max_bundle_supply_bps,
        MoshError::InvalidParam
    );
    require!(args.reserve_bps <= MAX_RESERVE_BPS, MoshError::InvalidParam);

    let now = Clock::get()?.unix_timestamp;

    // Flat anti-spam create fee.
    if params.create_fee_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
            ),
            params.create_fee_lamports,
        )?;
    }

    let mint_key = ctx.accounts.mint.key();
    let launch_bump = ctx.bumps.launch;
    let seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch_bump]];
    let signer = &[seeds];

    // Fund the mint for the variable-length metadata TLV entry the token program appends.
    // TokenMetadata = update_authority(32) + mint(32) + name/symbol/uri (4+len each)
    // + additional_metadata vec len (4); TLV header = type(2) + length(2).
    let meta_len = 4 + 32 + 32 + 4 * 4 + args.name.len() + args.symbol.len() + args.uri.len();
    let mint_info = ctx.accounts.mint.to_account_info();
    let required = Rent::get()?.minimum_balance(mint_info.data_len() + meta_len);
    let current = mint_info.lamports();
    if required > current {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: mint_info.clone(),
                },
            ),
            required - current,
        )?;
    }

    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: mint_info.clone(),
                update_authority: ctx.accounts.launch.to_account_info(),
                mint: mint_info.clone(),
                mint_authority: ctx.accounts.launch.to_account_info(),
            },
            signer,
        ),
        args.name.clone(),
        args.symbol.clone(),
        args.uri.clone(),
    )?;

    // Entire fixed supply goes to the curve, then minting is disabled forever.
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: mint_info.clone(),
                to: ctx.accounts.curve_tokens.to_account_info(),
                authority: ctx.accounts.launch.to_account_info(),
            },
            signer,
        ),
        TOTAL_SUPPLY,
    )?;
    token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.launch.to_account_info(),
                account_or_mint: mint_info.clone(),
            },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    let platform = &mut ctx.accounts.platform;
    let index = platform.launch_count;
    platform.launch_count = index.checked_add(1).ok_or(MoshError::MathOverflow)?;

    let launch = &mut ctx.accounts.launch;
    launch.set_inner(Launch {
        index,
        creator: ctx.accounts.creator.key(),
        mint: mint_key,
        status: LaunchStatus::Raising,
        bump: launch_bump,
        curve_bump: ctx.bumps.curve_tokens,
        vault_bump: ctx.bumps.vault_tokens,
        created_at: now,
        launched_at: 0,
        raise_min: args.raise_min,
        raise_max: args.raise_max,
        max_per_wallet: args.max_per_wallet,
        raise_deadline: now + args.duration_secs,
        raised: 0,
        refunded: 0,
        backer_count: 0,
        whitelist_root: args.whitelist_root,
        bundle_supply_bps: args.bundle_supply_bps,
        reserve_bps: args.reserve_bps,
        virtual_sol: params.virtual_sol_reserves,
        real_sol: 0,
        token_reserve: TOTAL_SUPPLY,
        vault_sol: 0,
        vault_tokens: 0,
        bundle_sol: 0,
        bundle_tokens: 0,
        acc_fee_per_share: 0,
        backer_fees_accrued: 0,
        backer_fees_claimed: 0,
        creator_fees_unclaimed: 0,
        creator_fees_claimed: 0,
        platform_fees_unclaimed: 0,
        window_start: 0,
        window_buy_cap: 0,
        window_sol_spent: 0,
        window_sell_cap: 0,
        window_tokens_sold: 0,
        ema_price: 0,
        last_trade_ts: 0,
        agent_buys: 0,
        agent_sells: 0,
        agent_sol_spent: 0,
        agent_sol_received: 0,
        volume_sol: 0,
        trade_count: 0,
    });

    emit!(LaunchCreated {
        launch: launch.key(),
        mint: mint_key,
        creator: launch.creator,
        index,
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
        raise_min: args.raise_min,
        raise_max: args.raise_max,
        raise_deadline: launch.raise_deadline,
        bundle_supply_bps: args.bundle_supply_bps,
        reserve_bps: args.reserve_bps,
        whitelisted: args.whitelist_root != [0u8; 32],
        timestamp: now,
    });
    Ok(())
}
