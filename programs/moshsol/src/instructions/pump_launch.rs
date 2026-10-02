use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token::Token;

use super::pump_venue::VenueTrade;
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{LaunchCreated, Launched, PumpGraduated};
use crate::math;
use crate::pump::{self, BondingCurve, Pool};
use crate::state::{Launch, LaunchStatus, LaunchTerms, Platform, PumpState, Venue};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateLaunchPumpArgs {
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
    /// Terms the creator reviewed; must equal `LaunchTerms::pump` of the platform now.
    pub expected_terms: LaunchTerms,
    /// Most the creator agreed to pay as the flat create fee.
    pub max_create_fee_lamports: u64,
}

#[derive(Accounts)]
pub struct CreateLaunchPump<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [PLATFORM_SEED], bump = platform.bump)]
    pub platform: Box<Account<'info, Platform>>,
    /// CHECK: must equal platform.fee_recipient; receives the flat create fee
    #[account(mut, address = platform.fee_recipient @ MoshError::Unauthorized)]
    pub fee_recipient: UncheckedAccount<'info>,
    /// One-time signer that seeds the launch PDA (the mint doesn't exist until `launch_pump`).
    pub create_key: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Launch::INIT_SPACE,
        seeds = [LAUNCH_SEED, create_key.key().as_ref()],
        bump
    )]
    pub launch: Box<Account<'info, Launch>>,
    pub system_program: Program<'info, System>,
}

