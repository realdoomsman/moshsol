mod common;

use common::*;
use moshsol::constants::*;
use moshsol::errors::MoshError;
use moshsol::math;
use moshsol::state::{LaunchStatus, LaunchTerms};
use solana_sdk::signature::{Keypair, Signer};

#[test]
fn create_mints_fixed_supply_and_revokes_mint_authority() {
    let mut env = Env::new();
    let creator = env.user(5);
    let fee_before = env.lamports(&env.fee_recipient.pubkey());
    let mint = env.create_ok(&creator, default_args());

    let m = env.mint_state(&mint);
    assert_eq!(m.supply, TOTAL_SUPPLY);
    assert!(m.mint_authority.is_none(), "mint authority must be revoked");
    assert!(m.freeze_authority.is_none(), "no freeze authority");
    assert_eq!(m.decimals, TOKEN_DECIMALS);

    let meta = env.svm.get_account(&mint).unwrap().data;
    let name = b"Mosh Dog";
    assert!(meta.windows(name.len()).any(|w| w == name), "token metadata stored on mint");

    let l = env.launch(&mint);
    assert_eq!(l.status, LaunchStatus::Raising);
    assert_eq!(l.token_reserve, TOTAL_SUPPLY);
    assert_eq!(env.platform().launch_count, 1);
    assert_eq!(env.lamports(&env.fee_recipient.pubkey()) - fee_before, SOL / 50);
    env.assert_invariants(&mint);
}

#[test]
fn create_rejects_out_of_bounds_args() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mut a = default_args();
    a.bundle_supply_bps = 2_600; // platform max is 2500
    assert_err(env.create(&creator, a).1, MoshError::InvalidParam);
    let mut a = default_args();
    a.raise_max = a.raise_min - 1;
    assert_err(env.create(&creator, a).1, MoshError::InvalidParam);
    let mut a = default_args();
    a.duration_secs = 10;
    assert_err(env.create(&creator, a).1, MoshError::InvalidParam);
    let mut a = default_args();
    a.symbol = "WAYTOOLONGSYMBOL".into();
    assert_err(env.create(&creator, a).1, MoshError::InvalidMetadata);
}

#[test]
fn full_lifecycle_bundle_fees_and_claims() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mint = env.create_ok(&creator, default_args());
    let b1 = env.user(20);
    let b2 = env.user(20);
    let b3 = env.user(20);
    ok(env.deposit(&b1, &mint, 10 * SOL, vec![]));
    ok(env.deposit(&b2, &mint, 6 * SOL, vec![]));
    ok(env.deposit(&b3, &mint, 4 * SOL, vec![]));
    env.assert_invariants(&mint);

    // Trading is closed before launch.
    let trader = env.user(50);
    assert_err(env.buy(&trader, &mint, SOL, 0), MoshError::NotLive);

    ok(env.launch_token(&creator, &mint));
    let l = env.launch(&mint);
    assert_eq!(l.status, LaunchStatus::Live);
    assert_eq!(l.raised, 20 * SOL);
    // 1% launch fee, 70% of the rest budgeted for the bundle but capped at 20% of supply.
    let cap = TOTAL_SUPPLY / 5;
    assert_eq!(l.bundle_tokens, cap);
    let expected_spent = math::sol_in_for_tokens(30 * SOL, TOTAL_SUPPLY, cap).unwrap();
    assert_eq!(l.bundle_sol, expected_spent);
    assert_eq!(l.vault_sol, 20 * SOL - SOL / 5 - expected_spent);
    assert_eq!(l.platform_fees_unclaimed, SOL / 5);
    assert_eq!(l.window_buy_cap, l.vault_sol / 10);
    env.assert_invariants(&mint);

    // Public buy: 1% fee split 50/30/20.
    ok(env.buy(&trader, &mint, SOL, 1));
    let l = env.launch(&mint);
    assert_eq!(l.backer_fees_accrued, SOL / 200);
    assert_eq!(l.creator_fees_unclaimed, SOL / 100 * 3 / 10);
    assert_eq!(l.platform_fees_unclaimed, SOL / 5 + SOL / 100 * 2 / 10);
    let bought = env.token_balance(&ata(&trader.pubkey(), &mint));
    assert!(bought > 0);
    env.assert_invariants(&mint);

    // Sell half back.
    let sol_before = env.lamports(&trader.pubkey());
    ok(env.sell(&trader, &mint, bought / 2, 1));
    assert!(env.lamports(&trader.pubkey()) > sol_before);
    env.assert_invariants(&mint);

    // Backers claim pro-rata (10:6:4).
    let l = env.launch(&mint);
    let mut claimed = vec![];
    for b in [&b1, &b2, &b3] {
        let before = env.lamports(&b.pubkey());
        ok(env.claim_backer(b, &mint));
        let paid = env.lamports(&b.pubkey()) + 5_000 - before; // + signature fee
        assert_eq!(paid, env.backer(&mint, &b.pubkey()).unwrap().fees_claimed);
        claimed.push(paid);
    }
    let total: u64 = claimed.iter().sum();
    assert!(
        total <= l.backer_fees_accrued && l.backer_fees_accrued - total <= 3,
        "claimed {claimed:?} accrued {}",
        l.backer_fees_accrued
    );
    assert!(claimed[0].abs_diff(claimed[1] * 10 / 6) <= 2);
    assert!(claimed[0].abs_diff(claimed[2] * 10 / 4) <= 3);
    assert_err(env.claim_backer(&b1, &mint), MoshError::NothingToClaim);
    env.assert_invariants(&mint);

    // Creator + platform.
    let before = env.lamports(&creator.pubkey());
    ok(env.claim_creator(&creator, &mint));
    assert_eq!(env.lamports(&creator.pubkey()) + 5_000 - before, l.creator_fees_unclaimed);
    assert_err(env.claim_creator(&trader, &mint), MoshError::Unauthorized);
    let fr = env.fee_recipient.pubkey();
    let before = env.lamports(&fr);
    ok(env.sweep(&trader, &mint));
    assert_eq!(env.lamports(&fr) - before, l.platform_fees_unclaimed);
    env.assert_invariants(&mint);

    // Nothing ever leaves the vault: deposits are not refundable once live.
    assert_err(env.refund(&b1, &mint), MoshError::NotRefunding);
}

