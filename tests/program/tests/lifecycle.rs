mod common;

use common::*;
use moshsol::constants::*;
use moshsol::errors::MoshError;
use moshsol::math;
use moshsol::state::{LaunchStatus, LaunchTerms};
use solana_sdk::pubkey::Pubkey;
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

    // Deposits are not refundable once live.
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

    // The creator funding their own raise is exempt from the platform cap (not from their own).
    let creator = env.user(30);
    let mut a = default_args();
    a.raise_max = 20 * SOL;
    a.whitelist_root = merkle(&[merkle_leaf(&creator.pubkey())]).0;
    let own = env.create_ok(&creator, a);
    ok(env.deposit(&creator, &own, 12 * SOL, vec![]));
    assert_eq!(env.backer(&own, &creator.pubkey()).unwrap().deposited, 12 * SOL);
    assert_err(env.deposit(&b1, &own, SOL, vec![]), MoshError::NotWhitelisted);
    ok(env.launch_token(&creator, &own));
    assert_eq!(env.launch(&own).backer_count, 1);
    env.assert_invariants(&own);

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
fn met_raise_left_unlaunched_past_the_grace_period_refunds() {
    let mut env = Env::new();
    let creator = env.user(5);
    let mint = env.create_ok(&creator, default_args());
    let b1 = env.user(20);
    ok(env.deposit(&b1, &mint, 10 * SOL, vec![]));
    env.warp(3_600 + LAUNCH_GRACE_SECS - 1);
    assert_err(env.refund(&b1, &mint), MoshError::MinimumReached);
    env.warp(1);
    assert_err(env.launch_token(&creator, &mint), MoshError::LaunchWindowClosed);
    let before = env.lamports(&b1.pubkey());
    ok(env.refund(&b1, &mint));
    assert!(env.lamports(&b1.pubkey()) - before >= 10 * SOL, "deposit + backer rent returned");
    assert_eq!(env.launch(&mint).status, LaunchStatus::Refunding);
    env.assert_invariants(&mint);
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
    let (_c, mint, backers) = env.live_launch(&[12 * SOL, 8 * SOL]);
    let initial = env.launch(&mint);
    assert_eq!(initial.initial_vault_sol, 20 * SOL - 20 * SOL / 100, "bundle + reserve = raise − launch fee");
    assert_eq!(initial.initial_vault_sol, initial.bundle_sol + initial.vault_sol);
    assert_eq!(initial.last_payout_ts, initial.launched_at);
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
    // Average-cost method: the basis shrinks pro rata, rounded up, so what remains never
    // overstates the average cost.
    let num = l.vault_cost_sol as u128 * chunk as u128;
    let cost = num.div_ceil(l.vault_tokens as u128) as u64;
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol - cost);
    // The whole fill stays in the vault as liquid SOL: nothing is split off to backers.
    assert!(quote > cost, "the rally sell realized a profit");
    assert_eq!(l2.vault_sol, l.vault_sol + quote);
    assert_eq!(l2.backer_fees_accrued, l.backer_fees_accrued);
    assert_eq!(l2.acc_fee_per_share, l.acc_fee_per_share);
    assert_eq!(l2.vault_tokens, l.vault_tokens - chunk);
    assert_eq!(l2.agent_sol_received, quote, "average sell price uses the full fill");
    assert_eq!(l2.agent_tokens_sold, chunk);
    ok(env.agent_sell(&mint, chunk, 0));
    env.assert_invariants(&mint);

    // Backers claim only their trade-fee share, never more than was credited.
    let l = env.launch(&mint);
    assert_eq!(l.backer_fees_accrued, l2.backer_fees_accrued, "agent sells credit backers nothing");
    let mut paid = 0;
    for b in &backers {
        let before = env.lamports(&b.pubkey());
        let entitled = (env.backer(&mint, &b.pubkey()).unwrap().deposited as u128 * l.acc_fee_per_share / ACC_PRECISION) as u64;
        ok(env.claim_backer(b, &mint));
        assert_eq!(env.lamports(&b.pubkey()) + 5_000 - before, entitled);
        paid += entitled;
    }
    assert!(paid <= l.backer_fees_accrued && l.backer_fees_accrued - paid <= 2, "paid {paid} of {}", l.backer_fees_accrued);
    env.assert_invariants(&mint);

    // Whale exits: price falls well below the agent's average sell price.
    env.warp(5);
    let bal = env.token_balance(&ata(&whale.pubkey(), &mint));
    ok(env.sell(&whale, &mint, bal, 0));
    env.warp(300);

    let l = env.launch(&mint);
    // Above average cost, so this is the buy-back path: any vault SOL may be spent, up to the
    // window cap and never below the vault floor.
    let floor = l.terms.min_vault_sol;
    assert_eq!(floor, DEFAULT_MIN_VAULT_SOL);
    assert_err(env.agent_buy(&mint, l.vault_sol - floor + 1, 0), MoshError::VaultFloor);
    // The two rally sells of this window brought SOL in, and the window's buy cap grew with the
    // vault: the proceeds can buy this dip now, not only from the next window.
    assert_eq!(l.window_sol_spent, 0);
    let limit = math::bps(l.vault_sol, l.terms.agent_buy_bps_per_window).unwrap();
    assert!(limit > l.window_buy_cap, "the cap snapshotted at launch is outgrown");
    assert_eq!(l.window_buy_limit().unwrap(), limit);
    assert_err(env.agent_buy(&mint, limit + 1, 0), MoshError::AgentWindowLimit);
    // In clips under the impact cap until the window cap is used up: each buy moves SOL from the
    // vault to the window's spend and leaves the cap where it is.
    let spend = limit;
    for i in 0..4 {
        let clip = if i == 3 { spend - 3 * (spend / 4) } else { spend / 4 };
        ok(env.agent_buy(&mint, clip, 1));
        assert_eq!(env.launch(&mint).window_buy_limit().unwrap(), limit);
    }
    let l3 = env.launch(&mint);
    assert_eq!(l3.vault_sol, l.vault_sol - spend);
    assert_eq!(l3.vault_cost_sol, l.vault_cost_sol + spend);
    assert_err(env.agent_buy(&mint, 1_000, 0), MoshError::AgentWindowLimit);
    // Round trip at a better price than it sold: bought back below the average sell price.
    let bought = l3.vault_tokens + 2 * chunk - initial.vault_tokens;
    assert!(bought as u128 * l3.agent_sol_received as u128 > l3.agent_sol_spent as u128 * l3.agent_tokens_sold as u128);
    // Every lamport the agent received stayed in the vault; only what it spent left.
    assert_eq!(l3.vault_sol + l3.agent_sol_spent, initial.vault_sol + l3.agent_sol_received);
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

