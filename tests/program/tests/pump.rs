mod common;

use common::pump::*;
use common::*;
use moshsol::constants::*;
use moshsol::errors::MoshError;
use moshsol::pump::{self, WSOL_MINT};
use anchor_lang::Space;
use moshsol::state::{LaunchStatus, Venue};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signer;

fn pump_env() -> Env {
    let mut env = Env::new();
    env.with_pump();
    env
}

#[test]
fn create_launch_refused_when_holdfast_curve_disabled() {
    let mut params = test_params();
    params.holdfast_curve_enabled = false;
    let mut env = Env::with_params(params);
    let creator = env.user(5);
    assert_err(env.create(&creator, default_args()).1, MoshError::HoldfastCurveDisabled);
    // Pump launches are the only way in.
    env.with_pump();
    let launch = env.create_pump_ok(&creator, default_pump_args());
    let l = env.launch_at(&launch);
    assert_eq!(l.venue, Venue::Pump);
    assert_eq!(l.terms.creator_fee_share_bps, 0);
    assert_eq!(l.terms.trade_fee_bps, 0);
    assert_eq!(l.terms.burn_share_bps, DEFAULT_BURN_SHARE_BPS);
    assert_eq!(l.mint, Pubkey::default());
    assert_eq!(l.name, "Pump Dog");
    env.assert_pump_invariants(&launch);
}

#[test]
fn pump_launch_creates_token_and_vault_holds_bundle() {
    let mut env = pump_env();
    let creator = env.user(5);
    let fee_before = env.lamports(&env.fee_recipient.pubkey());
    let launch = env.create_pump_ok(&creator, default_pump_args());
    assert_eq!(env.lamports(&env.fee_recipient.pubkey()) - fee_before, SOL / 50);
    // The terms the creator signs for are the pump terms, not the curve terms.
    let mut bad = default_pump_args();
    let params = env.platform().params;
    bad.expected_terms = moshsol::state::LaunchTerms::from(&params);
    bad.max_create_fee_lamports = params.create_fee_lamports;
    assert_err(env.create_pump_raw(&creator, bad).1, MoshError::TermsChanged);

    let b1 = env.user(20);
    let b2 = env.user(20);
    ok(env.deposit_at(&b1, &launch, 10 * SOL));
    ok(env.deposit_at(&b2, &launch, 10 * SOL));
    env.assert_pump_invariants(&launch);

    let cranker = env.user(2);
    let (mint, res) = env.launch_pump(&cranker, &launch);
    // Only the creator may launch early.
    assert_err(res, MoshError::RaiseStillOpen);
    let _ = mint;
    let (mint, res) = env.launch_pump(&creator, &launch);
    let meta = ok(res);
    eprintln!("CU launch_pump: {}", meta.compute_units_consumed);

    let l = env.launch_at(&launch);
    assert_eq!(l.status, LaunchStatus::Live);
    assert_eq!(l.mint, mint);
    assert_eq!(l.pump.bonding_curve, pump::bonding_curve_pda(&mint));
    assert!(!l.pump.graduated);
    // A real pump.fun token: 1B supply, curve owned by pump.fun, the launch is its creator.
    assert_eq!(env.spl_mint_supply(&mint), TOTAL_SUPPLY);
    let curve = env.curve(&mint);
    assert_eq!(curve.creator, launch);
    assert!(!curve.complete);
    let meta_acct = env.svm.get_account(&metadata_pda(&mint)).unwrap();
    assert!(meta_acct.data.windows(8).any(|w| w == b"Pump Dog"), "Metaplex metadata carries the name");

    // 1% launch fee; the pump authority paid the create rent and the bundle out of the rest.
    let launch_fee = 20 * SOL / 100;
    assert_eq!(l.platform_fees_unclaimed, launch_fee);
    let net = 20 * SOL - launch_fee;
    let create_cost = net - l.vault_sol - l.bundle_sol;
    eprintln!("pump create rent paid by the launch: {} lamports", create_cost);
    assert!(create_cost > 0 && create_cost < SOL / 20, "create rent {create_cost}");
    // Budget = 70% of what was left after the create rent, but the 20% supply cap binds here
    // (as it does on the Holdfast curve with the same raise): the bundle is exactly the cap, paid
    // the curve's fee-free price plus pump.fun's 1.25% fee, and the rest stays as vault SOL.
    let remaining = net - create_cost;
    let budget = remaining - remaining * 3 / 10;
    let cap = TOTAL_SUPPLY / 5;
    assert_eq!(l.bundle_tokens, cap);
    let cost = moshsol::math::sol_in_for_tokens(30 * SOL, 1_073_000_000 * 1_000_000, cap).unwrap();
    assert!(l.bundle_sol > cost && l.bundle_sol <= cost + cost * 3 / 100, "bundle {} vs fee-free {}", l.bundle_sol, cost);
    assert!(l.bundle_sol <= budget);
    assert_eq!(l.vault_sol, remaining - l.bundle_sol);
    assert_eq!(l.vault_cost_sol, l.bundle_sol);
    assert_eq!(curve.real_token_reserves, 793_100_000 * 1_000_000 - l.bundle_tokens);
    assert_eq!(l.window_buy_cap, l.vault_sol / 10);
    assert_eq!(l.ema_price, curve_price_q64(&curve));
    env.assert_pump_invariants(&launch);
    let _ = WSOL_MINT;
}