#[test]
fn deposits_clip_to_raise_and_wallet_caps() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mut a = default_args();
    a.raise_max = 12 * SOL;
    a.max_per_wallet = 5 * SOL;
    let mint = env.create_ok(&creator, a);
    let b1 = env.user(20);
    let b2 = env.user(20);
    let b3 = env.user(20);
    ok(env.deposit(&b1, &mint, 8 * SOL, vec![]));
    assert_eq!(env.backer(&mint, &b1.pubkey()).unwrap().deposited, 5 * SOL);
    assert_err(env.deposit(&b1, &mint, SOL, vec![]), MoshError::WalletCapReached);
    ok(env.deposit(&b2, &mint, 5 * SOL, vec![]));
    ok(env.deposit(&b3, &mint, 5 * SOL, vec![]));
    assert_eq!(env.backer(&mint, &b3.pubkey()).unwrap().deposited, 2 * SOL);
    let l = env.launch(&mint);
    assert_eq!(l.raised, 12 * SOL);
    assert_eq!(l.backer_count, 3);
    let b4 = env.user(5);
    assert_err(env.deposit(&b4, &mint, SOL, vec![]), MoshError::RaiseFull);
    env.assert_invariants(&mint);

    // Full raise can be launched by anyone.
    ok(env.launch_token(&b4, &mint));
}

#[test]
fn platform_beta_caps_bound_raise_and_wallet_deposits() {
    let mut params = test_params();
    params.max_raise_lamports = 20 * SOL;
    params.max_wallet_deposit_lamports = 3 * SOL;
    let mut env = Env::with_params(params);
    let creator = env.user(5);

    let mut a = default_args();
    a.raise_max = 20 * SOL + 1;
    assert_err(env.create(&creator, a).1, MoshError::InvalidParam);
    let mut a = default_args();
    a.raise_max = 20 * SOL;
    let open = env.create_ok(&creator, a);

    // No creator cap: the platform cap applies.
    let b1 = env.user(20);
    ok(env.deposit(&b1, &open, 5 * SOL, vec![]));
    assert_eq!(env.backer(&open, &b1.pubkey()).unwrap().deposited, 3 * SOL);
    assert_err(env.deposit(&b1, &open, SOL, vec![]), MoshError::WalletCapReached);

    // A stricter creator cap wins over the platform cap.
    let mut a = default_args();
    a.raise_max = 20 * SOL;
    a.max_per_wallet = 2 * SOL;
    let strict = env.create_ok(&creator, a);
    ok(env.deposit(&b1, &strict, 5 * SOL, vec![]));
    assert_eq!(env.backer(&strict, &b1.pubkey()).unwrap().deposited, 2 * SOL);
    env.assert_invariants(&open);
    env.assert_invariants(&strict);

    // The raise cap can't sit below the platform minimum.
    let admin = env.admin.insecure_clone();
    let mut bad = params;
    bad.max_raise_lamports = bad.min_raise_lamports - 1;
    assert_err(env.update_platform(&admin, bad), MoshError::InvalidParam);
}

