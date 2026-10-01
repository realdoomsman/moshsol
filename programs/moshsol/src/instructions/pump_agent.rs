use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::Token;

use super::pump_venue::{venue_view, VenueTrade, VenueView};
use crate::constants::*;
use crate::errors::MoshError;
use crate::events::{Trade, VaultProfitShared};
use crate::math;
use crate::state::{Launch, LaunchStatus, Platform, Venue};

/// Agent trade on a pump launch's venue. The venue accounts follow as remaining accounts in
/// the `pump::curve` layout before graduation and the `pump::pool` layout after; only the
/// program ids, the launch's own curve / pool and its token accounts are pinned here, the venue
/// validates the rest, and every fill is measured from balances. The same rules as the
/// Holdfast-curve agent apply, computed from the venue's reserves.
#[derive(Accounts)]
pub struct AgentTradePump<'info> {
    /// Fronts the transient WSOL account rent on PumpSwap (returned in the same instruction).
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump,
        constraint = platform.agent_authority == agent.key() @ MoshError::Unauthorized
    )]
    pub platform: Box<Account<'info, Platform>>,
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.create_key.as_ref()],
        bump = launch.bump,
        has_one = mint,
        constraint = launch.venue == Venue::Pump @ MoshError::WrongVenue
    )]
    pub launch: Box<Account<'info, Launch>>,
    /// CHECK: the launch's mint (has_one)
    pub mint: UncheckedAccount<'info>,
    /// CHECK: system-owned PDA, the venue `user`
    #[account(mut, seeds = [PUMP_AUTHORITY_SEED, launch.key().as_ref()], bump = launch.pump.authority_bump)]
    pub pump_authority: UncheckedAccount<'info>,
    /// CHECK: ATA(pump_authority, mint), the vault's token account
    #[account(mut, address = get_associated_token_address(&pump_authority.key(), &mint.key()))]
    pub vault_tokens: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

struct Prepared<'a, 'info> {
    venue: VenueTrade<'a, 'info>,
    view: VenueView,
}
fn prepare<'a, 'info>(
    accounts: &AgentTradePump<'info>,
    remaining: &'a [AccountInfo<'info>],
    infos: &'a Infos<'info>,
    seeds: &'a [&'a [u8]],
    clock: &Clock,
) -> Result<Prepared<'a, 'info>> {
    let launch = &accounts.launch;
    require!(!accounts.platform.params.agents_paused, MoshError::AgentsPaused);
    require!(launch.status == LaunchStatus::Live, MoshError::NotLive);
    require!(clock.slot > launch.last_public_trade_slot, MoshError::SameSlotTrade);
    let view = venue_view(launch, remaining)?;
    require!(!view.complete, MoshError::CurveComplete);
    let venue = VenueTrade {
        launch: &infos.launch,
        authority: &infos.authority,
        authority_seeds: seeds,
        mint: &infos.mint,
        user_tokens: &infos.vault_tokens,
        payer: &infos.agent,
        token_program: &infos.token_program,
        system_program: &infos.system_program,
        graduated: launch.pump.graduated,
        remaining,
        rent_owed: std::cell::Cell::new(0),
        donated: std::cell::Cell::new(0),
    };
    Ok(Prepared { venue, view })
}

struct Infos<'info> {
    launch: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    vault_tokens: AccountInfo<'info>,
    agent: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
}

impl<'info> Infos<'info> {
    fn of(accounts: &AgentTradePump<'info>) -> Self {
        Self {
            launch: accounts.launch.to_account_info(),
            authority: accounts.pump_authority.to_account_info(),
            mint: accounts.mint.to_account_info(),
            vault_tokens: accounts.vault_tokens.to_account_info(),
            agent: accounts.agent.to_account_info(),
            token_program: accounts.token_program.to_account_info(),
            system_program: accounts.system_program.to_account_info(),
        }
    }
}