#[test]
fn agent_sell_that_does_not_clear_cost_is_refused_and_shares_nothing() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let whale = env.user(40);
    env.warp(60);
    ok(env.buy(&whale, &mint, 15 * SOL, 0));
    env.warp(300);
    let l = env.launch(&mint);
    assert!(l.price_q64().unwrap() > l.ema_price, "a rally vs the EMA");
    let chunk = l.window_sell_cap / 8;
    let quote = math::sol_out(l.curve_sol(), l.token_reserve, chunk).unwrap();
    let at_cost = (quote as u128 * l.vault_tokens as u128 / chunk as u128) as u64;

    // Vault bought higher than this fill (e.g. earlier buy-backs): at and just below cost, the sell
    // is refused, so there is no profit to share and nothing is credited.
    for cost in [at_cost, at_cost + at_cost / 100] {
        env.set_launch(&mint, |l| l.vault_cost_sol = cost);
        let before = env.launch(&mint);
        assert_err(env.agent_sell(&mint, chunk, 0), MoshError::AgentBelowCostBasis);
        let after = env.launch(&mint);
        assert_eq!(after.backer_fees_accrued, before.backer_fees_accrued);
        assert_eq!(after.vault_sol, before.vault_sol);
    }

    // Public sells never realize vault profit: backers get only their fee share.
    let before = env.launch(&mint);
    let bal = env.token_balance(&ata(&whale.pubkey(), &mint));
    ok(env.sell(&whale, &mint, bal / 2, 0));
    let after = env.launch(&mint);
    let gross = math::sol_out(before.curve_sol(), before.token_reserve, bal / 2).unwrap();
    let fee = math::bps_ceil(gross, 100).unwrap();
    assert_eq!(after.backer_fees_accrued - before.backer_fees_accrued, math::bps(fee, 5_000).unwrap());
}