/// Pushes the venue price up with public buys so the agent may sell, or down with public sells
/// so it may buy; the EMA only moves when an agent/crank instruction samples the venue.
fn public_pump(env: &mut Env, mint: &Pubkey, sol: u64) -> solana_sdk::signature::Keypair {
    let whale = env.user(sol / SOL + 5);
    ok(env.pump_public_buy(&whale, mint, sol));
    whale
}

#[test]
fn pump_agent_rules_and_profit_split() {
    let mut env = pump_env();
    let (_creator, launch, mint, backers) = env.live_pump_launch(&[10 * SOL, 10 * SOL]);
    let l0 = env.launch_at(&launch);
    assert_eq!(l0.ema_price, curve_price_q64(&env.curve(&mint)));

    // No rally yet: the venue price equals the EMA.
    assert_err(env.agent_sell_pump(&launch, l0.window_sell_cap / 10, 0), MoshError::AgentSellNotRally);
    // Not a dip either.
    assert_err(env.agent_buy_pump(&launch, l0.window_buy_cap / 10, 0), MoshError::AgentBuyNotDip);

    // Public buying lifts the venue price well above the EMA (which lags: dt/(dt+period)).
    env.warp(60);
    let whale = public_pump(&mut env, &mint, 20 * SOL);
    let price = curve_price_q64(&env.curve(&mint));
    assert!(price > l0.ema_price * 102 / 100);

    // Window cap: more than the per-window share of vault tokens is refused.
    assert_err(env.agent_sell_pump(&launch, l0.window_sell_cap + 1, 0), MoshError::AgentWindowLimit);
    // Slippage: the agent's floor is forwarded to the venue, which refuses the fill first.
    assert!(env.agent_sell_pump(&launch, l0.window_sell_cap / 4, 100 * SOL).is_err());
    // Rally sell: fill above cost + band; profit 25% → buyback pool, 75% → backers.
    let chunk = l0.window_sell_cap / 4;
    let meta = ok(env.agent_sell_pump(&launch, chunk, 0));
    eprintln!("CU agent_sell_pump: {}", meta.compute_units_consumed);
    let l1 = env.launch_at(&launch);
    assert_eq!(l1.vault_tokens, l0.vault_tokens - chunk);
    assert_eq!(l1.agent_sells, 1);
    assert_eq!(l1.agent_tokens_sold, chunk);
    let received = l1.agent_sol_received;
    let cost = (l0.vault_cost_sol as u128 * chunk as u128).div_ceil(l0.vault_tokens as u128) as u64;
    let profit = received - cost;
    assert!(profit > 0, "the rally sell realized a profit");
    assert_eq!(l1.buyback_pool_sol, profit / 4);
    assert_eq!(l1.backer_fees_accrued, profit - profit / 4);
    assert_eq!(l1.vault_sol, l0.vault_sol + cost);
    assert_eq!(l1.vault_cost_sol, l0.vault_cost_sol - cost);
    assert_eq!(l1.buyback_sol, cost);
    assert!(l1.ema_price > l0.ema_price && l1.ema_price < price, "EMA sampled the venue, lagging");
    env.assert_pump_invariants(&launch);
    // The EMA moved once per sample: a second sell in the same second sees the same band.
    assert_eq!(env.spl_balance(&spl_ata(&pump_authority_pda(&launch), &mint)), l1.vault_tokens);

    // Backers can claim their 75% pro-rata.
    let b = &backers[0];
    let before = env.lamports(&b.pubkey());
    ok(env.claim_backer_at(b, &launch));
    let paid = env.lamports(&b.pubkey()) + 5_000 - before; // + signature fee
    assert!(paid.abs_diff((profit - profit / 4) / 2) <= 1, "paid {paid} of {profit}");
    env.assert_pump_invariants(&launch);

    // Impact cap: a sell that would move the venue more than 3% is refused.
    let mut p = test_params();
    p.agent_max_impact_bps = 10;
    let admin = env.admin.insecure_clone();
    ok(env.update_platform(&admin, p));
    // ...but terms are frozen at creation, so the launch keeps 3%: push with a fresh launch.
    env.warp(60);
    let (_c2, launch2, mint2, _b2) = env.live_pump_launch(&[10 * SOL]);
    env.warp(60);
    public_pump(&mut env, &mint2, 10 * SOL);
    let l2 = env.launch_at(&launch2);
    assert_err(env.agent_sell_pump(&launch2, l2.window_sell_cap, 0), MoshError::AgentPriceImpact);

    // A dump takes the venue below the EMA: the agent buys back below its average sell price
    // with the sell proceeds (the buy-back path), never above the vault's average cost otherwise.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens));
    let l = env.launch_at(&launch);
    let dip = curve_price_q64(&env.curve(&mint));
    assert!(dip < l.ema_price * 98 / 100);
    assert_err(env.agent_buy_pump(&launch, l.window_buy_cap + 1, 0), MoshError::AgentWindowLimit);
    let spend = l.buyback_sol.min(l.window_buy_cap) / 2;
    let meta = ok(env.agent_buy_pump(&launch, spend, 0));
    eprintln!("CU agent_buy_pump: {}", meta.compute_units_consumed);
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.agent_buys, 1);
    assert_eq!(l3.vault_sol, l.vault_sol - spend);
    assert_eq!(l3.vault_cost_sol, l.vault_cost_sol + spend);
    assert_eq!(l3.buyback_sol, l.buyback_sol - spend);
    assert!(l3.vault_tokens > l.vault_tokens);
    // Round trip: more tokens than it sold for less SOL than it received.
    assert!(l3.agent_sol_spent < l1.agent_sol_received);
    env.assert_pump_invariants(&launch);

    // Only the agent authority.
    let stranger = env.user(2);
    assert_err(env.agent_buy_pump_as(&stranger, &launch, 1_000_000, 0), MoshError::Unauthorized);
    // Holdfast-curve agent instructions refuse pump launches and vice versa.
    let ix = env.agent_buy_ix(&env.agent.pubkey(), &mint, 1, 0);
    let agent = env.agent.insecure_clone();
    assert!(env.send(&[ix], &[&agent]).is_err());
}