#[test]
fn failed_raise_refunds_everyone() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mint = env.create_ok(&creator, default_args());
    let b1 = env.user(20);
    let b2 = env.user(20);
    ok(env.deposit(&b1, &mint, 3 * SOL, vec![]));
    ok(env.deposit(&b2, &mint, 2 * SOL, vec![]));

    assert_err(env.refund(&b1, &mint), MoshError::RaiseStillOpen);
    assert_err(env.launch_token(&creator, &mint), MoshError::MinimumNotReached);

    env.warp(3_601);
    assert_err(env.deposit(&b1, &mint, SOL, vec![]), MoshError::RaiseClosed);
    let before = env.lamports(&b1.pubkey());
    ok(env.refund(&b1, &mint));
    assert!(env.lamports(&b1.pubkey()) - before >= 3 * SOL, "deposit + backer rent returned");
    assert!(env.backer(&mint, &b1.pubkey()).is_none(), "backer account closed");
    assert_eq!(env.launch(&mint).status, LaunchStatus::Refunding);
    env.assert_invariants(&mint);
    ok(env.refund(&b2, &mint));
    let l = env.launch(&mint);
    assert_eq!(l.refunded, l.raised);
    env.assert_invariants(&mint);
    assert_err(env.launch_token(&creator, &mint), MoshError::NotRaising);
}

#[test]
fn successful_raise_cannot_be_refunded_and_needs_permission_to_launch_early() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mint = env.create_ok(&creator, default_args());
    let b1 = env.user(20);
    ok(env.deposit(&b1, &mint, 10 * SOL, vec![]));
    // Before the deadline only the creator can launch a raise that is not full.
    assert_err(env.launch_token(&b1, &mint), MoshError::RaiseStillOpen);
    env.warp(3_601);
    assert_err(env.refund(&b1, &mint), MoshError::MinimumReached);
    ok(env.launch_token(&b1, &mint));
    assert_err(env.launch_token(&creator, &mint), MoshError::NotRaising);
}

#[test]
fn creator_cancel_enables_refunds() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mint = env.create_ok(&creator, default_args());
    let b1 = env.user(20);
    ok(env.deposit(&b1, &mint, 10 * SOL, vec![]));
    assert_err(env.cancel(&b1, &mint), MoshError::Unauthorized);
    ok(env.cancel(&creator, &mint));
    assert_err(env.deposit(&b1, &mint, SOL, vec![]), MoshError::NotRaising);
    ok(env.refund(&b1, &mint));
    assert_err(env.cancel(&creator, &mint), MoshError::NotRaising);
    env.assert_invariants(&mint);
}

#[test]
fn whitelist_is_enforced_by_merkle_proof() {
    let mut env = Env::new();
    let creator = env.user(5);
    let allowed: Vec<Keypair> = (0..5).map(|_| env.user(20)).collect();
    let leaves: Vec<[u8; 32]> = allowed.iter().map(|k| merkle_leaf(&k.pubkey())).collect();
    let (root, proofs) = merkle(&leaves);
    let mut a = default_args();
    a.whitelist_root = root;
    let mint = env.create_ok(&creator, a);

    for (k, p) in allowed.iter().zip(proofs.iter()) {
        ok(env.deposit(k, &mint, SOL, p.clone()));
    }
    let outsider = env.user(20);
    assert_err(env.deposit(&outsider, &mint, SOL, vec![]), MoshError::NotWhitelisted);
    assert_err(env.deposit(&outsider, &mint, SOL, proofs[0].clone()), MoshError::NotWhitelisted);
    assert_eq!(env.launch(&mint).backer_count, 5);
}

#[test]
fn slippage_protects_traders() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[10 * SOL]);
    let t = env.user(20);
    let l = env.launch(&mint);
    let net = SOL - SOL / 100;
    let quote = math::tokens_out(l.curve_sol(), l.token_reserve, net).unwrap();
    assert_err(env.buy(&t, &mint, SOL, quote + 1), MoshError::Slippage);
    ok(env.buy(&t, &mint, SOL, quote));
    assert_eq!(env.token_balance(&ata(&t.pubkey(), &mint)), quote);
    assert_err(env.sell(&t, &mint, quote, SOL), MoshError::Slippage);
}