/// A launch whose only trader bought and sold everything: tokens sit only in the curve and vault.
fn abandoned_launch(env: &mut Env) -> (Keypair, Pubkey, Vec<Keypair>) {
    let (creator, mint, backers) = env.live_launch(&[10 * SOL, 6 * SOL, 4 * SOL]);
    let t = env.user(20);
    env.warp(60);
    ok(env.buy(&t, &mint, 3 * SOL, 0));
    let bal = env.token_balance(&ata(&t.pubkey(), &mint));
    ok(env.sell(&t, &mint, bal, 0));
    (creator, mint, backers)
}

#[test]
fn wind_down_needs_live_age_idle_and_few_outside_holders() {
    let mut env = Env::new();
    let cranker = env.user(2);

    // Raising and refunding launches can't be wound down.
    let creator = env.user(5);
    let raising = env.create_ok(&creator, default_args());
    assert_err(env.wind_down(&cranker, &raising), MoshError::NotLive);
    ok(env.cancel(&creator, &raising));
    assert_err(env.wind_down(&cranker, &raising), MoshError::NotLive);

    // No griefing right after launch, even when nobody else holds tokens yet.
    let (_c, mint, _b) = env.live_launch(&[10 * SOL, 6 * SOL, 4 * SOL]);
    assert_err(env.wind_down(&cranker, &mint), MoshError::LaunchTooYoung);

    // A trader buys more than the dead-launch threshold (5% of supply) and parks one token in
    // a random wallet's account.
    let t = env.user(20);
    let parked = env.user(1);
    env.warp(60);
    ok(env.buy(&t, &mint, 3 * SOL, 0));
    let threshold = math::bps(TOTAL_SUPPLY, DEFAULT_DEAD_HOLDERS_BPS).unwrap();
    let bal = env.token_balance(&ata(&t.pubkey(), &mint));
    assert!(bal > threshold + 1_000_000, "trader holds {bal}, threshold {threshold}");
    env.transfer_tokens(&t, &mint, &parked.pubkey(), 1_000_000);

    let launched_at = env.launch(&mint).launched_at;
    let now = env.now();
    env.warp(launched_at + WIND_DOWN_MIN_AGE_SECS - 1 - now);
    assert_err(env.wind_down(&cranker, &mint), MoshError::LaunchTooYoung);
    env.warp(1);
    assert_err(env.wind_down(&cranker, &mint), MoshError::OutsideHolders);

    // The trader sells down to one base unit over the threshold (with the parked token): a
    // fresh trade restarts the idle clock.
    let keep = threshold + 1 - 1_000_000;
    ok(env.sell(&t, &mint, bal - 1_000_000 - keep, 0));
    assert_err(env.wind_down(&cranker, &mint), MoshError::RecentTrade);
    env.warp(WIND_DOWN_IDLE_SECS - 1);
    assert_err(env.wind_down(&cranker, &mint), MoshError::RecentTrade);
    env.warp(1);
    // One base unit over 5% still blocks it...
    assert_err(env.wind_down(&cranker, &mint), MoshError::OutsideHolders);
    // ...but burned tokens leave the supply (and the threshold moves with it).
    env.burn_tokens(&parked, &mint, 1_000_000);
    assert_eq!(env.mint_state(&mint).supply, TOTAL_SUPPLY - 1_000_000);
    let meta = ok(env.wind_down(&cranker, &mint));
    eprintln!("CU wind_down: {}", meta.compute_units_consumed);
    assert_eq!(env.launch(&mint).status, LaunchStatus::WoundDown);
    env.assert_invariants(&mint);
    // The remaining outside holder keeps their tokens; everything else is back in the curve.
    assert_eq!(env.token_balance(&ata(&t.pubkey(), &mint)), keep);
    assert_eq!(env.token_balance(&curve_pda(&launch_pda(&mint))), TOTAL_SUPPLY - 1_000_000 - keep);
}

