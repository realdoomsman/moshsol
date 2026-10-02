mod common;

use common::pump::*;
use common::*;
use moshsol::constants::*;
use moshsol::errors::MoshError;
use moshsol::pump::{self, WSOL_MINT};
use anchor_lang::{AnchorDeserialize, Space, ToAccountMetas};
use anchor_spl::token::{spl_token, ID as TOKEN_ID};
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
    assert_eq!(l.initial_vault_sol, remaining, "bundle + reserve: the raise minus launch fee and create rent");
    assert_eq!((l.last_payout_ts, l.backers_repaid, l.backer_payouts), (l.launched_at, 0, 0));
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
fn pump_agent_rules_and_vault_keeps_proceeds() {
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
    // Rally sell: fill above cost + band; the whole fill stays in the vault, backers get nothing.
    let chunk = l0.window_sell_cap / 4;
    let meta = ok(env.agent_sell_pump(&launch, chunk, 0));
    eprintln!("CU agent_sell_pump: {}", meta.compute_units_consumed);
    let l1 = env.launch_at(&launch);
    assert_eq!(l1.vault_tokens, l0.vault_tokens - chunk);
    assert_eq!(l1.agent_sells, 1);
    assert_eq!(l1.agent_tokens_sold, chunk);
    let received = l1.agent_sol_received;
    let cost = (l0.vault_cost_sol as u128 * chunk as u128).div_ceil(l0.vault_tokens as u128) as u64;
    assert!(received > cost, "the rally sell realized a profit");
    assert_eq!(l1.buyback_pool_sol, 0);
    assert_eq!(l1.backer_fees_accrued, 0);
    assert_eq!(l1.vault_sol, l0.vault_sol + received);
    assert_eq!(l1.vault_cost_sol, l0.vault_cost_sol - cost);
    assert!(l1.ema_price > l0.ema_price && l1.ema_price < price, "EMA sampled the venue, lagging");
    env.assert_pump_invariants(&launch);
    // The EMA moved once per sample: a second sell in the same second sees the same band.
    assert_eq!(env.spl_balance(&spl_ata(&pump_authority_pda(&launch), &mint)), l1.vault_tokens);

    // Nothing for backers to claim.
    assert_err(env.claim_backer_at(&backers[0], &launch), MoshError::NothingToClaim);
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
    // with vault SOL (the buy-back path), never above the vault's average cost otherwise, and
    // never below the vault floor.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens));
    let l = env.launch_at(&launch);
    let dip = curve_price_q64(&env.curve(&mint));
    assert!(dip < l.ema_price * 98 / 100);
    assert_err(env.agent_buy_pump(&launch, l.window_buy_limit().unwrap() - l.window_sol_spent + 1, 0), MoshError::AgentWindowLimit);
    assert_err(env.agent_buy_pump(&launch, l.vault_sol - l.terms.min_vault_sol + 1, 0), MoshError::VaultFloor);
    let spend = l.window_buy_cap / 4;
    let meta = ok(env.agent_buy_pump(&launch, spend, 0));
    eprintln!("CU agent_buy_pump: {}", meta.compute_units_consumed);
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.agent_buys, 1);
    assert_eq!(l3.vault_sol, l.vault_sol - spend);
    assert_eq!(l3.vault_cost_sol, l.vault_cost_sol + spend);
    assert!(l3.vault_tokens > l.vault_tokens);
    // Round trip: bought back at a better price than it sold.
    let bought = l3.vault_tokens - l.vault_tokens;
    assert!(bought as u128 * l1.agent_sol_received as u128 > spend as u128 * l1.agent_tokens_sold as u128);
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
    // 15% buyback pool, 75% vault SOL, the remaining 10% to backers.
    let pool = amount * DEFAULT_BURN_SHARE_BPS as u64 / 10_000;
    let vault = amount * DEFAULT_CREATOR_FEE_VAULT_BPS as u64 / 10_000;
    assert_eq!(l1.buyback_pool_sol, pool);
    assert_eq!(l1.vault_sol, l0.vault_sol + vault);
    assert_eq!(l1.backer_fees_accrued, amount - pool - vault);
    assert_eq!(l1.terms.backer_creator_fee_bps(), 1_000);
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
    // And not while the agent circuit breaker is on.
    p.agents_paused = true;
    ok(env.update_platform(&admin, p));
    assert_err(env.buyback_burn(&launch, &hold_mint, pool, 0), MoshError::AgentsPaused);
    p.agents_paused = false;
    ok(env.update_platform(&admin, p));

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
    assert_eq!(
        l0.initial_vault_sol,
        l0.bundle_sol + l0.vault_sol - donation,
        "the donation is vault SOL but not part of the payback base"
    );
    env.assert_pump_invariants(&launch);

    // Before an agent sell: the proceeds are measured without it.
    env.warp(60);
    let whale = public_pump(&mut env, &mint, 20 * SOL);
    env.svm.airdrop(&authority, donation).unwrap();
    let chunk = l0.window_sell_cap / 4;
    ok(env.agent_sell_pump(&launch, chunk, 0));
    let l1 = env.launch_at(&launch);
    assert_eq!(l1.vault_sol, l0.vault_sol + l1.agent_sol_received + donation);
    env.assert_pump_invariants(&launch);

    // Before an agent buy: a donation larger than the spend (the case that used to underflow
    // the measured spend), then one smaller.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens));
    let l = env.launch_at(&launch);
    assert!(curve_price_q64(&env.curve(&mint)) < l.ema_price * 98 / 100);
    let spend = l.window_buy_cap / 8;
    let big = spend * 2;
    env.svm.airdrop(&authority, big).unwrap();
    ok(env.agent_buy_pump(&launch, spend, 0));
    let l2 = env.launch_at(&launch);
    assert_eq!(l2.vault_sol, l.vault_sol - spend + big);
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol + spend);
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

/// `initial_vault_sol` of the live pump launch on mainnet: `bundle_sol + vault_sol` of its
/// `Launched` event (tx TnjK9WUNYgYUtcrWaVDC6J7YQMLNjrKsnopjEDCPLJbRsEQkyHbfY8aWkF2kVyVhhocsUEa4iJWUtGR2yyYPnkN):
/// 670_526_969 + 301_898_751.
const HFPUMP_INITIAL_VAULT_SOL: u64 = 972_425_720;