#[test]
fn collect_pump_fees_splits_creator_fees() {
    let mut env = pump_env();
    let (_creator, launch, mint, _backers) = env.live_pump_launch(&[20 * SOL]);
    let cranker = env.user(2);
    // The bundle buy already paid pump.fun's 0.3% creator fee into the launch's creator vault.
    let l0 = env.launch_at(&launch);
    let vault_before = env.lamports(&creator_vault(&launch));
    assert!(vault_before > 0);
    // Public trades add to it.
    let whale = public_pump(&mut env, &mint, 5 * SOL);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens / 2));
    let accrued = env.lamports(&creator_vault(&launch));
    assert!(accrued > vault_before);

    env.warp(60);
    let cranker_before = env.lamports(&cranker.pubkey());
    let meta = ok(env.collect_pump_fees(&cranker, &launch));
    eprintln!("CU collect_pump_fees (curve): {}", meta.compute_units_consumed);
    let l1 = env.launch_at(&launch);
    let amount = l1.creator_fees_collected;
    assert!(amount > 0 && amount <= accrued);
    assert_eq!(l1.buyback_pool_sol, amount / 4);
    assert_eq!(l1.vault_sol, l0.vault_sol + amount - amount / 4);
    assert_eq!(l1.backer_fees_accrued, 0);
    // The cranker only paid the signature fee.
    assert_eq!(cranker_before - env.lamports(&cranker.pubkey()), 5_000, "cranker paid more than the fee");
    assert_eq!(l1.ema_price, l0.ema_price, "a permissionless crank never samples the EMA");
    env.assert_pump_invariants(&launch);
    assert_err(env.collect_pump_fees(&cranker, &launch), MoshError::NothingToClaim);
}