#[test]
fn wound_down_launch_pays_backers_and_stops_trading() {
    let mut env = Env::new();
    let (creator, mint, backers) = abandoned_launch(&mut env);
    let cranker = env.user(2);
    env.warp(WIND_DOWN_MIN_AGE_SECS);
    let before = env.launch(&mint);
    assert!(before.vault_tokens > 0 && before.vault_sol > 0 && before.real_sol > 0);
    ok(env.wind_down(&cranker, &mint));

    let l = env.launch(&mint);
    let launch_key = launch_pda(&mint);
    assert_eq!(l.status, LaunchStatus::WoundDown);
    assert_eq!((l.real_sol, l.vault_sol, l.vault_tokens, l.vault_cost_sol), (0, 0, 0, 0));
    assert_eq!(l.backer_fees_accrued, before.backer_fees_accrued + before.real_sol + before.vault_sol);
    assert_eq!(l.token_reserve, TOTAL_SUPPLY);
    assert_eq!(env.token_balance(&curve_pda(&launch_key)), TOTAL_SUPPLY);
    assert_eq!(env.token_balance(&vault_pda(&launch_key)), 0);
    env.assert_invariants(&mint);

    // Once only: trading, agents, a second wind-down and vault withdrawals are all over.
    assert_err(env.wind_down(&cranker, &mint), MoshError::NotLive);
    let t = env.user(5);
    assert_err(env.buy(&t, &mint, SOL, 0), MoshError::NotLive);
    assert_err(env.agent_buy(&mint, SOL / 10, 0), MoshError::NotLive);
    assert_err(env.agent_sell(&mint, 1_000_000, 0), MoshError::NotLive);
    let admin = env.admin.insecure_clone();
    assert_err(env.admin_withdraw(&admin, &mint, 1, 0), MoshError::InsufficientVault);

    // Backers claim pro-rata (10:6:4); rounding never pays out more than was credited.
    let mut paid = vec![];
    for b in &backers {
        let before = env.lamports(&b.pubkey());
        ok(env.claim_backer(b, &mint));
        let got = env.lamports(&b.pubkey()) + 5_000 - before;
        let deposited = env.backer(&mint, &b.pubkey()).unwrap().deposited;
        assert_eq!(got, (deposited as u128 * l.acc_fee_per_share / ACC_PRECISION) as u64);
        paid.push(got);
    }
    let total: u64 = paid.iter().sum();
    assert!(total <= l.backer_fees_accrued && l.backer_fees_accrued - total <= 3, "paid {paid:?} of {}", l.backer_fees_accrued);
    assert!(paid[0].abs_diff(paid[1] * 10 / 6) <= 2 && paid[0].abs_diff(paid[2] * 10 / 4) <= 3, "{paid:?}");
    assert_err(env.claim_backer(&backers[0], &mint), MoshError::NothingToClaim);
    // Creator and platform fees stay claimable.
    ok(env.claim_creator(&creator, &mint));
    ok(env.sweep(&t, &mint));
    env.assert_invariants(&mint);
}