#[test]
fn migrate_launch_converts_mainnet_layout() {
    use moshsol::state::{LaunchV2, PlatformV2};
    // The platform and every launch exactly as they sit on mainnet before the upgrade (a live
    // Holdfast launch, a live pump launch, a raising pump launch and a refunding Holdfast
    // launch), with the admin swapped for the test admin (the real one is the Squads vault).
    let mut env = Env::bare();
    // Mainnet's rent (SIMD lowered it to 2540 lamports per byte-year); the fixtures hold exactly
    // that, so the realloc's rent top-up must be computed against it.
    env.svm.set_sysvar(&solana_sdk::rent::Rent { lamports_per_byte_year: 2_540, exemption_threshold: 2.0, burn_percent: 50 });
    let admin = env.admin.insecure_clone();
    let (platform_key, mut platform_acct) = fixture_account("mainnet/449KHjhaaW58syfaWstZDzcUwTW613XbVB7S6Zp1gpZe");
    assert_eq!(platform_key, platform_pda());
    assert_eq!(platform_acct.data.len(), 8 + PlatformV2::INIT_SPACE);
    platform_acct.data[8..40].copy_from_slice(admin.pubkey().as_ref());
    let old_platform = PlatformV2::deserialize(&mut &platform_acct.data[8..]).unwrap();
    env.svm.set_account(platform_key, platform_acct).unwrap();
    let launches = [
        ("mainnet/ChpzEmQQQmuoS93AhcG7P8NRRbHJ4Hnx2Hs6ty1kNGD8", 0),
        ("mainnet/Yw9a3uqxNVDhfD7FBmcbAeZAn81nRuG3Q1K3GDLJfYs", HFPUMP_INITIAL_VAULT_SOL),
        ("mainnet/6CdsFZzsBjgfos8yw174b7xFcxLBB4Npfdy39KxSJ9Rt", 0),
        ("mainnet/HNCt4NhEAvJaZAfQVDP8nEJcATLYA3nFVzAk3YRDKNTj", 0),
    ]
    .map(|(name, initial)| {
        let (k, a) = fixture_account(name);
        assert_eq!(a.data.len(), 8 + LaunchV2::INIT_SPACE);
        env.svm.set_account(k, a.clone()).unwrap();
        (k, a, initial)
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
    assert_eq!((p.fee_recipient, p.agent_authority), (old_platform.fee_recipient, old_platform.agent_authority));
    assert_eq!((p.launch_count, p.bump), (old_platform.launch_count, old_platform.bump));
    assert_eq!(p.params.holdfast_curve_enabled, old_platform.params.holdfast_curve_enabled);
    assert_eq!(p.params.buyback_mint, old_platform.params.buyback_mint);
    assert_eq!(p.params.trade_fee_bps, old_platform.params.trade_fee_bps);
    assert_eq!(p.params.max_wallet_deposit_lamports, old_platform.params.max_wallet_deposit_lamports);
    assert_eq!(p.params.burn_share_bps, DEFAULT_BURN_SHARE_BPS);
    assert_eq!(p.params.creator_fee_vault_bps, DEFAULT_CREATOR_FEE_VAULT_BPS);
    assert_eq!(p.params.payout_mult_bps, DEFAULT_PAYOUT_MULT_BPS);
    assert_eq!(p.params.payout_share_bps, DEFAULT_PAYOUT_SHARE_BPS);
    assert_eq!(p.params.payout_interval_secs, DEFAULT_PAYOUT_INTERVAL_SECS);
    assert_eq!(p.params.dead_holders_bps, DEFAULT_DEAD_HOLDERS_BPS);
    assert_eq!(p.params.min_vault_sol, DEFAULT_MIN_VAULT_SOL);
    p.params.validate().unwrap();
    assert_eq!(p.dev_authority, Pubkey::default(), "the dev key starts disabled");
    assert_eq!(env.svm.get_account(&platform_key).unwrap().data.len(), 8 + moshsol::state::Platform::INIT_SPACE);
    assert_err(env.migrate_platform(&admin), MoshError::AlreadyMigrated);

    for (key, old, initial) in launches {
        let v2 = LaunchV2::deserialize(&mut &old.data[8..]).unwrap();
        assert_err(env.migrate_launch(&stranger, &key, initial), MoshError::Unauthorized);
        if v2.venue == Venue::Pump && v2.status == LaunchStatus::Live {
            // The caller's value is bounded by what the raise could have left.
            assert_err(env.migrate_launch(&admin, &key, v2.bundle_sol - 1), MoshError::InvalidParam);
            assert_err(env.migrate_launch(&admin, &key, v2.raised), MoshError::InvalidParam);
        }
        let admin_before = env.lamports(&admin.pubkey());
        let meta = ok(env.migrate_launch(&admin, &key, initial));
        eprintln!("CU migrate_launch: {}", meta.compute_units_consumed);
        let l = env.launch_at(&key);
        let acct = env.svm.get_account(&key).unwrap();
        assert_eq!(acct.data.len(), 8 + moshsol::state::Launch::INIT_SPACE);
        // Every old field survives at its old value...
        assert_eq!((l.index, l.creator, l.mint, l.status), (v2.index, v2.creator, v2.mint, v2.status));
        assert_eq!((l.bump, l.curve_bump, l.vault_bump), (v2.bump, v2.curve_bump, v2.vault_bump));
        assert_eq!((l.created_at, l.launched_at), (v2.created_at, v2.launched_at));
        assert_eq!(l.terms.trade_fee_bps, v2.terms.trade_fee_bps);
        assert_eq!(l.terms.backer_fee_share_bps, v2.terms.backer_fee_share_bps);
        assert_eq!(l.terms.creator_fee_share_bps, v2.terms.creator_fee_share_bps);
        assert_eq!(l.terms.launch_fee_bps, v2.terms.launch_fee_bps);
        assert_eq!(l.terms.agent_buy_bps_per_window, v2.terms.agent_buy_bps_per_window);
        assert_eq!(l.terms.agent_sell_bps_per_window, v2.terms.agent_sell_bps_per_window);
        assert_eq!(l.terms.agent_max_impact_bps, v2.terms.agent_max_impact_bps);
        assert_eq!(l.terms.agent_band_bps, v2.terms.agent_band_bps);
        assert_eq!(l.terms.agent_window_secs, v2.terms.agent_window_secs);
        assert_eq!(l.terms.ema_period_secs, v2.terms.ema_period_secs);
        assert_eq!((l.raise_min, l.raise_max, l.max_per_wallet, l.raise_deadline), (v2.raise_min, v2.raise_max, v2.max_per_wallet, v2.raise_deadline));
        assert_eq!((l.raised, l.refunded, l.backer_count, l.whitelist_root), (v2.raised, v2.refunded, v2.backer_count, v2.whitelist_root));
        assert_eq!((l.bundle_supply_bps, l.reserve_bps), (v2.bundle_supply_bps, v2.reserve_bps));
        assert_eq!((l.virtual_sol, l.real_sol, l.token_reserve), (v2.virtual_sol, v2.real_sol, v2.token_reserve));
        assert_eq!((l.vault_sol, l.vault_tokens, l.bundle_sol, l.bundle_tokens, l.vault_cost_sol), (v2.vault_sol, v2.vault_tokens, v2.bundle_sol, v2.bundle_tokens, v2.vault_cost_sol));
        assert_eq!((l.acc_fee_per_share, l.backer_fees_accrued, l.backer_fees_claimed), (v2.acc_fee_per_share, v2.backer_fees_accrued, v2.backer_fees_claimed));
        assert_eq!((l.creator_fees_unclaimed, l.creator_fees_claimed, l.platform_fees_unclaimed), (v2.creator_fees_unclaimed, v2.creator_fees_claimed, v2.platform_fees_unclaimed));
        assert_eq!((l.window_start, l.window_buy_cap, l.window_sol_spent, l.window_sell_cap, l.window_tokens_sold), (v2.window_start, v2.window_buy_cap, v2.window_sol_spent, v2.window_sell_cap, v2.window_tokens_sold));
        assert_eq!((l.ema_price, l.last_trade_ts, l.agent_buys, l.agent_sells), (v2.ema_price, v2.last_trade_ts, v2.agent_buys, v2.agent_sells));
        assert_eq!((l.agent_sol_spent, l.agent_sol_received, l.agent_tokens_sold), (v2.agent_sol_spent, v2.agent_sol_received, v2.agent_tokens_sold));
        assert_eq!((l.volume_sol, l.trade_count, l.last_public_trade_slot, l.last_agent_trade_slot), (v2.volume_sol, v2.trade_count, v2.last_public_trade_slot, v2.last_agent_trade_slot));
        assert_eq!((l.venue, l.create_key, l.pump), (v2.venue, v2.create_key, v2.pump));
        assert_eq!((l.buyback_pool_sol, l.creator_fees_collected, l.burned_sol, l.burned_tokens, l.last_buyback_ts), (v2.buyback_pool_sol, v2.creator_fees_collected, v2.burned_sol, v2.burned_tokens, v2.last_buyback_ts));
        assert_eq!((&l.name, &l.symbol, &l.uri), (&v2.name, &v2.symbol, &v2.uri));
        assert_eq!(key, Pubkey::create_program_address(&[LAUNCH_SEED, l.create_key.as_ref(), &[l.bump]], &moshsol::ID).unwrap());
        // ...the payback terms take their defaults (the burn share included: 25% → 15%)...
        assert_eq!(l.terms.burn_share_bps, DEFAULT_BURN_SHARE_BPS);
        assert_eq!(l.terms.creator_fee_vault_bps, DEFAULT_CREATOR_FEE_VAULT_BPS);
        assert_eq!(l.terms.payout_mult_bps, DEFAULT_PAYOUT_MULT_BPS);
        assert_eq!(l.terms.payout_share_bps, DEFAULT_PAYOUT_SHARE_BPS);
        assert_eq!(l.terms.payout_interval_secs, DEFAULT_PAYOUT_INTERVAL_SECS);
        assert_eq!(l.terms.dead_holders_bps, DEFAULT_DEAD_HOLDERS_BPS);
        assert_eq!(l.terms.min_vault_sol, DEFAULT_MIN_VAULT_SOL);
        // ...and the payback fields are backfilled: bundle + reserve at launch, clock at launch.
        let expected_initial = match (l.status, l.venue) {
            (LaunchStatus::Live, Venue::Holdfast) => l.raised - l.raised * l.terms.launch_fee_bps as u64 / 10_000,
            (LaunchStatus::Live, Venue::Pump) => initial,
            _ => 0,
        };
        assert_eq!(l.initial_vault_sol, expected_initial);
        if l.status == LaunchStatus::Live {
            assert!(l.initial_vault_sol >= l.bundle_sol && l.initial_vault_sol > 0);
        }
        assert_eq!((l.backers_repaid, l.backer_payouts, l.last_payout_ts), (0, 0, l.launched_at));
        eprintln!("migrated {key} {}: {:?} {:?}, raised {}, initial_vault_sol {}", l.symbol, l.status, l.venue, l.raised, l.initial_vault_sol);
        // The admin paid exactly the extra rent; the launch's own lamports are untouched.
        let rent_old = env.svm.minimum_balance_for_rent_exemption(old.data.len());
        let rent_new = env.svm.minimum_balance_for_rent_exemption(acct.data.len());
        assert_eq!(admin_before - env.lamports(&admin.pubkey()), rent_new - rent_old + 5_000);
        assert_eq!(acct.lamports, old.lamports + rent_new - rent_old);
        assert!(acct.lamports >= rent_new + l.owed_lamports(), "mainnet accounting holds after migration");
        assert_err(env.migrate_launch(&admin, &key, initial), MoshError::AlreadyMigrated);
    }
    assert_eq!(env.platform().launch_count, 4);
}

/// The platform as it sits on mainnet before the dev-key upgrade (270 bytes, dumped
/// 2026-10-01) gains the 32-byte dev key, disabled, every other byte kept; the admin pays the
/// rent delta; then the admin can turn the dev key on and raise the bundle cap.
#[test]
fn migrate_platform_appends_dev_key_to_current_mainnet_layout() {
    use moshsol::state::{Platform, PlatformV3};
    let mut env = Env::bare();
    env.svm.set_sysvar(&solana_sdk::rent::Rent { lamports_per_byte_year: 2_540, exemption_threshold: 2.0, burn_percent: 50 });
    let admin = env.admin.insecure_clone();
    let (key, mut acct) = fixture_account("mainnet-v3/449KHjhaaW58syfaWstZDzcUwTW613XbVB7S6Zp1gpZe");
    assert_eq!(key, platform_pda());
    assert_eq!(acct.data.len(), 8 + PlatformV3::INIT_SPACE);
    acct.data[8..40].copy_from_slice(admin.pubkey().as_ref());
    let old = PlatformV3::deserialize(&mut &acct.data[8..]).unwrap();
    let old_acct = acct.clone();
    env.svm.set_account(key, acct).unwrap();

    // Nothing reads the old layout; only the admin migrates.
    assert_anchor_err(
        env.set_dev_authority(&admin, admin.pubkey()),
        anchor_lang::error::ErrorCode::AccountDidNotDeserialize,
    );
    let stranger = env.user(2);
    assert_err(env.migrate_platform(&stranger), MoshError::Unauthorized);
    let admin_before = env.lamports(&admin.pubkey());
    let meta = ok(env.migrate_platform(&admin));
    eprintln!("CU migrate_platform (v3): {}", meta.compute_units_consumed);
    let new_acct = env.svm.get_account(&key).unwrap();
    assert_eq!(new_acct.data.len(), 8 + Platform::INIT_SPACE);
    assert_eq!(new_acct.data[..old_acct.data.len()], old_acct.data[..], "every old byte kept");
    let p = env.platform();
    assert_eq!((p.admin, p.pending_admin, p.fee_recipient, p.agent_authority), (old.admin, old.pending_admin, old.fee_recipient, old.agent_authority));
    assert_eq!((p.params, p.launch_count, p.bump), (old.params, old.launch_count, old.bump));
    assert_eq!(p.dev_authority, Pubkey::default());
    let rent_delta = env.svm.minimum_balance_for_rent_exemption(new_acct.data.len())
        - env.svm.minimum_balance_for_rent_exemption(old_acct.data.len());
    assert_eq!(new_acct.lamports, old_acct.lamports + rent_delta);
    assert_eq!(admin_before - env.lamports(&admin.pubkey()), rent_delta + 5_000);
    assert_err(env.migrate_platform(&admin), MoshError::AlreadyMigrated);

    // What the mainnet migration transaction does next: set the dev key, raise the bundle cap.
    let dev = env.user(1);
    ok(env.set_dev_authority(&admin, dev.pubkey()));
    assert_eq!(env.platform().dev_authority, dev.pubkey());
    let mut params = p.params;
    params.max_bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS;
    ok(env.update_platform(&admin, params));
    assert_eq!(env.platform().params.max_bundle_supply_bps, 7_500);
}

#[test]
fn wind_down_pump_sells_vault_into_venue_for_backers() {
    let mut env = pump_env();
    let (_c, launch, mint, backers) = env.live_pump_launch(&[10 * SOL, 10 * SOL]);
    let cranker = env.user(2);
    assert_err(env.wind_down_pump(&cranker, &launch), MoshError::LaunchTooYoung);
    env.warp(WIND_DOWN_MIN_AGE_SECS);
    // Outside holders over 5% of supply block it; at most 5% don't.
    let holder = public_pump(&mut env, &mint, 3 * SOL);
    let held = env.spl_balance(&spl_ata(&holder.pubkey(), &mint));
    let threshold = moshsol::math::bps(env.spl_mint_supply(&mint), DEFAULT_DEAD_HOLDERS_BPS).unwrap();
    assert!(held > threshold, "holder {held} over the threshold {threshold}");
    assert_err(env.wind_down_pump(&cranker, &launch), MoshError::OutsideHolders);
    ok(env.pump_public_sell(&holder, &mint, held - threshold));
    assert_eq!(env.spl_balance(&spl_ata(&holder.pubkey(), &mint)), threshold);

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
    assert_eq!((l.vault_sol, l.vault_tokens, l.vault_cost_sol), (0, 0, 0));
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

/// The wind-down sale is floored at 97% of the fee-free quote from the reserves it finds: a
/// venue keeping more than that fails the instruction and leaves the launch as it was, to be
/// retried. The reference is in-transaction, so a holder's pre-sell in the same bundle moves the
/// quote and the sale alike (that exposure is bounded by the outside-holder cap).
#[test]
fn wind_down_pump_fails_short_of_its_floor_and_can_be_retried() {
    let mut env = pump_env();
    let (_c, launch, mint, _backers) = env.live_pump_launch(&[10 * SOL, 10 * SOL]);
    let cranker = env.user(2);
    env.warp(WIND_DOWN_MIN_AGE_SECS);
    let holder = public_pump(&mut env, &mint, 3 * SOL);
    let held = env.spl_balance(&spl_ata(&holder.pubkey(), &mint));
    let threshold = moshsol::math::bps(env.spl_mint_supply(&mint), DEFAULT_DEAD_HOLDERS_BPS).unwrap();
    ok(env.pump_public_sell(&holder, &mint, held - threshold));
    let l0 = env.launch_at(&launch);
    let vault_ata = spl_ata(&pump_authority_pda(&launch), &mint);

    // The venue keeps 4.3% instead of 1.25%: the fill lands under the floor and nothing moves.
    env.set_pump_protocol_fee_bps(400);
    let failed = env.wind_down_pump(&cranker, &launch).expect_err("fill short of the floor");
    assert!(
        failed.meta.logs.iter().any(|l| l.contains("TooLittleSolReceived")),
        "the venue refused the program's floor:\n{}",
        failed.meta.logs.join("\n")
    );
    let l = env.launch_at(&launch);
    assert_eq!((l.status, l.vault_sol, l.vault_tokens, l.vault_cost_sol), (LaunchStatus::Live, l0.vault_sol, l0.vault_tokens, l0.vault_cost_sol));
    assert_eq!(env.spl_balance(&vault_ata), l0.vault_tokens);
    env.assert_pump_invariants(&launch);

    // Back to the venue's fee, after the holder sold everything (a bundle's first leg): the
    // retry sells into the reserves as they are and clears the floor measured from them.
    env.set_pump_protocol_fee_bps(95);
    ok(env.pump_public_sell(&holder, &mint, threshold));
    let curve = env.curve(&mint);
    let quote = moshsol::math::sol_out(curve.virtual_sol_reserves, curve.virtual_token_reserves, l0.vault_tokens).unwrap();
    ok(env.wind_down_pump(&cranker, &launch));
    let l = env.launch_at(&launch);
    assert_eq!(l.status, LaunchStatus::WoundDown);
    let proceeds = l.backer_fees_accrued - l0.vault_sol;
    assert!(proceeds >= quote * 97 / 100 && proceeds < quote, "{proceeds} vs quote {quote}");
    env.assert_pump_invariants(&launch);
}

/// Anyone can create the pump authority's WSOL ATA ahead of a PumpSwap trade and park lamports
/// on it, wrapped or not. Everything on it is vault SOL once the trade closes the account, and
/// none of it passes for the fill — a balance above the agent's spend must not fail the buy,
/// and on a sell it is not agent proceeds.
#[test]
fn prefunded_authority_wsol_account_is_donated_not_a_fill() {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[10 * SOL]);
    let cranker = env.user(2);
    let whale = env.user(200);
    let left = env.curve(&mint).real_token_reserves;
    ok(env.pump_public_buy_tokens(&whale, &mint, left, 120 * SOL));
    ok(env.pump_migrate(&cranker, &mint));
    ok(env.graduate_pump(&cranker, &launch));
    let authority = pump_authority_pda(&launch);
    let stranger = env.user(10);

    // Agent sell into a rally (the EMA lags the migration price), with a wrapped balance parked.
    env.warp(60);
    ok(env.amm_public_buy(&whale, &mint, 10 * SOL));
    let l0 = env.launch_at(&launch);
    let wsol = env.create_spl_ata(&stranger, &authority, &WSOL_MINT);
    env.svm.airdrop(&wsol, SOL).unwrap();
    ok(env.send(&[spl_token::instruction::sync_native(&TOKEN_ID, &wsol).unwrap()], &[&stranger]));
    assert_eq!(env.spl_balance(&wsol), SOL);
    let parked = env.lamports(&wsol);
    ok(env.agent_sell_pump(&launch, l0.window_sell_cap / 4, 0));
    let l1 = env.launch_at(&launch);
    let fill = l1.agent_sol_received - l0.agent_sol_received;
    assert!(fill > 0);
    assert_eq!(l1.vault_sol, l0.vault_sol + fill + parked, "the fill is what the venue paid; the rest is donated");
    assert_eq!(env.lamports(&wsol), 0, "closed after the trade");
    env.assert_pump_invariants(&launch);

    // Agent buy-back after a dump, with more parked (unwrapped) than the agent spends.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens));
    let l2 = env.launch_at(&launch);
    let spend = l2.window_buy_cap / 2;
    let wsol = env.create_spl_ata(&stranger, &authority, &WSOL_MINT);
    env.svm.airdrop(&wsol, spend * 2).unwrap();
    let parked = env.lamports(&wsol);
    ok(env.agent_buy_pump(&launch, spend, 0));
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.vault_sol, l2.vault_sol - spend + parked, "spent `spend`; the parked lamports (rent included) are vault SOL");
    assert_eq!(l3.vault_cost_sol, l2.vault_cost_sol + spend);
    assert!(l3.vault_tokens > l2.vault_tokens);
    assert_eq!(env.lamports(&wsol), 0);
    env.assert_pump_invariants(&launch);
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
fn dev_withdraw_works_on_pump_vault() {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[20 * SOL]);
    let admin = env.admin.insecure_clone();
    let dev = env.user(2);
    let stranger = env.user(2);
    assert_err(env.dev_withdraw_pump(&dev, &launch, SOL, 0), MoshError::DevKeyDisabled);
    ok(env.set_dev_authority(&admin, dev.pubkey()));
    assert_err(env.dev_withdraw_pump(&stranger, &launch, SOL, 0), MoshError::Unauthorized);
    // Works while the agent is paused (the emergency path).
    let mut params = env.platform().params;
    params.agents_paused = true;
    ok(env.update_platform(&admin, params));
    let l = env.launch_at(&launch);
    let curve_before = env.curve(&mint);
    let dev_before = env.lamports(&dev.pubkey());
    let meta = ok(env.dev_withdraw_pump(&dev, &launch, l.vault_sol / 2, l.vault_tokens / 4));
    eprintln!("CU dev_withdraw_vault (pump): {}", meta.compute_units_consumed);
    let l2 = env.launch_at(&launch);
    // The dev's ATA exists since the first (refused) attempt: only the two tx fees are paid.
    assert_eq!(env.lamports(&dev.pubkey()) + 2 * 5_000 - dev_before, l.vault_sol / 2);
    assert_eq!(env.spl_balance(&spl_ata(&dev.pubkey(), &mint)), l.vault_tokens / 4);
    assert_eq!(l2.vault_tokens, l.vault_tokens - l.vault_tokens / 4);
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol - (l.vault_cost_sol as u128 * (l.vault_tokens / 4) as u128).div_ceil(l.vault_tokens as u128) as u64);
    assert_eq!((l2.buyback_pool_sol, l2.backer_fees_accrued), (l.buyback_pool_sol, l.backer_fees_accrued));
    let curve = env.curve(&mint);
    assert_eq!((curve.real_token_reserves, curve.real_sol_reserves), (curve_before.real_token_reserves, curve_before.real_sol_reserves));
    env.assert_pump_invariants(&launch);
}