/// Opens a raise for a token that `launch_pump` will create on pump.fun. Same raise rules as
/// `create_launch`; the terms frozen are `LaunchTerms::pump` (no trade-fee split, creator
/// share 0, the platform's burn share).
pub fn create_launch_pump(ctx: Context<CreateLaunchPump>, args: CreateLaunchPumpArgs) -> Result<()> {
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
    let terms = LaunchTerms::pump(&params);
    require!(
        args.expected_terms == terms && params.create_fee_lamports <= args.max_create_fee_lamports,
        MoshError::TermsChanged
    );
    require!(args.raise_min >= params.min_raise_lamports, MoshError::InvalidParam);
    let raise_cap = match params.max_raise_lamports {
        0 => MAX_RAISE_LAMPORTS,
        cap => cap,
    };
    require!(
        args.raise_max >= args.raise_min && args.raise_max <= raise_cap,
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

    let platform = &mut ctx.accounts.platform;
    let index = platform.launch_count;
    platform.launch_count = index.checked_add(1).ok_or(MoshError::MathOverflow)?;

    let launch_key = ctx.accounts.launch.key();
    let (_, authority_bump) =
        Pubkey::find_program_address(&[PUMP_AUTHORITY_SEED, launch_key.as_ref()], &crate::ID);
    let launch = &mut ctx.accounts.launch;
    launch.set_inner(Launch {
        index,
        creator: ctx.accounts.creator.key(),
        mint: Pubkey::default(),
        status: LaunchStatus::Raising,
        bump: ctx.bumps.launch,
        curve_bump: 0,
        vault_bump: 0,
        created_at: now,
        launched_at: 0,
        terms,
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
        virtual_sol: 0,
        real_sol: 0,
        token_reserve: 0,
        vault_sol: 0,
        vault_tokens: 0,
        bundle_sol: 0,
        bundle_tokens: 0,
        vault_cost_sol: 0,
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
        agent_tokens_sold: 0,
        volume_sol: 0,
        trade_count: 0,
        last_public_trade_slot: 0,
        last_agent_trade_slot: 0,
        venue: Venue::Pump,
        create_key: ctx.accounts.create_key.key(),
        pump: PumpState { authority_bump, ..PumpState::default() },
        buyback_pool_sol: 0,
        creator_fees_collected: 0,
        burned_sol: 0,
        burned_tokens: 0,
        last_buyback_ts: 0,
        name: args.name.clone(),
        symbol: args.symbol.clone(),
        uri: args.uri.clone(),
        initial_vault_sol: 0,
        backers_repaid: 0,
        backer_payouts: 0,
        last_payout_ts: 0,
    });

    emit!(LaunchCreated {
        launch: launch_key,
        mint: Pubkey::default(),
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

#[derive(Accounts)]
pub struct LaunchPump<'info> {
    /// Pays the vault token account's rent (never refunded; it outlives the launch).
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        constraint = launch.venue == Venue::Pump @ MoshError::WrongVenue
    )]
    pub launch: Box<Account<'info, Launch>>,
    /// CHECK: system-owned PDA that pays pump.fun and owns the vault token account
    #[account(mut, seeds = [PUMP_AUTHORITY_SEED, launch.key().as_ref()], bump = launch.pump.authority_bump)]
    pub pump_authority: UncheckedAccount<'info>,
    /// Ephemeral keypair; pump.fun creates the mint at this address.
    #[account(mut)]
    pub mint: Signer<'info>,
    /// CHECK: pump.fun `[mint-authority]`
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[bonding-curve, mint]`
    #[account(mut, address = pump::bonding_curve_pda(&mint.key()) @ MoshError::InvalidVenueAccount)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: ATA(bonding_curve, mint); pump.fun creates and validates it
    #[account(mut)]
    pub associated_bonding_curve: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[global]`
    pub global: UncheckedAccount<'info>,
    /// CHECK: Metaplex token metadata program
    #[account(address = pump::MPL_TOKEN_METADATA_ID)]
    pub mpl_token_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex `[metadata, program, mint]`
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[__event_authority]`
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: the pump.fun program
    #[account(address = pump::PUMP_PROGRAM_ID @ MoshError::InvalidVenueAccount)]
    pub pump_program: UncheckedAccount<'info>,
    /// CHECK: ATA(pump_authority, mint), created here; the vault's token account
    #[account(mut, address = associated_token::get_associated_token_address(&pump_authority.key(), &mint.key()))]
    pub vault_tokens: UncheckedAccount<'info>,
    /// CHECK: pump.fun buy: one of Global.fee_recipients (validated by pump.fun)
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[creator-vault, launch]`
    #[account(mut)]
    pub creator_vault: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[global_volume_accumulator]`
    pub global_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[user_volume_accumulator, pump_authority]`
    #[account(mut)]
    pub user_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: fee program `[fee_config, pump program]`
    pub fee_config: UncheckedAccount<'info>,
    /// CHECK: pump fee program
    #[account(address = pump::PUMP_FEE_PROGRAM_ID @ MoshError::InvalidVenueAccount)]
    pub fee_program: UncheckedAccount<'info>,
    /// CHECK: pump.fun `[bonding-curve-v2, mint]`; pump.fun validates it
    pub bonding_curve_v2: UncheckedAccount<'info>,
    /// CHECK: one of pump.fun `Global.buyback_fee_recipients`; pump.fun validates it
    #[account(mut)]
    pub buyback_fee_recipient: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Creates the token on pump.fun (user = the launch's pump authority, creator = the launch
/// PDA, so creator fees accrue to the launch) and buys the bundle in the same instruction,
/// before any public trade can exist. Same callers and rules as `launch`: the creator once the
/// minimum is met; anyone once the deadline passed or the raise is full. The raise minus the
/// launch fee pays the create rent, the bundle (`1 - reserve` of the rest, capped at
/// `bundle_supply_bps` of supply) and leaves the remainder as vault SOL; bundle + remainder is
/// `initial_vault_sol`, the base of the backer payback target (lamports donated to the pump
/// authority before launch become vault SOL on top, outside that base).
pub fn launch_pump(ctx: Context<LaunchPump>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let launch = &mut ctx.accounts.launch;
    require!(launch.status == LaunchStatus::Raising, MoshError::NotRaising);
    require!(launch.raised >= launch.raise_min, MoshError::MinimumNotReached);
    let is_creator = ctx.accounts.cranker.key() == launch.creator;
    let ready = now >= launch.raise_deadline || launch.raised >= launch.raise_max;
    require!(is_creator || ready, MoshError::RaiseStillOpen);
    let mint_key = ctx.accounts.mint.key();
    require_keys_neq!(mint_key, launch.create_key, MoshError::InvalidParam);

    let launch_fee = math::bps(launch.raised, launch.terms.launch_fee_bps)?;
    let net = launch.raised - launch_fee;

    // The pump authority fronts everything the venue charges (rent of the curve, metadata
    // and token accounts, then the bundle) and hands back what is left. Anything it already
    // holds (anyone can send lamports to the PDA) is swept first so the measured costs are
    // the venue's alone; it ends up as vault SOL.
    let launch_info = launch.to_account_info();
    let authority = ctx.accounts.pump_authority.to_account_info();
    let authority_seeds: &[&[u8]] =
        &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &[launch.pump.authority_bump]];
    let venue_accounts = [
        ctx.accounts.global.to_account_info(),
        ctx.accounts.fee_recipient.to_account_info(),
        ctx.accounts.bonding_curve.to_account_info(),
        ctx.accounts.associated_bonding_curve.to_account_info(),
        ctx.accounts.creator_vault.to_account_info(),
        ctx.accounts.event_authority.to_account_info(),
        ctx.accounts.pump_program.to_account_info(),
        ctx.accounts.global_volume_accumulator.to_account_info(),
        ctx.accounts.user_volume_accumulator.to_account_info(),
        ctx.accounts.fee_config.to_account_info(),
        ctx.accounts.fee_program.to_account_info(),
        ctx.accounts.bonding_curve_v2.to_account_info(),
        ctx.accounts.buyback_fee_recipient.to_account_info(),
    ];
    let mint_info = ctx.accounts.mint.to_account_info();
    let vault_info = ctx.accounts.vault_tokens.to_account_info();
    let cranker_info = ctx.accounts.cranker.to_account_info();
    let token_program = ctx.accounts.token_program.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let venue = VenueTrade {
        launch: &launch_info,
        authority: &authority,
        authority_seeds,
        mint: &mint_info,
        user_tokens: &vault_info,
        payer: &cranker_info,
        token_program: &token_program,
        system_program: &system_program,
        graduated: false,
        remaining: &venue_accounts,
        executor: None,
        executor_base: std::cell::Cell::new(0),
        rent_owed: std::cell::Cell::new(0),
        donated: std::cell::Cell::new(0),
    };
    venue.absorb()?;
    launch_info.sub_lamports(net)?;
    authority.add_lamports(net)?;

    let create = Instruction {
        program_id: pump::PUMP_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(mint_key, true),
            AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), false),
            AccountMeta::new(ctx.accounts.bonding_curve.key(), false),
            AccountMeta::new(ctx.accounts.associated_bonding_curve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.global.key(), false),
            AccountMeta::new_readonly(ctx.accounts.mpl_token_metadata.key(), false),
            AccountMeta::new(ctx.accounts.metadata.key(), false),
            AccountMeta::new(authority.key(), true),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.pump_program.key(), false),
            // Unused by pump.fun; rides along so the runtime sees the launch's debit (`Trader`).
            AccountMeta::new(launch_key, false),
        ],
        data: pump::create_data(&launch.name, &launch.symbol, &launch.uri, &launch_key),
    };
    invoke_signed(
        &create,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.bonding_curve.to_account_info(),
            ctx.accounts.associated_bonding_curve.to_account_info(),
            ctx.accounts.global.to_account_info(),
            ctx.accounts.mpl_token_metadata.to_account_info(),
            ctx.accounts.metadata.to_account_info(),
            authority.clone(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.associated_token_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
            ctx.accounts.event_authority.to_account_info(),
            ctx.accounts.pump_program.to_account_info(),
            launch_info.clone(),
        ],
        &[authority_seeds],
    )?;
    let create_cost = net - authority.lamports();

    associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: ctx.accounts.cranker.to_account_info(),
            associated_token: ctx.accounts.vault_tokens.to_account_info(),
            authority: authority.clone(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    // Bundle: `amount` tokens priced from the curve's fee-free quote with fee headroom, capped
    // at the launch's supply share and one base unit short of the curve's real token reserves
    // (buying them all would complete the curve at launch), for at most `budget` lamports
    // including the venue's fee; what the cap leaves unspent stays as vault SOL.
    venue.sweep()?;
    let remaining = net - create_cost;
    let budget = remaining - math::bps(remaining, launch.reserve_bps)?;
    let curve = BondingCurve::load(&ctx.accounts.bonding_curve)?;
    let cap = math::bps(TOTAL_SUPPLY, launch.bundle_supply_bps)?;
    let sized = budget - math::bps(budget, PUMP_BUY_FEE_HEADROOM_BPS)?;
    let amount = math::tokens_out(curve.virtual_quote_reserves, curve.virtual_token_reserves, sized)?
        .min(cap)
        .min(curve.real_token_reserves.saturating_sub(1));
    require!(amount > 0, MoshError::InsufficientLiquidity);
    let (spent, tokens) = venue.buy_tokens(amount, budget)?;
    require!(tokens > 0 && spent <= budget, MoshError::InsufficientLiquidity);
    // Lamports donated to the authority become vault SOL but are not part of the raise, so
    // they stay out of `initial_vault_sol` (the base of the payback target).
    let left = remaining - spent + venue.donated.get();

    let curve = BondingCurve::load(&ctx.accounts.bonding_curve)?;
    let price = curve.price_q64()?;
    launch.status = LaunchStatus::Live;
    launch.launched_at = now;
    launch.mint = mint_key;
    launch.pump.bonding_curve = ctx.accounts.bonding_curve.key();
    launch.platform_fees_unclaimed += launch_fee;
    launch.vault_sol = left;
    launch.vault_tokens = tokens;
    launch.bundle_sol = spent;
    launch.bundle_tokens = tokens;
    launch.vault_cost_sol = spent;
    launch.initial_vault_sol = remaining;
    launch.last_payout_ts = now;
    launch.record_volume(spent);
    launch.ema_price = price;
    launch.last_trade_ts = now;
    launch.window_start = i64::MIN / 2; // force a fresh window
    launch.roll_window(now)?;

    emit!(Launched {
        launch: launch_key,
        mint: mint_key,
        raised: launch.raised,
        launch_fee,
        bundle_sol: spent,
        bundle_tokens: tokens,
        vault_sol: left,
        price_q64: price,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct GraduatePump<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        constraint = launch.venue == Venue::Pump @ MoshError::WrongVenue,
        constraint = launch.status == LaunchStatus::Live @ MoshError::NotLive,
        constraint = !launch.pump.graduated @ MoshError::NotGraduated,
    )]
    pub launch: Box<Account<'info, Launch>>,
    /// CHECK: the launch's bonding curve
    #[account(address = launch.pump.bonding_curve @ MoshError::InvalidVenueAccount)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: the canonical PumpSwap pool of the mint; must exist (pump.fun migrated)
    #[account(address = pump::pool_pda(&launch.mint) @ MoshError::InvalidVenueAccount)]
    pub pool: UncheckedAccount<'info>,
}

/// Permissionless: once the bonding curve completed and pump.fun migrated it, records the
/// PumpSwap pool so agent trades, fee collection and wind-down use the pool from now on. Does
/// not sample the EMA (see `Launch::update_ema_with`): only agent trades do on pump launches.
pub fn graduate_pump(ctx: Context<GraduatePump>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;
    let curve = BondingCurve::load(&ctx.accounts.bonding_curve)?;
    require!(curve.complete, MoshError::NotGraduated);
    let pool = Pool::load(&ctx.accounts.pool)?;
    require!(
        pool.base_mint == launch.mint && pool.quote_mint == pump::WSOL_MINT && pool.coin_creator == launch.key(),
        MoshError::InvalidVenueAccount
    );
    launch.pump.pool = ctx.accounts.pool.key();
    launch.pump.graduated = true;
    emit!(PumpGraduated {
        launch: launch.key(),
        mint: launch.mint,
        pool: ctx.accounts.pool.key(),
        timestamp: now,
    });
    Ok(())
}