#[test]
fn admin_withdraw_vault_is_admin_only_and_keeps_accounting() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let admin = env.admin.insecure_clone();
    let agent = env.agent.insecure_clone();
    let fr = env.fee_recipient.pubkey();
    // An agent sell adds its proceeds to vault SOL.
    let whale = env.user(40);
    env.warp(60);
    ok(env.buy(&whale, &mint, 15 * SOL, 0));
    env.warp(300);
    let chunk = env.launch(&mint).window_sell_cap / 4;
    let meta = ok(env.agent_sell(&mint, chunk, 0));
    eprintln!("CU agent_sell: {}", meta.compute_units_consumed);
    let l = env.launch(&mint);
    assert!(l.vault_sol > l.initial_vault_sol - l.bundle_sol);

    // Only the platform admin, and only to the platform fee recipient.
    let recipient_tokens = env.create_ata(&admin, &fr, &mint);
    let stranger = env.user(2);
    let stranger_tokens = env.create_ata(&stranger, &stranger.pubkey(), &mint);
    for signer in [&stranger, &agent] {
        let ix = env.admin_withdraw_ix(&signer.pubkey(), &mint, &fr, &recipient_tokens, SOL, 1);
        assert_err(env.send(&[ix], &[signer]), MoshError::Unauthorized);
    }
    let ix = env.admin_withdraw_ix(&admin.pubkey(), &mint, &stranger.pubkey(), &stranger_tokens, SOL, 1);
    assert_err(env.send(&[ix], &[&admin]), MoshError::Unauthorized);
    let ix = env.admin_withdraw_ix(&admin.pubkey(), &mint, &fr, &stranger_tokens, 0, 1);
    assert_anchor_err(env.send(&[ix], &[&admin]), anchor_lang::error::ErrorCode::ConstraintTokenOwner);
    assert_err(env.admin_withdraw(&admin, &mint, 0, 0), MoshError::ZeroAmount);
    assert_err(env.admin_withdraw(&admin, &mint, l.vault_sol + 1, 0), MoshError::InsufficientVault);
    assert_err(env.admin_withdraw(&admin, &mint, 0, l.vault_tokens + 1), MoshError::InsufficientVault);

    // Partial: SOL to the recipient, tokens to its account taking their share of the cost basis;
    // the agent's vault shrinks by exactly that.
    let sol = l.vault_sol / 2;
    let tokens = l.vault_tokens / 3;
    let fr_before = env.lamports(&fr);
    let meta = ok(env.admin_withdraw(&admin, &mint, sol, tokens));
    eprintln!("CU admin_withdraw_vault: {}", meta.compute_units_consumed);
    let l2 = env.launch(&mint);
    assert_eq!(env.lamports(&fr) - fr_before, sol);
    assert_eq!(env.token_balance(&recipient_tokens), tokens);
    assert_eq!(l2.vault_sol, l.vault_sol - sol);
    assert_eq!(l2.vault_tokens, l.vault_tokens - tokens);
    let removed = (l.vault_cost_sol as u128 * tokens as u128).div_ceil(l.vault_tokens as u128) as u64;
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol - removed);
    assert_eq!(l2.backer_fees_accrued, l.backer_fees_accrued, "backers' credit is untouched");
    env.assert_invariants(&mint);

    // Leave a dust remainder: its basis must not overstate the average cost (else the agent's
    // buy-at-or-below-cost rule would pass at almost any price).
    ok(env.admin_withdraw(&admin, &mint, 0, l2.vault_tokens - 1));
    let dust = env.launch(&mint);
    assert_eq!(dust.vault_tokens, 1);
    assert!(
        dust.vault_cost_sol as u128 * l2.vault_tokens as u128 <= l2.vault_cost_sol as u128,
        "dust basis {} overstates average {}/{}",
        dust.vault_cost_sol,
        l2.vault_cost_sol,
        l2.vault_tokens
    );

    // Everything that's left: the basis leaves with the last token, the agent has nothing to sell.
    ok(env.admin_withdraw(&admin, &mint, dust.vault_sol, dust.vault_tokens));
    let l3 = env.launch(&mint);
    assert_eq!((l3.vault_sol, l3.vault_tokens, l3.vault_cost_sol), (0, 0, 0));
    assert_eq!(env.token_balance(&recipient_tokens), l.vault_tokens);
    env.assert_invariants(&mint);
    env.warp(3_600);
    assert_err(env.agent_sell(&mint, 1_000_000, 0), MoshError::InsufficientVault);

    // The power moves with the admin role (e.g. to a multisig).
    let multisig = env.user(2);
    ok(env.propose_admin(&admin, multisig.pubkey()));
    ok(env.accept_admin(&multisig));
    assert_err(env.admin_withdraw(&admin, &mint, 0, 0), MoshError::Unauthorized);
}