/// The bundle follows the raise: any cap up to the 75% hard maximum is accepted (the platform
/// max included), and a big raise with no reserve buys exactly the cap without completing the
/// curve, the rest staying as vault SOL.
#[test]
fn pump_bundle_follows_the_raise_up_to_the_platform_max() {
    let mut env = pump_env();
    let admin = env.admin.insecure_clone();
    let mut params = env.platform().params;
    params.max_bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS + 1;
    assert_err(env.update_platform(&admin, params), MoshError::InvalidParam);
    params.max_bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS;
    ok(env.update_platform(&admin, params));
    let creator = env.user(5);
    let mut args = default_pump_args();
    args.bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS + 1;
    assert_err(env.create_pump(&creator, args).1, MoshError::InvalidParam);

    // 50 SOL, default 30% reserve, no cap below the max: the budget binds, far above 25%.
    let mut args = default_pump_args();
    args.bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS;
    let launch = env.create_pump_ok(&creator, args);
    let b = env.user(52);
    ok(env.deposit_at(&b, &launch, 50 * SOL));
    let (mint, res) = env.launch_pump(&creator, &launch);
    ok(res);
    let l = env.launch_at(&launch);
    let pct = l.bundle_tokens as f64 / TOTAL_SUPPLY as f64 * 100.0;
    eprintln!("50 SOL raise, 30% reserve: bundle {:.2}% of supply for {} lamports", pct, l.bundle_sol);
    assert!(l.bundle_tokens > TOTAL_SUPPLY / 4 && l.bundle_tokens < TOTAL_SUPPLY * 3 / 4, "bundle {pct}%");
    assert!(!env.curve(&mint).complete);
    env.assert_pump_invariants(&launch);

    // 110 SOL with no reserve: the 75% cap binds exactly, the curve stays open.
    let mut args = default_pump_args();
    args.bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS;
    args.reserve_bps = 0;
    args.raise_max = 110 * SOL;
    let launch = env.create_pump_ok(&creator, args);
    let b = env.user(112);
    ok(env.deposit_at(&b, &launch, 110 * SOL));
    let (mint, res) = env.launch_pump(&creator, &launch);
    ok(res);
    let l = env.launch_at(&launch);
    eprintln!("110 SOL raise, no reserve: bundle {} tokens for {} lamports, vault {} lamports", l.bundle_tokens, l.bundle_sol, l.vault_sol);
    assert_eq!(l.bundle_tokens, TOTAL_SUPPLY * 3 / 4);
    assert!(l.vault_sol > 0 && l.vault_sol == l.initial_vault_sol - l.bundle_sol);
    let curve = env.curve(&mint);
    assert!(!curve.complete);
    assert_eq!(curve.real_token_reserves, 793_100_000 * 1_000_000 - l.bundle_tokens);
    env.assert_pump_invariants(&launch);
}