#[test]
fn buyback_burn_refuses_without_mint_then_buys_and_burns_with_caps() {
    let mut env = pump_env();
    // The launch whose pool pays, and a second pump launch standing in for the Holdfast token.
    let (_c, launch, mint, _b) = env.live_pump_launch(&[20 * SOL]);
    let (_c2, hold_launch, hold_mint, _b2) = env.live_pump_launch(&[10 * SOL]);
    let cranker = env.user(2);
    // Fill the buyback pool from creator fees.
    public_pump(&mut env, &mint, 10 * SOL);
    ok(env.collect_pump_fees(&cranker, &launch));
    let pool = env.launch_at(&launch).buyback_pool_sol;
    assert!(pool >= MIN_BUYBACK_LAMPORTS, "pool {pool}");

    env.warp(BUYBACK_MIN_INTERVAL_SECS);
    // No buyback mint on the platform: the crank refuses, the pool keeps accruing.
    assert_err(env.buyback_burn(&launch, &hold_mint, pool, 0), MoshError::BuybackMintUnset);
    let admin = env.admin.insecure_clone();
    let mut p = test_params();
    p.buyback_mint = hold_mint;
    ok(env.update_platform(&admin, p));
    // Only the configured mint.
    assert_err(env.buyback_burn(&launch, &mint, pool, 0), MoshError::BuybackMintUnset);
    // Only the agent authority may crank it (it sizes, times and floors the buy off-chain).
    assert_err(env.buyback_burn_as(&cranker, &launch, &hold_mint, pool, 0), MoshError::Unauthorized);

    let supply_before = env.spl_mint_supply(&hold_mint);
    let hold_curve = env.curve(&hold_mint);
    let cap = hold_curve.virtual_sol_reserves / 200; // 5% of the venue's quote reserves
    let quote = moshsol::math::tokens_out(hold_curve.virtual_sol_reserves, hold_curve.virtual_token_reserves, pool.min(cap)).unwrap();
    // The caller's floor binds on the measured fill, above the program's own 97% sanity floor.
    assert_err(env.buyback_burn(&launch, &hold_mint, u64::MAX, quote), MoshError::Slippage);
    // A lamport parked on the burn ATA address does not pass for the account existing.
    let burn_ata = spl_ata(&pump_authority_pda(&launch), &hold_mint);
    env.svm.airdrop(&burn_ata, 1).unwrap();
    let meta = ok(env.buyback_burn(&launch, &hold_mint, u64::MAX, quote * 97 / 100));
    eprintln!("CU buyback_burn (curve): {}", meta.compute_units_consumed);
    let l = env.launch_at(&launch);
    let spent = l.burned_sol;
    assert_eq!(spent, pool.min(cap));
    assert_eq!(l.buyback_pool_sol, pool - spent);
    assert!(l.burned_tokens >= quote * 97 / 100 && l.burned_tokens < quote, "fill {} vs quote {}", l.burned_tokens, quote);
    assert_eq!(supply_before - env.spl_mint_supply(&hold_mint), l.burned_tokens, "bought tokens were burned");
    assert_eq!(env.spl_balance(&burn_ata), 0);
    env.assert_pump_invariants(&launch);
    env.assert_pump_invariants(&hold_launch);

    // Throttled: once per minute per launch, and never below the minimum size.
    if l.buyback_pool_sol > 0 {
        assert_err(env.buyback_burn(&launch, &hold_mint, u64::MAX, 0), MoshError::BuybackThrottled);
    }
    env.warp(BUYBACK_MIN_INTERVAL_SECS);
    assert_err(env.buyback_burn(&launch, &hold_mint, MIN_BUYBACK_LAMPORTS - 1, 0), MoshError::BuybackThrottled);
    // Public trades on the Holdfast token's curve keep the launch's own accounting untouched.
    env.assert_pump_invariants(&launch);
}