#[test]
fn dev_withdraw_vault_needs_the_dev_key_and_keeps_accounting() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let admin = env.admin.insecure_clone();
    let agent = env.agent.insecure_clone();
    let dev = env.user(2);
    let stranger = env.user(2);
    let dev_tokens = env.create_ata(&dev, &dev.pubkey(), &mint);
    let stranger_tokens = env.create_ata(&stranger, &stranger.pubkey(), &mint);
    assert_eq!(env.platform().dev_authority, Pubkey::default(), "disabled until the admin sets it");
    assert_err(env.dev_withdraw(&dev, &mint, SOL, 0), MoshError::DevKeyDisabled);

    // Only the admin sets it.
    for signer in [&dev, &stranger, &agent] {
        assert_err(env.set_dev_authority(signer, dev.pubkey()), MoshError::Unauthorized);
    }
    ok(env.set_dev_authority(&admin, dev.pubkey()));
    assert_eq!(env.platform().dev_authority, dev.pubkey());

    // Only the dev key signs, and only into its own token account.
    for (signer, tokens) in [(&stranger, &stranger_tokens), (&agent, &stranger_tokens), (&admin, &dev_tokens)] {
        let ix = env.dev_withdraw_ix(&signer.pubkey(), &mint, tokens, SOL, 1);
        assert_err(env.send(&[ix], &[signer]), MoshError::Unauthorized);
    }
    let ix = env.dev_withdraw_ix(&dev.pubkey(), &mint, &stranger_tokens, 0, 1);
    assert_anchor_err(env.send(&[ix], &[&dev]), anchor_lang::error::ErrorCode::ConstraintTokenOwner);
    let l = env.launch(&mint);
    assert_err(env.dev_withdraw(&dev, &mint, 0, 0), MoshError::ZeroAmount);
    assert_err(env.dev_withdraw(&dev, &mint, l.vault_sol + 1, 0), MoshError::InsufficientVault);
    assert_err(env.dev_withdraw(&dev, &mint, 0, l.vault_tokens + 1), MoshError::InsufficientVault);

    // The emergency path works with everything paused: SOL to the dev wallet, tokens to its
    // account taking their share of the cost basis; curve, backers' credit and fees untouched.
    let mut params = env.platform().params;
    params.paused = true;
    params.agents_paused = true;
    ok(env.update_platform(&admin, params));
    let sol = l.vault_sol / 2;
    let tokens = l.vault_tokens / 3;
    let dev_before = env.lamports(&dev.pubkey());
    let meta = ok(env.dev_withdraw(&dev, &mint, sol, tokens));
    eprintln!("CU dev_withdraw_vault: {}", meta.compute_units_consumed);
    let l2 = env.launch(&mint);
    assert_eq!(env.lamports(&dev.pubkey()) - dev_before, sol - 5_000 * 2, "SOL minus the ATA and withdraw tx fees");
    assert_eq!(env.token_balance(&dev_tokens), tokens);
    assert_eq!((l2.vault_sol, l2.vault_tokens), (l.vault_sol - sol, l.vault_tokens - tokens));
    let removed = (l.vault_cost_sol as u128 * tokens as u128).div_ceil(l.vault_tokens as u128) as u64;
    assert_eq!(l2.vault_cost_sol, l.vault_cost_sol - removed);
    assert_eq!((l2.real_sol, l2.token_reserve), (l.real_sol, l.token_reserve), "curve liquidity untouched");
    assert_eq!((l2.backer_fees_accrued, l2.platform_fees_unclaimed), (l.backer_fees_accrued, l.platform_fees_unclaimed));
    env.assert_invariants(&mint);

    // Rotating moves the power; disabling ends it.
    let dev2 = env.user(2);
    ok(env.set_dev_authority(&admin, dev2.pubkey()));
    assert_err(env.dev_withdraw(&dev, &mint, 1, 0), MoshError::Unauthorized);
    ok(env.dev_withdraw(&dev2, &mint, 1, 0));
    ok(env.set_dev_authority(&admin, Pubkey::default()));
    assert_err(env.dev_withdraw(&dev2, &mint, 1, 0), MoshError::DevKeyDisabled);
    env.assert_invariants(&mint);
}