/// If pump.fun ever shipped a curve with fewer sellable tokens than the bundle cap, a raise big
/// enough to buy them all stops one base unit short: the bundle never completes the curve at
/// launch, and what it didn't spend stays as vault SOL.
#[test]
fn pump_bundle_never_completes_the_curve_at_launch() {
    let mut env = pump_env();
    let admin = env.admin.insecure_clone();
    let real = 500_000_000 * 1_000_000u64;
    let global = pump_global();
    let mut acct = env.svm.get_account(&global).unwrap();
    // `Global.initial_real_token_reserves` (after the discriminator, `initialized`, `authority`,
    // `fee_recipient`, the two initial virtual reserves).
    assert_eq!(u64::from_le_bytes(acct.data[89..97].try_into().unwrap()), 793_100_000 * 1_000_000);
    acct.data[89..97].copy_from_slice(&real.to_le_bytes());
    env.svm.set_account(global, acct).unwrap();
    let mut params = env.platform().params;
    params.max_bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS;
    ok(env.update_platform(&admin, params));

    let creator = env.user(5);
    let mut args = default_pump_args();
    args.bundle_supply_bps = MAX_BUNDLE_SUPPLY_BPS;
    args.reserve_bps = 0;
    args.raise_max = 110 * SOL;
    let launch = env.create_pump_ok(&creator, args);
    let b = env.user(112);
    ok(env.deposit_at(&b, &launch, 110 * SOL));
    let (mint, res) = env.launch_pump(&creator, &launch);
    ok(res);
    let l = env.launch_at(&launch);
    let curve = env.curve(&mint);
    assert_eq!(l.bundle_tokens, real - 1);
    assert_eq!(curve.real_token_reserves, 1);
    assert!(!curve.complete, "the bundle must not complete the curve");
    assert!(l.vault_sol > 10 * SOL, "the unspent budget stays as vault SOL: {}", l.vault_sol);
    assert_eq!(l.vault_sol, l.initial_vault_sol - l.bundle_sol);
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
    assert_eq!(
        l1.vault_sol,
        l0.vault_sol + l1.agent_sol_received - l0.agent_sol_received + 1,
        "the lamport parked on the WSOL address is donated, not part of the fill"
    );
    assert_eq!(env.svm.get_account(&authority_wsol).map(|a| a.lamports).unwrap_or(0), 0, "transient WSOL account closed");
    env.assert_pump_invariants(&launch);

    // PumpSwap creator fees (WSOL) collect into the launch too.
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens / 10));
    let meta = ok(env.collect_pump_fees(&cranker, &launch));
    eprintln!("CU collect_pump_fees (pool): {}", meta.compute_units_consumed);
    let l2 = env.launch_at(&launch);
    assert!(l2.creator_fees_collected > 0);
    assert_eq!(l2.buyback_pool_sol - l1.buyback_pool_sol, l2.creator_fees_collected * DEFAULT_BURN_SHARE_BPS as u64 / 10_000);
    env.assert_pump_invariants(&launch);

    // Agent buy on PumpSwap after a dump.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens * 9 / 10));
    let l3 = env.launch_at(&launch);
    let spend = l3.window_buy_cap / 2;
    let meta = ok(env.agent_buy_pump(&launch, spend, 0));
    eprintln!("CU agent_buy_pump (pool): {}", meta.compute_units_consumed);
    let l4 = env.launch_at(&launch);
    assert_eq!(l4.vault_sol, l3.vault_sol - spend);
    assert!(l4.vault_tokens > l3.vault_tokens);
    env.assert_pump_invariants(&launch);

    // Buyback on PumpSwap: `graduated_pool_prices_on_effective_quote_reserves`.
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

// ---------------- agent wallets (executors) ----------------

/// 15 funded wallets registered as the platform's agent wallets.
fn register_executors(env: &mut Env) -> Vec<solana_sdk::signature::Keypair> {
    let wallets: Vec<_> = (0..15).map(|_| env.user(1)).collect();
    let mut keys = [Pubkey::default(); 15];
    for (k, w) in keys.iter_mut().zip(&wallets) {
        *k = w.pubkey();
    }
    let admin = env.admin.insecure_clone();
    ok(env.set_agent_executors(&admin, keys));
    wallets
}

/// The `Trade` events a transaction emitted.
fn trades(meta: &litesvm::types::TransactionMetadata) -> Vec<moshsol::events::Trade> {
    use anchor_lang::Discriminator;
    use base64::Engine;
    meta.logs
        .iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|d| base64::engine::general_purpose::STANDARD.decode(d).ok())
        .filter(|b| b.len() > 8 && b[..8] == *moshsol::events::Trade::DISCRIMINATOR)
        .map(|b| moshsol::events::Trade::deserialize(&mut &b[8..]).unwrap())
        .collect()
}

