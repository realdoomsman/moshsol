import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_UNIT, bps, solInForTokens } from "@holdfast/sdk";
import { NEUTRAL_FLOW } from "../src/flow";
import { DEFAULT_PARAMS, evaluate, grossForNet, project, withParams } from "../src/strategy";
import { compare, runObjective } from "./metrics";
import { PRODUCTION_TERMS, PUMP_CURVE, PUMP_TERMS, agentBuy, launch, publicBuy, publicSell, publicTokens } from "./program";
import { ScenarioBuilder } from "./scenarios";
import { DEFAULT_SIM, T0, simulate } from "./sim";

// Seeded public flow and seeded agent timing make a run a pure function of (scenario, policy), so this
// run is stable: on a fixed synthetic launch whose seed is outside the TRAIN and TEST sets the default
// policy must trade both ways, and the vault's SOL must account for every lamport it spent and received
// (sell proceeds stay in the vault; nothing is shared out) while never dropping below the launch's floor.
test("default policy round-trips and keeps every sell's proceeds in the vault on a fixed synthetic launch", () => {
  const sc = new ScenarioBuilder().build({ kind: "synthetic", seed: 900, hours: 12 });
  const base = simulate(sc, { kind: "none" });
  assert.deepEqual(simulate(sc, { kind: "none" }), base, "the simulation must be deterministic");
  const run = simulate(sc, { kind: "tuned", params: DEFAULT_PARAMS });
  const a = run.agent!;
  assert.ok(a.buys > 0 && a.sells > 0, `expected trades both ways, got ${a.buys} buys / ${a.sells} sells`);
  assert.equal(a.plannedRejects, 0, `planned rejects: ${JSON.stringify(a.plannedRejectKinds)}`);
  assert.ok(Math.abs(run.sol1 - (run.sol0 - a.solSpent + a.solReceived)) < 1e-6, `vault SOL ${run.sol1} ≠ ${run.sol0} − ${a.solSpent} + ${a.solReceived}`);
  assert.ok(run.sol1 >= Number(PRODUCTION_TERMS.minVaultSol) / 1e9, `vault SOL ${run.sol1} under the floor`);
  assert.ok(Number.isFinite(runObjective(compare(base, run))));
});

// Mainnet HFPUMP after 139,175 s without an agent trade (the only thing that samples a pump launch's EMA): the
// program clamps the EMA step to one period, so the sample moves the EMA only halfway to spot and spot sits 2.19%
// under it, past the 2% band. An unclamped mirror let the EMA converge onto spot and held "inside band" forever.
test("an idle pump launch's EMA moves at most halfway to spot, so a dip past the band is bought", () => {
  const chain = launch({ terms: PUMP_TERMS, virtualSol: 0n, raised: 1_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 7_500n }, BigInt(T0));
  const now = BigInt(T0) + 200_000n;
  Object.assign(chain, { virtualSol: 30_000_000_000n, realSol: 37n, tokenReserve: 1_073_000_000_000_000n, emaPrice: 538_824_442_637_579n, lastTradeTs: now - 139_175n });
  const p = project(chain, now);
  assert.equal(p.price, 515_752_397_850_713n);
  assert.equal(p.ema, chain.emaPrice - (chain.emaPrice - p.price) / 2n, "a pump sample moves the EMA exactly halfway after an idle gap");
  assert.ok(p.price <= p.buyCeiling, `spot ${p.price} above the buy ceiling ${p.buyCeiling}`);
  assert.equal(Number(p.deviationPpm), -21_878);

  const shipped = evaluate(chain, DEFAULT_SIM.sizing, now, DEFAULT_PARAMS, NEUTRAL_FLOW).plan;
  assert.ok(shipped.action !== "hold" || shipped.kind !== "in_band", shipped.reason);
  // The shipped 25 bps entry margin waits for −2.25%; at the band edge the dip is bought, and the program accepts it.
  const plan = evaluate(chain, DEFAULT_SIM.sizing, now, withParams(DEFAULT_PARAMS, { buyMarginBps: 0 }), NEUTRAL_FLOW).plan;
  assert.equal(plan.action, "buy", plan.reason);
  const res = agentBuy(chain, plan.amount, plan.minOut, now, 1);
  assert.ok(res.ok, `agent_buy_pump rejected the planned buy: ${res.ok ? "" : res.error}`);
});