/// Puts `sol` lamports of liquid SOL into the vault (funding the launch account so the
/// accounting invariant holds), the way agent sells and fee sweeps would.
fn fund_vault(env: &mut Env, mint: &Pubkey, sol: u64) {
    let before = env.launch(mint).vault_sol;
    if sol > before {
        env.svm.airdrop(&launch_pda(mint), sol - before).unwrap();
    }
    env.set_launch(mint, |l| {
        assert!(sol >= before, "fund_vault only tops up");
        l.vault_sol = sol;
    });
}

#[test]
fn payout_backers_repays_principal_at_target_then_dividends_per_interval() {
    let mut env = Env::new();
    let (_c, mint, backers) = env.live_launch(&[12 * SOL, 8 * SOL]);
    let launch_key = launch_pda(&mint);
    let l0 = env.launch(&mint);
    let initial = l0.initial_vault_sol;
    let target = initial * DEFAULT_PAYOUT_MULT_BPS as u64 / 10_000;
    assert_eq!(l0.payout_target().unwrap(), target);
    assert_eq!(target, 5 * initial);
    let interval = DEFAULT_PAYOUT_INTERVAL_SECS as i64;

    // Only the agent authority.
    let stranger = env.user(2);
    assert_err(env.payout_backers_as(&stranger, &launch_key), MoshError::Unauthorized);
    // Not before the vault reaches the target, however long it waits.
    env.warp(interval);
    assert_err(env.payout_backers(&launch_key), MoshError::PayoutNotDue);
    fund_vault(&mut env, &mint, target - 1);
    assert_err(env.payout_backers(&launch_key), MoshError::PayoutNotDue);
    env.assert_invariants(&mint);

    // At the target: the principal, once, to the backers' claimable credit — unless the agent
    // circuit breaker is on, which covers the payout crank too.
    fund_vault(&mut env, &mint, target);
    let admin = env.admin.insecure_clone();
    let mut p = test_params();
    p.agents_paused = true;
    ok(env.update_platform(&admin, p));
    assert_err(env.payout_backers(&launch_key), MoshError::AgentsPaused);
    p.agents_paused = false;
    ok(env.update_platform(&admin, p));
    let meta = ok(env.payout_backers(&launch_key));
    eprintln!("CU payout_backers: {}", meta.compute_units_consumed);
    let l1 = env.launch(&mint);
    assert_eq!(l1.backers_repaid, initial);
    assert_eq!(l1.backer_payouts, 0);
    assert_eq!(l1.vault_sol, target - initial);
    assert_eq!(l1.backer_fees_accrued, l0.backer_fees_accrued + initial);
    assert_eq!(l1.last_payout_ts, env.now(), "payout clock restarted");
    env.assert_invariants(&mint);
    // Backers claim their principal pro-rata (12:8).
    let mut paid = vec![];
    for b in &backers {
        let before = env.lamports(&b.pubkey());
        ok(env.claim_backer(b, &mint));
        paid.push(env.lamports(&b.pubkey()) + 5_000 - before);
    }
    let fees = l0.backer_fees_accrued;
    assert!(paid[0].abs_diff((initial + fees) * 12 / 20) <= 2 && paid[1].abs_diff((initial + fees) * 8 / 20) <= 2, "{paid:?}");

    // Never twice inside one interval, even with the vault back at the target.
    fund_vault(&mut env, &mint, target);
    assert_err(env.payout_backers(&launch_key), MoshError::PayoutNotDue);
    env.warp(interval - 1);
    assert_err(env.payout_backers(&launch_key), MoshError::PayoutNotDue);
    env.warp(1);
    // Dividend: 15% of liquid vault SOL.
    ok(env.payout_backers(&launch_key));
    let l2 = env.launch(&mint);
    let dividend = target * DEFAULT_PAYOUT_SHARE_BPS as u64 / 10_000;
    assert_eq!(l2.backer_payouts, dividend);
    assert_eq!(l2.backers_repaid, initial, "principal is repaid once");
    assert_eq!(l2.vault_sol, target - dividend);
    assert_eq!(l2.backer_fees_accrued, l1.backer_fees_accrued + dividend);
    env.assert_invariants(&mint);

    // Next tick: the vault slipped under the target (it kept buying) → skipped, no payout.
    env.warp(interval);
    assert_err(env.payout_backers(&launch_key), MoshError::PayoutNotDue);
    fund_vault(&mut env, &mint, target + SOL);
    ok(env.payout_backers(&launch_key));
    let l3 = env.launch(&mint);
    assert_eq!(l3.backer_payouts, dividend + (target + SOL) * DEFAULT_PAYOUT_SHARE_BPS as u64 / 10_000);
    env.assert_invariants(&mint);

    // Tokens don't count: a vault rich in tokens but short of liquid SOL pays nothing.
    env.warp(interval);
    env.set_launch(&mint, |l| l.vault_tokens += TOTAL_SUPPLY / 10);
    let l = env.launch(&mint);
    assert!(l.vault_sol < target);
    assert_err(env.payout_backers(&launch_key), MoshError::PayoutNotDue);
    env.set_launch(&mint, |l| l.vault_tokens -= TOTAL_SUPPLY / 10);

    // A wound-down launch has no vault to pay from.
    env.set_launch(&mint, |l| l.status = LaunchStatus::WoundDown);
    assert_err(env.payout_backers(&launch_key), MoshError::NotLive);
}