/// The agent wallet ends the trade exactly as it started, but for the fee it paid as payer.
fn assert_wallet_untouched(env: &Env, wallet: &Pubkey, mint: &Pubkey, lamports_before: u64) {
    assert_eq!(lamports_before - env.lamports(wallet), 10_000, "only the two-signature fee left the wallet");
    assert!(env.svm.get_account(&spl_ata(wallet, mint)).map_or(true, |a| a.lamports == 0), "token account closed");
    assert!(env.svm.get_account(&spl_ata(wallet, &WSOL_MINT)).map_or(true, |a| a.lamports == 0), "no WSOL account left");
}

#[test]
fn set_agent_executors_is_admin_only_and_rejects_duplicates() {
    let mut env = pump_env();
    assert!(!env.platform().has_agent_executors());
    let a = env.user(1);
    let b = env.user(1);
    let mut keys = [Pubkey::default(); 15];
    keys[0] = a.pubkey();
    keys[7] = b.pubkey();
    let stranger = env.user(1);
    assert_err(env.set_agent_executors(&stranger, keys), MoshError::Unauthorized);
    let agent = env.agent.insecure_clone();
    assert_err(env.set_agent_executors(&agent, keys), MoshError::Unauthorized);
    let admin = env.admin.insecure_clone();
    let mut dup = keys;
    dup[14] = a.pubkey();
    assert_err(env.set_agent_executors(&admin, dup), MoshError::InvalidParam);
    ok(env.set_agent_executors(&admin, keys));
    let p = env.platform();
    assert_eq!(p.agent_executors, keys);
    assert!(p.is_agent_executor(&a.pubkey()) && p.is_agent_executor(&b.pubkey()));
    assert!(!p.is_agent_executor(&stranger.pubkey()) && !p.is_agent_executor(&Pubkey::default()));
    // All default unsets them again.
    ok(env.set_agent_executors(&admin, [Pubkey::default(); 15]));
    assert!(!env.platform().has_agent_executors());
}

#[test]
fn agent_trades_through_registered_wallets_on_the_curve() {
    let mut env = pump_env();
    let (_creator, launch, mint, _backers) = env.live_pump_launch(&[10 * SOL, 10 * SOL]);
    let l0 = env.launch_at(&launch);
    let outsider = env.user(1);
    // No wallets registered: none may be used, the pump authority trades itself.
    assert_err(env.agent_sell_pump_via(&outsider, &launch, l0.window_sell_cap / 10, 0), MoshError::ExecutorNotRegistered);
    let wallets = register_executors(&mut env);
    let (w1, w2) = (wallets[0].insecure_clone(), wallets[14].insecure_clone());
    // Registered: every trade goes through one of them, and only through a registered one.
    assert_err(env.agent_sell_pump(&launch, l0.window_sell_cap / 10, 0), MoshError::ExecutorRequired);
    assert_err(env.agent_sell_pump_via(&outsider, &launch, l0.window_sell_cap / 10, 0), MoshError::ExecutorNotRegistered);
    // Every rule still applies: no rally yet, no dip either.
    assert_err(env.agent_sell_pump_via(&w1, &launch, l0.window_sell_cap / 10, 0), MoshError::AgentSellNotRally);
    assert_err(env.agent_buy_pump_via(&w1, &launch, l0.window_buy_cap / 10, 0), MoshError::AgentBuyNotDip);

    env.warp(60);
    let whale = public_pump(&mut env, &mint, 20 * SOL);
    assert_err(env.agent_sell_pump_via(&w1, &launch, l0.window_sell_cap + 1, 0), MoshError::AgentWindowLimit);
    assert!(env.agent_sell_pump_via(&w1, &launch, l0.window_sell_cap / 4, 100 * SOL).is_err(), "venue slippage");
    // The agent authority must still sign: a wallet alone can't trade the vault.
    let stranger = env.user(2);
    let ix = solana_sdk::instruction::Instruction {
        program_id: moshsol::ID,
        accounts: {
            let mut m = moshsol::accounts::AgentTradePump {
                agent: stranger.pubkey(),
                platform: platform_pda(),
                launch,
                mint,
                pump_authority: pump_authority_pda(&launch),
                vault_tokens: spl_ata(&pump_authority_pda(&launch), &mint),
                token_program: TOKEN_ID,
                system_program: anchor_lang::system_program::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                executor: Some(w1.pubkey()),
                executor_tokens: Some(spl_ata(&w1.pubkey(), &mint)),
            }
            .to_account_metas(None);
            m.extend(env.venue_accounts_for(&launch, &w1.pubkey()));
            m
        },
        data: anchor_lang::InstructionData::data(&moshsol::instruction::AgentSellPump { tokens_in: 1_000_000, min_sol_out: 0 }),
    };
    assert_err(env.send(&[ix], &[&w1, &stranger]), MoshError::Unauthorized);

    // Rally sell through w1: tokens go vault → wallet → curve, the SOL comes back to the vault.
    let chunk = l0.window_sell_cap / 4;
    let w1_before = env.lamports(&w1.pubkey());
    let meta = ok(env.agent_sell_pump_via(&w1, &launch, chunk, 0));
    eprintln!("CU agent_sell_pump via wallet: {}", meta.compute_units_consumed);
    let l1 = env.launch_at(&launch);
    assert_eq!(l1.vault_tokens, l0.vault_tokens - chunk);
    assert_eq!(l1.agent_sells, 1);
    let received = l1.agent_sol_received;
    let cost = (l0.vault_cost_sol as u128 * chunk as u128).div_ceil(l0.vault_tokens as u128) as u64;
    assert!(received > cost, "the rally sell realized a profit");
    assert_eq!(l1.vault_sol, l0.vault_sol + received);
    assert_eq!(l1.vault_cost_sol, l0.vault_cost_sol - cost);
    assert_wallet_untouched(&env, &w1.pubkey(), &mint, w1_before);
    let t = trades(&meta);
    assert_eq!(t.len(), 1);
    assert_eq!((t[0].trader, t[0].is_agent, t[0].is_buy, t[0].sol_amount), (w1.pubkey(), true, false, received));
    env.assert_pump_invariants(&launch);

    // Impact cap through a wallet: a fresh launch frozen with a 0.1% cap.
    let mut p = test_params();
    p.agent_max_impact_bps = 10;
    let admin = env.admin.insecure_clone();
    ok(env.update_platform(&admin, p));
    env.warp(60);
    let (_c2, launch2, mint2, _b2) = env.live_pump_launch(&[10 * SOL]);
    env.warp(60);
    public_pump(&mut env, &mint2, 10 * SOL);
    let l2 = env.launch_at(&launch2);
    assert_err(env.agent_sell_pump_via(&w2, &launch2, l2.window_sell_cap, 0), MoshError::AgentPriceImpact);

    // A dump: the dip buy goes vault SOL → wallet → curve, the tokens land in the vault.
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens));
    let l = env.launch_at(&launch);
    assert_err(env.agent_buy_pump_via(&w2, &launch, l.window_buy_limit().unwrap() - l.window_sol_spent + 1, 0), MoshError::AgentWindowLimit);
    assert_err(env.agent_buy_pump_via(&w2, &launch, l.vault_sol - l.terms.min_vault_sol + 1, 0), MoshError::VaultFloor);
    // Someone creates w2's token account and parks tokens on it: used as found, left as found.
    let parked = 1_000;
    let w2_ata = env.create_spl_ata(&outsider, &w2.pubkey(), &mint);
    let buyer = env.user(3);
    ok(env.pump_public_buy(&buyer, &mint, SOL / 100));
    let ix = spl_token::instruction::transfer(&spl_token::ID, &spl_ata(&buyer.pubkey(), &mint), &w2_ata, &buyer.pubkey(), &[], parked)
        .unwrap();
    ok(env.send(&[ix], &[&buyer]));
    env.warp(1);
    let l = env.launch_at(&launch);
    let spend = l.window_buy_cap / 4;
    let w2_before = env.lamports(&w2.pubkey());
    let meta = ok(env.agent_buy_pump_via(&w2, &launch, spend, 0));
    eprintln!("CU agent_buy_pump via wallet: {}", meta.compute_units_consumed);
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.agent_buys, 1);
    assert_eq!(l3.vault_sol, l.vault_sol - spend);
    assert_eq!(l3.vault_cost_sol, l.vault_cost_sol + spend);
    let bought = l3.vault_tokens - l.vault_tokens;
    assert!(bought > 0);
    assert_eq!(w2_before - env.lamports(&w2.pubkey()), 10_000, "only the fee left the wallet");
    assert_eq!(env.spl_balance(&w2_ata), parked, "the pre-existing token account is left as found");
    let t = trades(&meta);
    assert_eq!((t[0].trader, t[0].is_buy, t[0].sol_amount, t[0].token_amount), (w2.pubkey(), true, spend, bought));
    env.assert_pump_invariants(&launch);
}