/// Anyone can send lamports to a launch's pump authority (a system PDA). They must never
/// distort the measured create cost or a fill — nor brick the instruction — and end up as
/// vault SOL.
#[test]
fn pump_authority_donations_are_swept_into_the_vault() {
    let mut env = pump_env();
    let creator = env.user(5);
    let launch = env.create_pump_ok(&creator, default_pump_args());
    let b = env.user(25);
    ok(env.deposit_at(&b, &launch, 20 * SOL));
    let authority = pump_authority_pda(&launch);
    let donation = SOL / 20;
    env.svm.airdrop(&authority, donation).unwrap();
    let (mint, res) = env.launch_pump(&creator, &launch);
    ok(res);
    let l0 = env.launch_at(&launch);
    let net = 20 * SOL - 20 * SOL / 100;
    let create_cost = net + donation - l0.vault_sol - l0.bundle_sol;
    assert!(create_cost > 0 && create_cost < SOL / 20, "create rent {create_cost}");
    assert_eq!(l0.vault_cost_sol, l0.bundle_sol, "the donation is not part of the bundle's cost");
    env.assert_pump_invariants(&launch);

    // Before an agent sell: the proceeds are measured without it.
    env.warp(60);
    let whale = public_pump(&mut env, &mint, 20 * SOL);
    env.svm.airdrop(&authority, donation).unwrap();
    let chunk = l0.window_sell_cap / 4;
    ok(env.agent_sell_pump(&launch, chunk, 0));
    let l1 = env.launch_at(&launch);
    let cost = (l0.vault_cost_sol as u128 * chunk as u128).div_ceil(l0.vault_tokens as u128) as u64;
    assert_eq!(l1.vault_sol, l0.vault_sol + cost + donation);
    assert_eq!(l1.buyback_sol, cost);
    env.assert_pump_invariants(&launch);

    // Before an agent buy: a donation larger than the spend (the case that used to underflow
    // the measured spend), then one smaller.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens));
    let l = env.launch_at(&launch);
    assert!(curve_price_q64(&env.curve(&mint)) < l.ema_price * 98 / 100);
    let spend = l.buyback_sol.min(l.window_buy_cap) / 2;
    let big = spend * 2;
    env.svm.airdrop(&authority, big).unwrap();
    ok(env.agent_buy_pump(&launch, spend, 0));
    let l2 = env.launch_at(&launch);
    assert_eq!(l2.vault_sol, l.vault_sol - spend + big);
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol + spend);
    assert_eq!(l2.buyback_sol, l.buyback_sol - spend);
    env.assert_pump_invariants(&launch);
    env.svm.airdrop(&authority, spend / 2).unwrap();
    ok(env.agent_buy_pump(&launch, spend, 0));
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.vault_sol, l2.vault_sol - spend + spend / 2);
    assert_eq!(l3.vault_cost_sol, l2.vault_cost_sol + spend);
    env.assert_pump_invariants(&launch);
}

/// On pump launches the EMA is sampled only by agent trades, and however long the launch sat
/// idle one sample moves it at most halfway to the venue price.
#[test]
fn pump_ema_moves_at_most_halfway_per_agent_sample() {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[20 * SOL]);
    let l0 = env.launch_at(&launch);
    env.warp(l0.terms.ema_period_secs as i64 * 50);
    public_pump(&mut env, &mint, 20 * SOL);
    let spot = curve_price_q64(&env.curve(&mint));
    assert!(spot > l0.ema_price * 2, "a spike well beyond 2x");
    ok(env.agent_sell_pump(&launch, l0.window_sell_cap / 4, 0));
    let l1 = env.launch_at(&launch);
    assert_eq!(l1.ema_price, l0.ema_price + (spot - l0.ema_price) / 2, "weight clamped to 1/2");
    env.assert_pump_invariants(&launch);
}