/// Buy with vault SOL — only on dips (venue price at least `band` under the EMA) and only at
/// or below the vault's average cost, or as a buy-back of earlier sell proceeds below the
/// average sell price. `min_tokens_out` is forwarded to the venue and checked on the fill.
pub fn agent_buy_pump<'info>(
    ctx: Context<'_, '_, 'info, 'info, AgentTradePump<'info>>,
    sol_in: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let bump = [ctx.accounts.launch.pump.authority_bump];
    let seeds: &[&[u8]] = &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &bump];
    let infos = Infos::of(&ctx.accounts);
    let Prepared { venue, view } = prepare(&ctx.accounts, ctx.remaining_accounts, &infos, seeds, &clock)?;

    let launch = &mut ctx.accounts.launch;
    let terms = launch.terms;
    launch.last_agent_trade_slot = clock.slot;
    launch.roll_window(now)?;
    launch.update_ema_with(now, view.price_q64)?;
    require!(sol_in > 0, MoshError::ZeroAmount);
    require!(sol_in <= launch.vault_sol, MoshError::InsufficientVault);
    require!(
        launch.window_sol_spent + sol_in <= launch.window_buy_cap,
        MoshError::AgentWindowLimit
    );
    let before = view.price_q64;
    let ceiling = launch.ema_price / BPS as u128 * (BPS - terms.agent_band_bps as u64) as u128;
    require!(before <= ceiling, MoshError::AgentBuyNotDip);

    let (spent, tokens) = venue.buy(sol_in, min_tokens_out)?;
    venue.settle()?;
    require!(tokens > 0 && spent > 0, MoshError::ZeroAmount);
    require!(spent <= sol_in, MoshError::InsufficientLiquidity);
    require!(tokens >= min_tokens_out, MoshError::Slippage);

    // Same two ways in as on the Holdfast curve, on the measured fill.
    let (cost_sol, cost_tokens) = launch.cost_basis();
    let below_cost = (spent as u128) * (cost_tokens as u128) <= (tokens as u128) * (cost_sol as u128);
    if !below_cost {
        let below_avg_sell = launch.agent_tokens_sold > 0
            && (spent as u128) * (launch.agent_tokens_sold as u128) * BPS as u128
                <= (tokens as u128)
                    * (launch.agent_sol_received as u128)
                    * (BPS - terms.agent_band_bps as u64) as u128;
        require!(
            below_avg_sell && spent <= launch.buyback_sol,
            MoshError::AgentAboveCostBasis
        );
        launch.buyback_sol -= spent;
    }

    launch.vault_sol = launch.vault_sol - spent + venue.donated.get();
    launch.vault_tokens += tokens;
    launch.vault_cost_sol += spent;
    let after = venue_view(launch, ctx.remaining_accounts)?;
    require!(
        math::move_bps(before, after.price_q64) <= terms.agent_max_impact_bps as u64,
        MoshError::AgentPriceImpact
    );

    launch.window_sol_spent += spent;
    launch.agent_buys = launch.agent_buys.saturating_add(1);
    launch.agent_sol_spent = launch.agent_sol_spent.saturating_add(spent);
    launch.record_volume(spent);

    emit!(Trade {
        launch: launch_key,
        mint: ctx.accounts.mint.key(),
        trader: ctx.accounts.agent.key(),
        is_buy: true,
        is_agent: true,
        sol_amount: spent,
        token_amount: tokens,
        fee: 0,
        price_q64: after.price_q64,
        ema_q64: launch.ema_price,
        real_sol: after.quote_reserve,
        token_reserve: after.base_reserve,
        vault_sol: launch.vault_sol,
        vault_tokens: launch.vault_tokens,
        timestamp: now,
    });
    Ok(())
}