#[test]
fn agent_trades_through_registered_wallets_on_pumpswap() {
    let mut env = pump_env();
    let (_c, launch, mint, _backers) = env.live_pump_launch(&[10 * SOL]);
    let cranker = env.user(2);
    let whale = env.user(200);
    let left = env.curve(&mint).real_token_reserves;
    ok(env.pump_public_buy_tokens(&whale, &mint, left, 120 * SOL));
    ok(env.pump_migrate(&cranker, &mint));
    ok(env.graduate_pump(&cranker, &launch));
    let wallets = register_executors(&mut env);
    let w = wallets[3].insecure_clone();
    assert_err(env.agent_sell_pump(&launch, 1_000_000, 0), MoshError::ExecutorRequired);

    env.warp(60);
    ok(env.amm_public_buy(&whale, &mint, 10 * SOL));
    let l0 = env.launch_at(&launch);
    assert_err(env.agent_sell_pump_via(&w, &launch, l0.window_sell_cap + 1, 0), MoshError::AgentWindowLimit);
    let chunk = l0.window_sell_cap / 4;
    let agent_before = env.lamports(&env.agent.pubkey());
    let w_before = env.lamports(&w.pubkey());
    let meta = ok(env.agent_sell_pump_via(&w, &launch, chunk, 0));
    eprintln!("CU agent_sell_pump (pool) via wallet: {}", meta.compute_units_consumed);
    let l1 = env.launch_at(&launch);
    let received = l1.agent_sol_received - l0.agent_sol_received;
    assert!(received > 0);
    assert_eq!(l1.vault_tokens, l0.vault_tokens - chunk);
    assert_eq!(l1.vault_sol, l0.vault_sol + received);
    assert_wallet_untouched(&env, &w.pubkey(), &mint, w_before);
    let agent_after = env.lamports(&env.agent.pubkey());
    // The agent fronts the wallet's one-time PumpSwap volume accumulator, nothing else.
    assert!(agent_before - agent_after < SOL / 100, "agent paid {}", agent_before - agent_after);
    assert_eq!(trades(&meta)[0].trader, w.pubkey());
    env.assert_pump_invariants(&launch);

    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens));
    let l2 = env.launch_at(&launch);
    let w = wallets[9].insecure_clone();
    assert_err(env.agent_buy_pump_via(&w, &launch, l2.window_buy_limit().unwrap() - l2.window_sol_spent + 1, 0), MoshError::AgentWindowLimit);
    let spend = l2.window_buy_cap / 2;
    let w_before = env.lamports(&w.pubkey());
    let meta = ok(env.agent_buy_pump_via(&w, &launch, spend, 0));
    eprintln!("CU agent_buy_pump (pool) via wallet: {}", meta.compute_units_consumed);
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.vault_sol, l2.vault_sol - spend);
    assert!(l3.vault_tokens > l2.vault_tokens);
    assert_wallet_untouched(&env, &w.pubkey(), &mint, w_before);
    let t = trades(&meta);
    assert_eq!((t[0].trader, t[0].is_buy, t[0].token_amount), (w.pubkey(), true, l3.vault_tokens - l2.vault_tokens));
    env.assert_pump_invariants(&launch);
}

/// The live TEST launch on mainnet as dumped on 2026-10-02 at slot 452,750,639, graduated to
/// PumpSwap (`fixtures/mainnet-test-launch`: platform, launch, mint, vault, pool and its token
/// accounts, the coin creator vault and the fee recipients the SDK picked for the failing buy),
/// with the agent authority and agent wallet #1 swapped for test keys. Every agent wallet buy
/// there failed with `InvalidArgument`: wrapping the vault's SOL handed SPL Token's `sync_native`
/// the launch as an extra account, which mainnet's SPL Token (p-token) refuses. Its window buy
/// cap was 0.0175 SOL, snapshotted before sells brought the vault to 2.2 SOL.
#[test]
fn agent_wallet_buys_a_dip_on_the_mainnet_test_pool() {
    use anchor_lang::{AccountDeserialize, AccountSerialize};
    let launch: Pubkey = solana_sdk::pubkey!("EGy86QhJtC58hPzCxR9gY4rqNoGFzkNj8M42sQqcuvqR");
    let protocol_fee_recipient: Pubkey = solana_sdk::pubkey!("7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX");
    let buyback_fee_recipient: Pubkey = solana_sdk::pubkey!("3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR");
    let mut env = pump_env();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/mainnet-test-launch");
    for entry in std::fs::read_dir(dir).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        let (k, a) = fixture_account(&format!("mainnet-test-launch/{}", name.trim_end_matches(".json")));
        env.svm.set_account(k, a).unwrap();
    }
    let mut clock = env.svm.get_sysvar::<solana_sdk::clock::Clock>();
    clock.slot = 452_750_649;
    clock.unix_timestamp = 1_790_981_726;
    env.svm.set_sysvar(&clock);

    let wallet = env.user(1);
    let mut acct = env.svm.get_account(&platform_pda()).unwrap();
    let mut p = moshsol::state::Platform::try_deserialize(&mut acct.data.as_slice()).unwrap();
    assert!(p.has_agent_executors(), "mainnet trades through agent wallets");
    p.agent_authority = env.agent.pubkey();
    p.agent_executors[0] = wallet.pubkey();
    let mut data = Vec::with_capacity(acct.data.len());
    p.try_serialize(&mut data).unwrap();
    acct.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(platform_pda(), acct).unwrap();

    // A dip: spot 6% under the band's buy line.
    let l0 = env.launch_at(&launch);
    let mint = l0.mint;
    assert!(l0.pump.graduated);
    assert_eq!((l0.vault_sol, l0.window_buy_cap, l0.window_sol_spent), (2_200_656_088, 17_465_046, 0));
    let (quote, base) = effective_pool(&env, &mint);
    let spot = moshsol::math::price_q64(quote, base).unwrap();
    env.set_launch_at(&launch, |l| {
        l.ema_price = spot * 10_000 / 9_400 * 10_000 / (10_000 - l.terms.agent_band_bps as u128);
        l.last_trade_ts = clock.unix_timestamp;
    });

    let agent = env.agent.insecure_clone();
    let buy = |env: &mut Env, sol_in: u64| {
        let mut accounts = moshsol::accounts::AgentTradePump {
            agent: agent.pubkey(),
            platform: platform_pda(),
            launch,
            mint,
            pump_authority: pump_authority_pda(&launch),
            vault_tokens: spl_ata(&pump_authority_pda(&launch), &mint),
            token_program: TOKEN_ID,
            system_program: anchor_lang::system_program::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            executor: Some(wallet.pubkey()),
            executor_tokens: Some(spl_ata(&wallet.pubkey(), &mint)),
        }
        .to_account_metas(None);
        accounts.extend(pool_accounts(&mint, &launch, &wallet.pubkey(), &protocol_fee_recipient, &buyback_fee_recipient));
        let ix = solana_sdk::instruction::Instruction {
            program_id: moshsol::ID,
            accounts,
            data: anchor_lang::InstructionData::data(&moshsol::instruction::AgentBuyPump { sol_in, min_tokens_out: 1 }),
        };
        env.send(&[ix], &[&wallet, &agent])
    };

    // Within the snapshotted cap: the buy the agent sent on mainnet.
    let vault_ata = spl_ata(&pump_authority_pda(&launch), &mint);
    let launch_lamports = env.lamports(&launch);
    let w_before = env.lamports(&wallet.pubkey());
    let meta = ok(buy(&mut env, 10_000_000));
    let l1 = env.launch_at(&launch);
    let t = trades(&meta);
    assert_eq!((t[0].trader, t[0].is_buy, t[0].sol_amount), (wallet.pubkey(), true, 10_000_000));
    assert!(t[0].token_amount > 0);
    assert_eq!(l1.vault_sol, l0.vault_sol - 10_000_000);
    assert_eq!(l1.vault_tokens, l0.vault_tokens + t[0].token_amount);
    assert_eq!(env.spl_balance(&vault_ata), l1.vault_tokens, "the vault received the tokens");
    assert_eq!(env.lamports(&launch), launch_lamports - 10_000_000, "the launch paid exactly the fill");
    assert_wallet_untouched(&env, &wallet.pubkey(), &mint, w_before);

    // Past the snapshotted cap: the sells' proceeds count, up to 10% of the vault's SOL plus what
    // the window spent.
    let limit = moshsol::math::bps(l1.vault_sol + l1.window_sol_spent, l1.terms.agent_buy_bps_per_window).unwrap();
    assert_eq!(l1.window_buy_limit().unwrap(), limit);
    assert!(limit > 10 * l1.window_buy_cap);
    let spend = 4 * l1.window_buy_cap;
    ok(buy(&mut env, spend));
    let l2 = env.launch_at(&launch);
    assert_eq!((l2.window_sol_spent, l2.vault_sol), (10_000_000 + spend, l1.vault_sol - spend));
    assert_eq!(l2.window_buy_limit().unwrap(), limit, "the agent's own buys leave the cap where it is");
    assert_err(buy(&mut env, limit - l2.window_sol_spent + 1), MoshError::AgentWindowLimit);
}