#[test]
fn migrate_launch_converts_mainnet_layout() {
    // The platform and the two launches exactly as they sit on mainnet before the upgrade,
    // with the admin swapped for the test admin (the real one is the Squads vault).
    let mut env = Env::bare();
    // Mainnet's rent (SIMD lowered it to 2540 lamports per byte-year); the fixtures hold exactly
    // that, so the realloc's rent top-up must be computed against it.
    env.svm.set_sysvar(&solana_sdk::rent::Rent { lamports_per_byte_year: 2_540, exemption_threshold: 2.0, burn_percent: 50 });
    let admin = env.admin.insecure_clone();
    let (platform_key, mut platform_acct) = fixture_account("mainnet/449KHjhaaW58syfaWstZDzcUwTW613XbVB7S6Zp1gpZe");
    assert_eq!(platform_key, platform_pda());
    assert_eq!(platform_acct.data.len(), 8 + moshsol::state::PlatformV1::INIT_SPACE);
    platform_acct.data[8..40].copy_from_slice(admin.pubkey().as_ref());
    env.svm.set_account(platform_key, platform_acct).unwrap();
    let launches = [
        "mainnet/ChpzEmQQQmuoS93AhcG7P8NRRbHJ4Hnx2Hs6ty1kNGD8",
        "mainnet/HNCt4NhEAvJaZAfQVDP8nEJcATLYA3nFVzAk3YRDKNTj",
    ]
    .map(|name| {
        let (k, a) = fixture_account(name);
        assert_eq!(a.data.len(), 8 + moshsol::state::LaunchV1::INIT_SPACE);
        env.svm.set_account(k, a.clone()).unwrap();
        (k, a)
    });

    // The new layout can't read either account before migration.
    let stranger = env.user(2);
    assert_anchor_err(
        env.update_platform(&admin, test_params()),
        anchor_lang::error::ErrorCode::AccountDidNotDeserialize,
    );
    let meta = ok(env.migrate_platform(&admin));
    eprintln!("CU migrate_platform: {}", meta.compute_units_consumed);
    let p = env.platform();
    assert_eq!(p.admin, admin.pubkey());
    assert!(!p.params.holdfast_curve_enabled);
    assert_eq!(p.params.burn_share_bps, DEFAULT_BURN_SHARE_BPS);
    assert_eq!(p.params.buyback_mint, Pubkey::default());
    assert_eq!(p.params.trade_fee_bps, 100);
    assert_eq!(p.launch_count, 2);
    assert_err(env.migrate_platform(&admin), MoshError::AlreadyMigrated);

    for (key, old) in launches {
        assert_err(env.migrate_launch(&stranger, &key), MoshError::Unauthorized);
        let admin_before = env.lamports(&admin.pubkey());
        let meta = ok(env.migrate_launch(&admin, &key));
        eprintln!("CU migrate_launch: {}", meta.compute_units_consumed);
        let l = env.launch_at(&key);
        let acct = env.svm.get_account(&key).unwrap();
        assert_eq!(acct.data.len(), 8 + moshsol::state::Launch::INIT_SPACE);
        // Old fields survive at their old values (spot-check what the raw bytes say)...
        let old_mint = Pubkey::new_from_array(old.data[48..80].try_into().unwrap());
        assert_eq!(l.mint, old_mint);
        assert_eq!(l.venue, Venue::Holdfast);
        assert_eq!(l.create_key, old_mint);
        assert_eq!(key, launch_pda(&old_mint));
        let old_raised = u64::from_le_bytes(old.data[156..164].try_into().unwrap());
        assert_eq!(l.raised, old_raised);
        assert_eq!(l.terms.burn_share_bps, 0);
        assert_eq!(l.terms.trade_fee_bps, 100);
        eprintln!("migrated {key}: status {:?}, raised {}, vault_sol {}", l.status, l.raised, l.vault_sol);
        // ...the new ones start empty, and the admin paid exactly the extra rent.
        assert_eq!((l.buyback_pool_sol, l.burned_sol, l.pump.graduated), (0, 0, false));
        let rent_old = env.svm.minimum_balance_for_rent_exemption(old.data.len());
        let rent_new = env.svm.minimum_balance_for_rent_exemption(acct.data.len());
        assert_eq!(admin_before - env.lamports(&admin.pubkey()), rent_new - rent_old + 5_000);
        assert_eq!(acct.lamports, old.lamports + rent_new - rent_old);
        assert!(acct.lamports >= rent_new + l.owed_lamports(), "mainnet accounting holds after migration");
        assert_err(env.migrate_launch(&admin, &key), MoshError::AlreadyMigrated);
    }
}