/// Sell vault tokens — only into rallies (venue price at least `band` over the EMA) and only
/// at a fill above the vault's average cost plus band. The realized profit goes
/// `burn_share` to the buyback pool and the rest to backers; the cost part returns to the
/// vault and the buy-back budget. `min_sol_out` is forwarded to the venue and checked on the
/// fill.
pub fn agent_sell_pump<'info>(
    ctx: Context<'_, '_, 'info, 'info, AgentTradePump<'info>>,
    tokens_in: u64,
    min_sol_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let launch_key = ctx.accounts.launch.key();
    let bump = [ctx.accounts.launch.pump.authority_bump];
    let seeds: &[&[u8]] = &[PUMP_AUTHORITY_SEED, launch_key.as_ref(), &bump];
    let infos = Infos::of(&ctx.accounts);
    let Prepared { venue, view } = prepare(&ctx.accounts, ctx.remaining_accounts, &infos, seeds, &clock)?;

    let launch = &mut ctx.accounts.launch;
    let terms = launch.terms;
    launch.last_agent_trade_slot = clock.slot;
    launch.roll_window(now)?;
    launch.update_ema_with(now, view.price_q64)?;
    require!(tokens_in > 0, MoshError::ZeroAmount);
    require!(tokens_in <= launch.vault_tokens, MoshError::InsufficientVault);
    require!(
        launch.window_tokens_sold + tokens_in <= launch.window_sell_cap,
        MoshError::AgentWindowLimit
    );
    let before = view.price_q64;
    let floor = launch.ema_price / BPS as u128 * (BPS + terms.agent_band_bps as u64) as u128;
    require!(before >= floor, MoshError::AgentSellNotRally);

    let (sol, sold) = venue.sell(tokens_in, min_sol_out)?;
    venue.settle()?;
    require!(sol > 0 && sold == tokens_in, MoshError::ZeroAmount);
    require!(sol >= min_sol_out, MoshError::Slippage);

    let lhs = (sol as u128) * (launch.vault_tokens as u128) * BPS as u128;
    let rhs = (tokens_in as u128)
        * (launch.vault_cost_sol as u128)
        * (BPS + terms.agent_band_bps as u64) as u128;
    require!(lhs >= rhs, MoshError::AgentBelowCostBasis);

    let cost = launch.vault_cost_of(tokens_in);
    let profit = sol.saturating_sub(cost);
    let kept = sol - profit;
    launch.vault_cost_sol -= cost;
    launch.vault_tokens -= tokens_in;
    launch.vault_sol += kept + venue.donated.get();
    let (to_pool, to_backers) = launch.credit_buyback_pool(profit)?;
    launch.credit_backers(to_backers)?;
    let after = venue_view(launch, ctx.remaining_accounts)?;
    require!(
        math::move_bps(before, after.price_q64) <= terms.agent_max_impact_bps as u64,
        MoshError::AgentPriceImpact
    );

    launch.window_tokens_sold += tokens_in;
    launch.agent_sells = launch.agent_sells.saturating_add(1);
    launch.agent_sol_received = launch.agent_sol_received.saturating_add(sol);
    launch.agent_tokens_sold = launch.agent_tokens_sold.saturating_add(tokens_in);
    launch.buyback_sol = launch.buyback_sol.saturating_add(kept);
    launch.record_volume(sol);

    let mint_key = ctx.accounts.mint.key();
    emit!(Trade {
        launch: launch_key,
        mint: mint_key,
        trader: ctx.accounts.agent.key(),
        is_buy: false,
        is_agent: true,
        sol_amount: sol,
        token_amount: tokens_in,
        fee: 0,
        price_q64: after.price_q64,
        ema_q64: launch.ema_price,
        real_sol: after.quote_reserve,
        token_reserve: after.base_reserve,
        vault_sol: launch.vault_sol,
        vault_tokens: launch.vault_tokens,
        timestamp: now,
    });
    if profit > 0 {
        emit!(VaultProfitShared {
            launch: launch_key,
            mint: mint_key,
            amount: profit,
            to_buyback_pool: to_pool,
            timestamp: now,
        });
    }
    Ok(())
}