#[test]
fn curve_stays_solvent_when_everyone_exits() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[15 * SOL]);
    let traders: Vec<Keypair> = (0..6).map(|_| env.user(40)).collect();
    for (i, t) in traders.iter().enumerate() {
        ok(env.buy(t, &mint, (i as u64 + 1) * 3 * SOL, 0));
    }
    for t in traders.iter().rev() {
        let bal = env.token_balance(&ata(&t.pubkey(), &mint));
        ok(env.sell(t, &mint, bal, 0));
        env.assert_invariants(&mint);
    }
    let l = env.launch(&mint);
    assert_eq!(l.token_reserve + l.vault_tokens, TOTAL_SUPPLY);
    // Everything public traders put in came back out minus fees; the bundle's SOL remains.
    assert!(l.real_sol >= l.bundle_sol - 1, "real {} bundle {}", l.real_sol, l.bundle_sol);
}

#[test]
fn agent_never_buys_above_cost_without_sell_proceeds() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);

    // Right after launch price == EMA: neither side is allowed.
    assert_err(env.agent_buy(&mint, SOL / 10, 0), MoshError::AgentBuyNotDip);
    let some_tokens = env.launch(&mint).vault_tokens / 100;
    assert_err(env.agent_sell(&mint, some_tokens, 0), MoshError::AgentSellNotRally);

    // Random signer cannot act as the agent.
    let rogue = env.user(2);
    assert_err(env.agent_buy_as(&rogue, &mint, SOL / 10, 0), MoshError::Unauthorized);

    // Pump, let the EMA follow, dump back: a real dip vs the EMA, but the price is still above
    // the bundle's average entry and the vault has no sell proceeds, so buying is refused.
    let whale = env.user(40);
    env.warp(10);
    ok(env.buy(&whale, &mint, 12 * SOL, 0));
    env.warp(3_600);
    let bal = env.token_balance(&ata(&whale.pubkey(), &mint));
    ok(env.sell(&whale, &mint, bal, 0));
    env.warp(600);
    let l = env.launch(&mint);
    assert!(l.price_q64().unwrap() < l.ema_price, "price is under the EMA");
    assert_err(env.agent_buy(&mint, SOL / 10, 0), MoshError::AgentAboveCostBasis);
    env.assert_invariants(&mint);
}

#[test]
fn agent_sells_rallies_above_cost_then_buys_back_below_avg_sell() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let initial = env.launch(&mint);
    let whale = env.user(40);
    env.warp(60);
    ok(env.buy(&whale, &mint, 15 * SOL, 0));
    env.warp(300);

    let l = env.launch(&mint);
    assert!(l.price_q64().unwrap() > l.ema_price);
    let cap = math::bps(l.vault_tokens, 500).unwrap();
    assert_eq!(l.window_sell_cap, cap, "window snapshotted at launch");
    assert_err(env.agent_sell(&mint, cap + 1, 0), MoshError::AgentWindowLimit);

    let chunk = cap / 4;
    let quote = math::sol_out(l.curve_sol(), l.token_reserve, chunk).unwrap();
    assert_err(env.agent_sell(&mint, chunk, quote + 1), MoshError::Slippage);
    ok(env.agent_sell(&mint, chunk, quote));
    let l2 = env.launch(&mint);
    assert_eq!(l2.vault_sol, l.vault_sol + quote);
    assert_eq!(l2.vault_tokens, l.vault_tokens - chunk);
    assert_eq!(l2.agent_sol_received, quote);
    assert_eq!(l2.agent_tokens_sold, chunk);
    assert_eq!(l2.buyback_sol, quote);
    // Average-cost method: the basis shrinks pro rata, the average stays the same.
    let removed = (l.vault_cost_sol as u128 * chunk as u128 / l.vault_tokens as u128) as u64;
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol - removed);
    ok(env.agent_sell(&mint, chunk, 0));
    env.assert_invariants(&mint);

    // Whale exits: price falls well below the agent's average sell price.
    env.warp(5);
    let bal = env.token_balance(&ata(&whale.pubkey(), &mint));
    ok(env.sell(&whale, &mint, bal, 0));
    env.warp(300);

    let l = env.launch(&mint);
    let budget = l.buyback_sol;
    assert!(budget > 0 && budget < l.window_buy_cap, "budget {budget} cap {}", l.window_buy_cap);
    // Above average cost, so only the buy-back budget may be spent.
    assert_err(env.agent_buy(&mint, budget + 1, 0), MoshError::AgentAboveCostBasis);
    ok(env.agent_buy(&mint, budget / 2, 1));
    ok(env.agent_buy(&mint, budget - budget / 2, 1));
    let l = env.launch(&mint);
    assert_eq!(l.buyback_sol, 0);
    assert_err(env.agent_buy(&mint, 1_000, 0), MoshError::AgentAboveCostBasis);

    // Round trip: same SOL back in the vault, more tokens than it started with.
    assert_eq!(l.vault_sol, initial.vault_sol);
    assert!(l.vault_tokens > initial.vault_tokens, "vault gained tokens selling high, buying low");
    env.assert_invariants(&mint);
}