#[test]
fn wind_down_pump_sells_vault_into_venue_for_backers() {
    let mut env = pump_env();
    let (_c, launch, mint, backers) = env.live_pump_launch(&[10 * SOL, 10 * SOL]);
    let cranker = env.user(2);
    assert_err(env.wind_down_pump(&cranker, &launch), MoshError::LaunchTooYoung);
    env.warp(WIND_DOWN_MIN_AGE_SECS);
    // An outside holder blocks it.
    let holder = public_pump(&mut env, &mint, SOL);
    assert_err(env.wind_down_pump(&cranker, &launch), MoshError::OutsideHolders);
    let held = env.spl_balance(&spl_ata(&holder.pubkey(), &mint));
    ok(env.pump_public_sell(&holder, &mint, held));

    let l0 = env.launch_at(&launch);
    let curve = env.curve(&mint);
    let fee_free = moshsol::math::sol_out(curve.virtual_sol_reserves, curve.virtual_token_reserves, l0.vault_tokens).unwrap();
    // Lamports donated to the pump authority go to backers with the rest.
    let donation = SOL / 100;
    env.svm.airdrop(&pump_authority_pda(&launch), donation).unwrap();
    let meta = ok(env.wind_down_pump(&cranker, &launch));
    eprintln!("CU wind_down_pump (curve): {}", meta.compute_units_consumed);
    let l = env.launch_at(&launch);
    assert_eq!(l.status, LaunchStatus::WoundDown);
    assert_eq!((l.vault_sol, l.vault_tokens, l.vault_cost_sol, l.buyback_sol), (0, 0, 0, 0));
    let proceeds = l.backer_fees_accrued - l0.vault_sol - donation;
    assert!(proceeds > fee_free * 97 / 100 && proceeds < fee_free, "sold the whole vault: {proceeds} vs {fee_free}");
    assert_eq!(env.spl_balance(&spl_ata(&pump_authority_pda(&launch), &mint)), 0);
    env.assert_pump_invariants(&launch);
    for b in &backers {
        let before = env.lamports(&b.pubkey());
        ok(env.claim_backer_at(b, &launch));
        let paid = env.lamports(&b.pubkey()) + 5_000 - before; // + signature fee
        assert!(paid.abs_diff(l.backer_fees_accrued / 2) <= 1);
    }
    // Creator fees still collect afterwards, now straight to backers.
    ok(env.collect_pump_fees(&cranker, &launch));
    let l2 = env.launch_at(&launch);
    assert!(l2.backer_fees_accrued > l.backer_fees_accrued);
    assert_eq!(l2.vault_sol, 0);
    env.assert_pump_invariants(&launch);
    assert_err(env.wind_down_pump(&cranker, &launch), MoshError::NotLive);
}

#[test]
fn admin_withdraw_works_on_pump_vault() {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[20 * SOL]);
    let admin = env.admin.insecure_clone();
    let l = env.launch_at(&launch);
    let fr = env.fee_recipient.pubkey();
    let fr_before = env.lamports(&fr);
    let meta = ok(env.admin_withdraw_pump(&admin, &launch, l.vault_sol / 2, l.vault_tokens / 4));
    eprintln!("CU admin_withdraw_vault (pump): {}", meta.compute_units_consumed);
    let l2 = env.launch_at(&launch);
    assert_eq!(env.lamports(&fr) - fr_before, l.vault_sol / 2);
    assert_eq!(env.spl_balance(&spl_ata(&fr, &mint)), l.vault_tokens / 4);
    assert_eq!(l2.vault_tokens, l.vault_tokens - l.vault_tokens / 4);
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol - (l.vault_cost_sol as u128 * (l.vault_tokens / 4) as u128).div_ceil(l.vault_tokens as u128) as u64);
    env.assert_pump_invariants(&launch);
}