/// The platform as it sits on mainnet since the dev-key upgrade (302 bytes, dumped 2026-10-02)
/// gains the 15 agent wallets, unset, every other byte kept; the admin pays the rent delta and
/// then registers the wallets.
#[test]
fn migrate_platform_appends_agent_wallets_to_current_mainnet_layout() {
    use moshsol::state::{Platform, PlatformV4};
    let mut env = Env::bare();
    env.svm.set_sysvar(&solana_sdk::rent::Rent { lamports_per_byte_year: 2_540, exemption_threshold: 2.0, burn_percent: 50 });
    let admin = env.admin.insecure_clone();
    let (key, mut acct) = fixture_account("mainnet-v4/449KHjhaaW58syfaWstZDzcUwTW613XbVB7S6Zp1gpZe");
    assert_eq!(key, platform_pda());
    assert_eq!(acct.data.len(), 8 + PlatformV4::INIT_SPACE);
    acct.data[8..40].copy_from_slice(admin.pubkey().as_ref());
    let old = PlatformV4::deserialize(&mut &acct.data[8..]).unwrap();
    assert_ne!(old.dev_authority, Pubkey::default(), "mainnet has its dev key set");
    let old_acct = acct.clone();
    env.svm.set_account(key, acct).unwrap();

    assert_anchor_err(
        env.set_agent_executors(&admin, [Pubkey::default(); 15]),
        anchor_lang::error::ErrorCode::AccountDidNotDeserialize,
    );
    let stranger = env.user(2);
    assert_err(env.migrate_platform(&stranger), MoshError::Unauthorized);
    let admin_before = env.lamports(&admin.pubkey());
    let meta = ok(env.migrate_platform(&admin));
    eprintln!("CU migrate_platform (v4): {}", meta.compute_units_consumed);
    let new_acct = env.svm.get_account(&key).unwrap();
    assert_eq!(new_acct.data.len(), 8 + Platform::INIT_SPACE);
    assert_eq!(new_acct.data[..old_acct.data.len()], old_acct.data[..], "every old byte kept");
    let p = env.platform();
    assert_eq!((p.admin, p.pending_admin, p.fee_recipient, p.agent_authority), (old.admin, old.pending_admin, old.fee_recipient, old.agent_authority));
    assert_eq!((p.params, p.launch_count, p.bump, p.dev_authority), (old.params, old.launch_count, old.bump, old.dev_authority));
    assert!(!p.has_agent_executors());
    let rent_delta = env.svm.minimum_balance_for_rent_exemption(new_acct.data.len())
        - env.svm.minimum_balance_for_rent_exemption(old_acct.data.len());
    assert_eq!(new_acct.lamports, old_acct.lamports + rent_delta);
    assert_eq!(admin_before - env.lamports(&admin.pubkey()), rent_delta + 5_000);
    assert_err(env.migrate_platform(&admin), MoshError::AlreadyMigrated);

    // What the mainnet migration transaction does next: register the 15 wallets.
    let keys: [Pubkey; 15] = std::array::from_fn(|_| Pubkey::new_unique());
    ok(env.set_agent_executors(&admin, keys));
    assert_eq!(env.platform().agent_executors, keys);
}

// ---------------- lamports parked on transient account addresses ----------------

/// Anyone can send lamports to the address of an agent wallet's token account for a mint
/// before it exists. The ATA program only tops them up to rent, so closing the account hands
/// them to the wallet: they go to the vault as donated SOL, the fill stays exact and the wallet
/// keeps trading (it used to fail every trade on that mint with `ExecutorNotSettled`).
#[test]
fn dust_on_a_wallet_token_account_address_is_donated_and_the_wallet_still_trades() {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[10 * SOL, 10 * SOL]);
    let wallets = register_executors(&mut env);
    let w = wallets[5].insecure_clone();
    let ata = spl_ata(&w.pubkey(), &mint);

    // Rally sell with one lamport parked on the address.
    env.warp(60);
    let whale = public_pump(&mut env, &mint, 20 * SOL);
    env.svm.airdrop(&ata, 1).unwrap();
    let l0 = env.launch_at(&launch);
    let w_before = env.lamports(&w.pubkey());
    let meta = ok(env.agent_sell_pump_via(&w, &launch, l0.window_sell_cap / 4, 0));
    let l1 = env.launch_at(&launch);
    let fill = l1.agent_sol_received - l0.agent_sol_received;
    assert_eq!(trades(&meta)[0].sol_amount, fill);
    assert_eq!(l1.vault_sol, l0.vault_sol + fill + 1, "the parked lamport is donated, not a fill");
    assert_wallet_untouched(&env, &w.pubkey(), &mint, w_before);
    env.assert_pump_invariants(&launch);

    // Dip buy with more than the account's rent parked (the ATA program then charges nothing).
    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.pump_public_sell(&whale, &mint, whale_tokens));
    let l = env.launch_at(&launch);
    let spend = l.window_buy_cap / 4;
    let parked = 5_000_000;
    env.svm.airdrop(&ata, parked).unwrap();
    let w_before = env.lamports(&w.pubkey());
    let meta = ok(env.agent_buy_pump_via(&w, &launch, spend, 0));
    let l2 = env.launch_at(&launch);
    assert_eq!(trades(&meta)[0].sol_amount, spend);
    assert_eq!(l2.vault_sol, l.vault_sol - spend + parked);
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol + spend);
    assert!(l2.vault_tokens > l.vault_tokens);
    assert_wallet_untouched(&env, &w.pubkey(), &mint, w_before);
    env.assert_pump_invariants(&launch);
}

/// A launch graduated to PumpSwap with the whale that completed its curve and the agent
/// wallets registered. Every call builds the same state (same amounts, slots and clock), so two
/// runs differing in one detail compare exactly.
fn graduated_with_wallets() -> (Env, Pubkey, Pubkey, solana_sdk::signature::Keypair, Vec<solana_sdk::signature::Keypair>) {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[10 * SOL]);
    let cranker = env.user(2);
    let whale = env.user(200);
    let left = env.curve(&mint).real_token_reserves;
    ok(env.pump_public_buy_tokens(&whale, &mint, left, 120 * SOL));
    ok(env.pump_migrate(&cranker, &mint));
    ok(env.graduate_pump(&cranker, &launch));
    let wallets = register_executors(&mut env);
    (env, launch, mint, whale, wallets)
}

/// A rally sell then a dip buy through an agent wallet on PumpSwap, with `parked` lamports sent
/// to the wallet's (not yet existing) WSOL account address before each. Returns, per trade, the
/// measured fill (SOL received / tokens bought) and the vault SOL delta.
fn wallet_pool_round_trip(parked: impl Fn(u64) -> u64) -> [(u64, i128); 2] {
    let (mut env, launch, mint, whale, wallets) = graduated_with_wallets();
    let w = wallets[2].insecure_clone();
    let wsol = spl_ata(&w.pubkey(), &WSOL_MINT);

    env.warp(60);
    ok(env.amm_public_buy(&whale, &mint, 10 * SOL));
    let l0 = env.launch_at(&launch);
    let chunk = l0.window_sell_cap / 4;
    let dust = parked(chunk);
    if dust > 0 {
        env.svm.airdrop(&wsol, dust).unwrap();
    }
    let w_before = env.lamports(&w.pubkey());
    ok(env.agent_sell_pump_via(&w, &launch, chunk, 0));
    let l1 = env.launch_at(&launch);
    assert_wallet_untouched(&env, &w.pubkey(), &mint, w_before);
    env.assert_pump_invariants(&launch);
    let sell = (l1.agent_sol_received - l0.agent_sol_received, l1.vault_sol as i128 - l0.vault_sol as i128);

    env.warp(600);
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &mint));
    ok(env.amm_public_sell(&whale, &mint, whale_tokens));
    let l2 = env.launch_at(&launch);
    let spend = l2.window_buy_cap / 2;
    let dust = parked(spend);
    if dust > 0 {
        env.svm.airdrop(&wsol, dust).unwrap();
    }
    let w_before = env.lamports(&w.pubkey());
    ok(env.agent_buy_pump_via(&w, &launch, spend, 0));
    let l3 = env.launch_at(&launch);
    assert_eq!(l3.vault_cost_sol, l2.vault_cost_sol + spend, "spent exactly the clip");
    assert_wallet_untouched(&env, &w.pubkey(), &mint, w_before);
    env.assert_pump_invariants(&launch);
    let buy = (l3.vault_tokens - l2.vault_tokens, l3.vault_sol as i128 - l2.vault_sol as i128);
    [sell, buy]
}

/// Bare lamports on an agent wallet's WSOL account address (not a token account yet) are
/// donated when the trade closes the account: the fills match a run without them exactly, and
/// more parked than the clip (which used to underflow the measured spend) still trades.
#[test]
fn bare_lamports_on_a_wallet_wsol_address_are_donated_not_a_fill() {
    let [(sold, sell_delta), (bought, buy_delta)] = wallet_pool_round_trip(|_| 0);
    assert!(sold > 0 && bought > 0);
    assert_eq!(sell_delta, sold as i128);
    let parked = 1_000_000;
    let [(sold_d, sell_delta_d), (bought_d, buy_delta_d)] = wallet_pool_round_trip(|_| parked);
    assert_eq!(sold_d, sold, "the parked lamports are not proceeds");
    assert_eq!(sell_delta_d, sell_delta + parked as i128);
    assert_eq!(bought_d, bought);
    assert_eq!(buy_delta_d, buy_delta + parked as i128);
    let [(sold_b, _), (bought_b, buy_delta_b)] = wallet_pool_round_trip(|clip| clip * 2);
    assert_eq!((sold_b, bought_b), (sold, bought));
    assert!(buy_delta_b > 0, "more parked than spent: the vault gains SOL and still buys");
}

// ---------------- PumpSwap effective reserves ----------------

/// The reserves PumpSwap prices on: (WSOL balance + `virtual_quote_reserves`, token balance).
fn effective_pool(env: &Env, mint: &Pubkey) -> (u64, u64) {
    let (quote, base, virtual_quote) = env.pool_state(mint);
    ((quote as i128 + virtual_quote) as u64, base)
}

/// A rally sell by the agent on a graduated launch, from the same state every time, with the
/// launch's impact cap set to `cap_bps`. Returns the result and the pool before and after.
fn pool_rally_sell(cap_bps: u16) -> (TxResult, (u64, u64, i128), (u64, u64, i128)) {
    let mut env = pump_env();
    let (_c, launch, mint, _b) = env.live_pump_launch(&[10 * SOL]);
    let cranker = env.user(2);
    let whale = env.user(200);
    let left = env.curve(&mint).real_token_reserves;
    ok(env.pump_public_buy_tokens(&whale, &mint, left, 120 * SOL));
    ok(env.pump_migrate(&cranker, &mint));
    ok(env.graduate_pump(&cranker, &launch));
    env.warp(60);
    ok(env.amm_public_buy(&whale, &mint, 10 * SOL));
    env.set_launch_at(&launch, |l| l.terms.agent_max_impact_bps = cap_bps);
    let chunk = env.launch_at(&launch).window_sell_cap / 4;
    let before = env.pool_state(&mint);
    let res = env.agent_sell_pump(&launch, chunk, 0);
    let after = env.pool_state(&mint);
    (res, before, after)
}