#[test]
fn agent_window_caps_impact_and_circuit_breaker() {
    let mut p = test_params();
    p.agent_max_impact_bps = 100;
    let mut env = Env::with_params(p);
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let whale = env.user(40);
    env.warp(60);
    ok(env.buy(&whale, &mint, 15 * SOL, 0));
    env.warp(300);

    let cap = env.launch(&mint).window_sell_cap;
    assert_err(env.agent_sell(&mint, cap, 0), MoshError::AgentPriceImpact);
    for _ in 0..8 {
        ok(env.agent_sell(&mint, cap / 8, 0));
    }
    let l = env.launch(&mint);
    assert_eq!(l.window_tokens_sold, cap / 8 * 8);
    assert_err(env.agent_sell(&mint, cap - l.window_tokens_sold + 1, 0), MoshError::AgentWindowLimit);

    let admin = env.admin.insecure_clone();
    p.agents_paused = true;
    ok(env.update_platform(&admin, p));
    assert_err(env.agent_sell(&mint, 1_000_000_000, 0), MoshError::AgentsPaused);
    p.agents_paused = false;
    ok(env.update_platform(&admin, p));

    // Next window: fresh cap from the current vault, counters reset.
    env.warp(3_600);
    ok(env.agent_sell(&mint, 1_000_000_000, 0));
    let l = env.launch(&mint);
    assert_eq!(l.window_tokens_sold, 1_000_000_000);
    assert_eq!(l.window_sell_cap, math::bps(l.vault_tokens + 1_000_000_000, 500).unwrap());
    env.assert_invariants(&mint);
}

#[test]
fn vault_trades_cannot_share_a_slot_with_public_trades() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let whale = env.user(40);
    env.warp(60);
    ok(env.buy(&whale, &mint, 15 * SOL, 0));
    env.warp(300);
    let chunk = env.launch(&mint).window_sell_cap / 8;
    let agent = env.agent.insecure_clone();
    let trader = env.user(10);

    // Front-run leg: a public trade earlier in the slot blocks the agent (one tx or one bundle).
    let front = [env.buy_ix(&trader.pubkey(), &mint, SOL, 0), env.agent_sell_ix(&agent.pubkey(), &mint, chunk, 0)];
    assert_err(env.send(&front, &[&trader, &agent]), MoshError::SameSlotTrade);
    // Back-run leg: nobody can trade against the vault's fill in the same slot.
    let back = [env.agent_sell_ix(&agent.pubkey(), &mint, chunk, 0), env.sell_ix(&whale.pubkey(), &mint, 1_000_000, 0)];
    assert_err(env.send(&back, &[&whale, &agent]), MoshError::SameSlotTrade);

    // In separate slots both go through.
    ok(env.agent_sell(&mint, chunk, 0));
    ok(env.sell(&whale, &mint, 1_000_000, 0));
    env.assert_invariants(&mint);
}

#[test]
fn trade_fees_round_up_so_dust_trades_still_pay() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[10 * SOL]);
    let t = env.user(1);
    let before = env.launch(&mint);
    ok(env.buy(&t, &mint, 99, 0)); // 99 lamports * 1% = 0.99 -> 1 lamport fee
    let l = env.launch(&mint);
    let fees = |l: &moshsol::state::Launch| l.backer_fees_accrued + l.creator_fees_unclaimed + l.platform_fees_unclaimed;
    assert_eq!(fees(&l) - fees(&before), 1);
    env.assert_invariants(&mint);
}