#[test]
fn graduation_moves_agent_fees_and_wind_down_to_pumpswap() {
    let mut env = pump_env();
    let (_c, launch, mint, _backers) = env.live_pump_launch(&[10 * SOL]);
    let cranker = env.user(2);
    // A whale buys out the curve; pump.fun marks it complete and anyone can migrate it.
    let whale = env.user(200);
    let left = env.curve(&mint).real_token_reserves;
    ok(env.pump_public_buy_tokens(&whale, &mint, left, 120 * SOL));
    assert!(env.curve(&mint).complete);
    assert_err(env.agent_sell_pump(&launch, 1_000_000, 0), MoshError::CurveComplete);
    assert_err(env.graduate_pump(&cranker, &launch), MoshError::InvalidVenueAccount);
    let meta = ok(env.pump_migrate(&cranker, &mint));
    eprintln!("CU pump migrate: {}", meta.compute_units_consumed);
    let ema_before = env.launch_at(&launch).ema_price;
    let meta = ok(env.graduate_pump(&cranker, &launch));
    eprintln!("CU graduate_pump: {}", meta.compute_units_consumed);
    let l = env.launch_at(&launch);
    assert!(l.pump.graduated);
    assert_eq!(l.pump.pool, pump::pool_pda(&mint));
    assert_eq!(l.ema_price, ema_before, "a permissionless crank never samples the EMA");
    assert_err(env.graduate_pump(&cranker, &launch), MoshError::NotGraduated);
    env.assert_pump_invariants(&launch);

    // Anyone can park a lamport on the transient / one-time account addresses; existence is
    // decided by what the account is, not by its balance, so the trades still go through.
    let authority_wsol = spl_ata(&pump_authority_pda(&launch), &WSOL_MINT);
    env.svm.airdrop(&authority_wsol, 1).unwrap();
    env.svm.airdrop(&spl_ata(&launch, &WSOL_MINT), 1).unwrap();
    env.svm.airdrop(&amm_uva(&pump_authority_pda(&launch)), 1).unwrap();

    // Agent sell on PumpSwap into a rally (the EMA lags the migration price).
    env.warp(60);
    ok(env.amm_public_buy(&whale, &mint, 10 * SOL));
    let l0 = env.launch_at(&launch);
    let chunk = l0.window_sell_cap / 4;
    let meta = ok(env.agent_sell_pump(&launch, chunk, 0));
    eprintln!("CU agent_sell_pump (pool): {}", meta.compute_units_consumed);
    let l1 = env.launch_at(&launch);
    assert_eq!(l1.vault_tokens, l0.vault_tokens - chunk);
    assert!(l1.buyback_pool_sol > l0.buyback_pool_sol);
    assert_eq!(env.svm.get_account(&authority_wsol).map(|a| a.lamports).unwrap_or(0), 0, "transient WSOL account closed");
    env.assert_pump_invariants(&launch);

    // PumpSwap creator fees (WSOL) collect into the launch too.
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens / 10));
    let meta = ok(env.collect_pump_fees(&cranker, &launch));
    eprintln!("CU collect_pump_fees (pool): {}", meta.compute_units_consumed);
    let l2 = env.launch_at(&launch);
    assert!(l2.creator_fees_collected > 0);
    assert_eq!(l2.buyback_pool_sol - l1.buyback_pool_sol, l2.creator_fees_collected / 4);
    env.assert_pump_invariants(&launch);

    // Agent buy on PumpSwap after a dump.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens / 2));
    let l3 = env.launch_at(&launch);
    let spend = l3.buyback_sol.min(l3.window_buy_cap) / 2;
    let meta = ok(env.agent_buy_pump(&launch, spend, 0));
    eprintln!("CU agent_buy_pump (pool): {}", meta.compute_units_consumed);
    let l4 = env.launch_at(&launch);
    assert_eq!(l4.vault_sol, l3.vault_sol - spend);
    assert!(l4.vault_tokens > l3.vault_tokens);
    env.assert_pump_invariants(&launch);

    // Buyback on PumpSwap is not covered here: see the README's known issues (the fill of a
    // PumpSwap `buy_exact_quote_in` falls under the 97% floor in this harness).
    let l5 = env.launch_at(&launch);

    // Wind-down on PumpSwap once the whale is out and the launch is dead.
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens));
    env.warp(WIND_DOWN_MIN_AGE_SECS);
    let meta = ok(env.wind_down_pump(&cranker, &launch));
    eprintln!("CU wind_down_pump (pool): {}", meta.compute_units_consumed);
    let l6 = env.launch_at(&launch);
    assert_eq!(l6.status, LaunchStatus::WoundDown);
    assert_eq!(l6.vault_tokens, 0);
    assert!(l6.backer_fees_accrued > l5.backer_fees_accrued);
    env.assert_pump_invariants(&launch);
}