#[test]
fn payout_never_takes_vault_below_its_floor() {
    let mut env = Env::new();
    let (_c, mint, _b) = env.live_launch(&[20 * SOL]);
    let launch_key = launch_pda(&mint);
    // A tiny launch: 0.05 SOL initial, so a 5× vault is 0.25 SOL and a dividend would cut
    // into the 0.1 SOL floor once the vault is repaid down to it.
    let initial = SOL / 20;
    let l0 = env.launch(&mint);
    env.svm.airdrop(&launch_key, 10 * SOL).unwrap();
    env.set_launch(&mint, |l| {
        l.initial_vault_sol = initial;
        l.vault_sol = l0.vault_sol + 10 * SOL;
    });
    env.warp(DEFAULT_PAYOUT_INTERVAL_SECS as i64);
    ok(env.payout_backers(&launch_key));
    assert_eq!(env.launch(&mint).backers_repaid, initial);
    env.assert_invariants(&mint);

    // Raise the floor above what a dividend would leave: refused, vault untouched.
    env.warp(DEFAULT_PAYOUT_INTERVAL_SECS as i64);
    let l = env.launch(&mint);
    let dividend = l.vault_sol * DEFAULT_PAYOUT_SHARE_BPS as u64 / 10_000;
    env.set_launch(&mint, |l| l.terms.min_vault_sol = l.vault_sol - dividend + 1);
    assert_err(env.payout_backers(&launch_key), MoshError::VaultFloor);
    assert_eq!(env.launch(&mint).vault_sol, l.vault_sol);
    env.set_launch(&mint, |l| l.terms.min_vault_sol = l.vault_sol - dividend);
    ok(env.payout_backers(&launch_key));
    assert_eq!(env.launch(&mint).vault_sol, l.vault_sol - dividend);
    env.assert_invariants(&mint);
}