#[test]
fn launch_terms_are_frozen_at_creation() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[10 * SOL]);
    let admin = env.admin.insecure_clone();
    let mut p = test_params();
    p.trade_fee_bps = 200;
    p.backer_fee_share_bps = MIN_BACKER_FEE_SHARE_BPS;
    p.creator_fee_share_bps = MIN_CREATOR_FEE_SHARE_BPS;
    ok(env.update_platform(&admin, p));

    let t = env.user(10);
    ok(env.buy(&t, &mint, SOL, 0));
    let l = env.launch(&mint);
    assert_eq!(l.terms.trade_fee_bps, 100);
    assert_eq!(l.backer_fees_accrued, SOL / 200, "backers keep their 50% of a 1% fee");

    // A creator who reviewed the old terms is refused instead of getting the new ones.
    let creator = env.user(5);
    assert_err(env.create_raw(&creator, default_args()).1, MoshError::TermsChanged);
    let mut stingy = default_args();
    stingy.expected_terms = LaunchTerms::from(&p);
    stingy.max_create_fee_lamports = p.create_fee_lamports - 1;
    assert_err(env.create_raw(&creator, stingy).1, MoshError::TermsChanged);

    let newer = env.create_ok(&creator, default_args());
    assert_eq!(env.launch(&newer).terms.trade_fee_bps, 200);
    assert_eq!(env.launch(&newer).terms.backer_fee_share_bps, MIN_BACKER_FEE_SHARE_BPS);
}

#[test]
fn only_upgrade_authority_can_initialize() {
    let mut env = Env::bare();
    let squatter = env.user(5);
    assert_err(env.initialize_platform(&squatter, test_params()), MoshError::NotUpgradeAuthority);
    let mut bad = test_params();
    bad.trade_fee_bps = 0;
    let admin = env.admin.insecure_clone();
    assert_err(env.initialize_platform(&admin, bad), MoshError::InvalidParam);
    ok(env.initialize_platform(&admin, test_params()));
    assert_eq!(env.platform().admin, admin.pubkey());
}

#[test]
fn admin_controls_are_bounded_and_transferable() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let stranger = env.user(2);
    assert_err(env.update_platform(&stranger, test_params()), MoshError::Unauthorized);

    let mut p = test_params();
    p.trade_fee_bps = MAX_TRADE_FEE_BPS + 1;
    assert_err(env.update_platform(&admin, p), MoshError::InvalidParam);
    let mut p = test_params();
    p.agent_buy_bps_per_window = MAX_AGENT_WINDOW_BPS + 1;
    assert_err(env.update_platform(&admin, p), MoshError::InvalidParam);
    let mut p = test_params();
    p.backer_fee_share_bps = 8_000;
    p.creator_fee_share_bps = 3_000;
    assert_err(env.update_platform(&admin, p), MoshError::InvalidParam);
    // The split has floors: fees can't all be routed to the platform.
    let mut p = test_params();
    p.backer_fee_share_bps = MIN_BACKER_FEE_SHARE_BPS - 1;
    assert_err(env.update_platform(&admin, p), MoshError::InvalidParam);
    let mut p = test_params();
    p.creator_fee_share_bps = MIN_CREATOR_FEE_SHARE_BPS - 1;
    assert_err(env.update_platform(&admin, p), MoshError::InvalidParam);

    // Pause blocks new launches and deposits only.
    let creator = env.user(5);
    let mint = env.create_ok(&creator, default_args());
    let b = env.user(20);
    ok(env.deposit(&b, &mint, 10 * SOL, vec![]));
    let mut p = test_params();
    p.paused = true;
    ok(env.update_platform(&admin, p));
    assert_err(env.create(&creator, default_args()).1, MoshError::Paused);
    assert_err(env.deposit(&b, &mint, SOL, vec![]), MoshError::Paused);
    ok(env.launch_token(&creator, &mint));
    let t = env.user(5);
    ok(env.buy(&t, &mint, SOL, 0));

    // Two-step admin handover (e.g. to a multisig).
    let multisig = env.user(2);
    assert_err(env.accept_admin(&multisig), MoshError::NoPendingAdmin);
    ok(env.propose_admin(&admin, multisig.pubkey()));
    assert_err(env.accept_admin(&stranger), MoshError::NoPendingAdmin);
    ok(env.accept_admin(&multisig));
    assert_eq!(env.platform().admin, multisig.pubkey());
    assert_err(env.update_platform(&admin, test_params()), MoshError::Unauthorized);
}