/// pump.fun migrates a completed curve into a pool carrying a positive `virtual_quote_reserves`
/// (17.58 SOL here, as on mainnet), and PumpSwap prices every trade on the WSOL balance plus it.
/// The program reads the same effective reserves: the Trade event's price and SOL reserve, and
/// the impact cap, are measured on them.
#[test]
fn graduated_pool_prices_and_caps_impact_on_effective_quote_reserves() {
    let (res, before, after) = pool_rally_sell(MAX_AGENT_IMPACT_BPS);
    let trade = trades(&ok(res)).pop().unwrap();
    assert!(before.2 > 0, "migrated pools carry virtual quote reserves");
    let eff = |(q, b, v): (u64, u64, i128)| ((q as i128 + v) as u64, b);
    let (q1, b1) = eff(after);
    assert_eq!(trade.price_q64, moshsol::math::price_q64(q1, b1).unwrap());
    assert_eq!((trade.real_sol, trade.token_reserve), (q1, b1));
    let (q0, b0) = eff(before);
    let move_eff = moshsol::math::move_bps(moshsol::math::price_q64(q0, b0).unwrap(), trade.price_q64);
    let move_raw = moshsol::math::move_bps(
        moshsol::math::price_q64(before.0, before.1).unwrap(),
        moshsol::math::price_q64(after.0, after.1).unwrap(),
    );
    assert!(move_eff > 0 && move_raw > move_eff, "the raw balance overstates the move: {move_raw} vs {move_eff} bps");
    // The cap binds exactly at the effective move (a raw-balance measure would refuse it).
    let (res, ..) = pool_rally_sell(move_eff as u16);
    ok(res);
    let (res, ..) = pool_rally_sell(move_eff as u16 - 1);
    assert_err(res, MoshError::AgentPriceImpact);
}

/// `buyback_burn` on a graduated Holdfast token and `wind_down_pump` on a graduated launch floor
/// their fills at 97% of the fee-free quote from the effective reserves: a positive virtual quote
/// (the buyback; on the raw balance its floor was out of reach) and a negative one (the wind-down;
/// on the raw balance its floor exceeded what the pool pays, so a dead launch could never wind
/// down). Agent trades on a pool with a negative virtual quote report its effective price.
#[test]
fn buyback_and_wind_down_floor_on_effective_quote_reserves() {
    let mut env = pump_env();
    let cranker = env.user(2);
    // The launch that pays, on its curve, and a graduated pump launch standing in for the
    // Holdfast token.
    let (_c, launch, mint, _b) = env.live_pump_launch(&[20 * SOL]);
    let (_c2, hold_launch, hold_mint, _b2) = env.live_pump_launch(&[10 * SOL]);
    let whale = env.user(300);
    let left = env.curve(&hold_mint).real_token_reserves;
    ok(env.pump_public_buy_tokens(&whale, &hold_mint, left, 120 * SOL));
    ok(env.pump_migrate(&cranker, &hold_mint));
    ok(env.graduate_pump(&cranker, &hold_launch));
    // The pool's first trade creates its coin-creator vault account (the buyer pays its rent);
    // here a public buy, as on any live pool.
    ok(env.amm_public_buy(&whale, &hold_mint, SOL / 10));
    public_pump(&mut env, &mint, 10 * SOL);
    ok(env.collect_pump_fees(&cranker, &launch));
    let admin = env.admin.insecure_clone();
    let mut p = test_params();
    p.buyback_mint = hold_mint;
    ok(env.update_platform(&admin, p));
    env.warp(BUYBACK_MIN_INTERVAL_SECS);

    let pool_sol = env.launch_at(&launch).buyback_pool_sol;
    let (quote, base) = effective_pool(&env, &hold_mint);
    assert!(env.pool_state(&hold_mint).2 > 0);
    let amount = pool_sol.min(quote / 20);
    let expected = moshsol::math::tokens_out(quote, base, amount).unwrap();
    let supply_before = env.spl_mint_supply(&hold_mint);
    let meta = ok(env.buyback_burn(&launch, &hold_mint, u64::MAX, expected * 97 / 100));
    eprintln!("CU buyback_burn (pool): {}", meta.compute_units_consumed);
    let l = env.launch_at(&launch);
    assert_eq!(l.burned_sol, amount);
    assert!(l.burned_tokens >= expected * 97 / 100 && l.burned_tokens < expected, "fill {} vs quote {expected}", l.burned_tokens);
    assert_eq!(supply_before - env.spl_mint_supply(&hold_mint), l.burned_tokens);
    env.assert_pump_invariants(&launch);
    env.assert_pump_invariants(&hold_launch);

    // pump.fun's virtual quote turns negative on the graduated launch; the agent sells into the
    // rally the graduation left (its EMA still sits at the curve's launch price).
    let (raw, ..) = env.pool_state(&hold_mint);
    env.set_pool_virtual_quote(&hold_mint, -(raw as i128) / 5);
    let l0 = env.launch_at(&hold_launch);
    let meta = ok(env.agent_sell_pump(&hold_launch, l0.window_sell_cap / 4, 0));
    let (q1, b1) = effective_pool(&env, &hold_mint);
    let t = trades(&meta).pop().unwrap();
    assert_eq!((t.price_q64, t.real_sol, t.token_reserve), (moshsol::math::price_q64(q1, b1).unwrap(), q1, b1));
    env.assert_pump_invariants(&hold_launch);

    // The launch dies: the whale leaves.
    let whale_tokens = env.spl_balance(&spl_ata(&whale.pubkey(), &hold_mint));
    ok(env.amm_public_sell(&whale, &hold_mint, whale_tokens));
    let (raw, ..) = env.pool_state(&hold_mint);
    env.set_pool_virtual_quote(&hold_mint, -(raw as i128) / 5);

    env.warp(WIND_DOWN_MIN_AGE_SECS);
    let l1 = env.launch_at(&hold_launch);
    let (quote, base) = effective_pool(&env, &hold_mint);
    let expected = moshsol::math::sol_out(quote, base, l1.vault_tokens).unwrap();
    let raw_quote = moshsol::math::sol_out(env.pool_state(&hold_mint).0, base, l1.vault_tokens).unwrap();
    assert!(expected < raw_quote * 97 / 100, "the raw balance promises more than the pool pays");
    ok(env.wind_down_pump(&cranker, &hold_launch));
    let l2 = env.launch_at(&hold_launch);
    assert_eq!(l2.status, LaunchStatus::WoundDown);
    let proceeds = l2.backer_fees_accrued - l1.backer_fees_accrued - l1.vault_sol;
    assert!(proceeds >= expected * 97 / 100 && proceeds < expected, "{proceeds} vs quote {expected}");
    env.assert_pump_invariants(&hold_launch);
}

// ---------------- launch window ----------------

/// A raise that met its minimum can be launched — by its creator, or by anyone after the
/// deadline — until `LAUNCH_GRACE_SECS` past the deadline. After that nobody can launch it and
/// every backer can refund in full, permissionlessly.
#[test]
fn a_met_raise_not_launched_within_the_grace_period_becomes_refundable() {
    let mut env = pump_env();
    let creator = env.user(5);
    let stale = env.create_pump_ok(&creator, default_pump_args());
    let launched = env.create_pump_ok(&creator, default_pump_args());
    let b1 = env.user(25);
    let b2 = env.user(25);
    for l in [&stale, &launched] {
        ok(env.deposit_at(&b1, l, 8 * SOL));
        ok(env.deposit_at(&b2, l, 4 * SOL));
    }
    env.warp(3_600);
    assert_err(env.refund_at(&b1, &stale), MoshError::MinimumReached);
    env.warp(LAUNCH_GRACE_SECS - 1);
    assert_err(env.refund_at(&b1, &stale), MoshError::MinimumReached);
    // Still launchable by anyone on the grace period's last second.
    let (_mint, res) = env.launch_pump(&b2, &launched);
    ok(res);
    assert_eq!(env.launch_at(&launched).status, LaunchStatus::Live);

    env.warp(1);
    let (_mint, res) = env.launch_pump(&creator, &stale);
    assert_err(res, MoshError::LaunchWindowClosed);
    let (_mint, res) = env.launch_pump(&b2, &stale);
    assert_err(res, MoshError::LaunchWindowClosed);
    let before = env.lamports(&b1.pubkey());
    ok(env.refund_at(&b1, &stale));
    assert!(env.lamports(&b1.pubkey()) - before >= 8 * SOL, "deposit + backer rent returned");
    let l = env.launch_at(&stale);
    assert_eq!(l.status, LaunchStatus::Refunding);
    ok(env.refund_at(&b2, &stale));
    let l = env.launch_at(&stale);
    assert_eq!(l.refunded, l.raised);
    let acct = env.svm.get_account(&stale).unwrap();
    assert_eq!(acct.lamports, env.svm.minimum_balance_for_rent_exemption(acct.data.len()), "nothing left on the launch");
    let (_mint, res) = env.launch_pump(&creator, &stale);
    assert_err(res, MoshError::NotRaising);
}