// Mainnet TEST, 2026-10-02: its window opened with a 0.0175 SOL buy cap (the share of the vault then); rally sells
// in the same window brought the vault to 2.2 SOL, and the dip that followed could spend only that stale 0.0175 SOL.
// The program's buy cap grows with the vault (`window_buy_limit`): the planner sees the grown room, and the program
// mirror accepts a buy past the opening cap, up to the vault's share counting what the window spent, never beyond.
test("sell proceeds inside a window raise its buy cap: a dip is bought past the opening cap, never past the vault's share", () => {
  const now = BigInt(T0) + 10_000n;
  const chain = launch({ terms: PUMP_TERMS, virtualSol: 0n, raised: 1_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 7_500n }, BigInt(T0));
  const spot = ((chain.virtualSol + chain.realSol) << 64n) / chain.tokenReserve;
  Object.assign(chain, {
    vaultSol: 2_200_000_000n,
    // Average cost twice spot, so the dip buy passes the cost rule on its own.
    vaultCostSol: ((chain.vaultTokens * spot) >> 64n) * 2n,
    windowStart: now - 1_000n,
    windowBuyCap: 17_465_046n,
    windowSolSpent: 0n,
    emaPrice: (spot * 110n) / 100n,
    lastTradeTs: now,
  });
  const p = project(chain, now);
  assert.equal(p.buyCap, bps(chain.vaultSol, chain.terms.buyBpsPerWindow));
  assert.equal(p.buyRemaining, p.buyCap);
  assert.deepEqual(agentBuy(chain, p.buyRemaining + 1n, 0n, now, 1), { ok: false, error: "AgentWindowLimit" });

  const params = withParams(DEFAULT_PARAMS, { buyMarginBps: 0, supportVolumeMult: 0, buyClipShare: 1 });
  const plan = evaluate(chain, DEFAULT_SIM.sizing, now, params, NEUTRAL_FLOW).plan;
  assert.equal(plan.action, "buy", plan.reason);
  assert.ok(plan.amount > chain.windowBuyCap, `planned ${plan.amount}, within the opening cap ${chain.windowBuyCap}`);
  const res = agentBuy(chain, plan.amount, plan.minOut, now, 1);
  assert.ok(res.ok, `agent_buy_pump rejected the planned buy: ${res.ok ? "" : res.error}`);
  const after = project(chain, now + 1n);
  assert.equal(after.buyCap, p.buyCap, "the agent's own buy leaves the cap where it is");
  assert.equal(after.buyRemaining, p.buyCap - plan.amount);
});

// The sim's pump launch completes its curve when a buy takes the last real token and continues on the PumpSwap pool
// pump.fun migrates it into: the curve's real SOL and the supply it never sold, at the curve's final spot.
test("a buy that takes the pump curve's last real token migrates it into the pool at the same spot", () => {
  const chain = launch({ terms: PUMP_TERMS, virtualSol: 0n, raised: 1_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 7_500n }, BigInt(T0));
  const spot = () => ((chain.virtualSol + chain.realSol) << 64n) / chain.tokenReserve;
  const left = chain.tokenReserve - (PUMP_CURVE.virtualTokens - PUMP_CURVE.realTokens);
  const net = solInForTokens(chain.virtualSol + chain.realSol, chain.tokenReserve, left - 1_000n * TOKEN_UNIT);
  assert.ok(publicBuy(chain, grossForNet(chain, net), 0n, BigInt(T0), 1).ok);
  assert.equal(chain.graduated, false, "1,000 tokens short of completion");
  const before = spot();
  const held = publicTokens(chain);
  const res = publicBuy(chain, 100_000_000n, 0n, BigInt(T0), 2);
  assert.ok(res.ok && chain.graduated, "the 0.1 SOL buy completes the curve");
  assert.equal(chain.virtualSol, 0n);
  assert.equal(publicTokens(chain), held + res.out, "the pool holds exactly the supply nobody bought");
  const after = spot();
  assert.ok(after > before && after < (before * 1_005n) / 1_000n, `spot ${before} → ${after}: more than the buy's own impact`);
  assert.ok(publicSell(chain, res.out, 0n, BigInt(T0), 3).ok, "the pool pays sells from its real SOL");
});
