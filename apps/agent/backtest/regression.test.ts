import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_UNIT, solInForTokens, solOut } from "@holdfast/sdk";
import { NEUTRAL_FLOW } from "../src/flow";
import { DEFAULT_PARAMS, evaluate, grossForNet, project, sellAllowance, withParams, type StrategyParams } from "../src/strategy";
import { compare, runObjective } from "./metrics";
import { PRODUCTION_TERMS, PUMP_CURVE, PUMP_TERMS, agentBuy, agentSell, launch, publicBuy, publicSell, publicTokens, type Chain } from "./program";
import { ScenarioBuilder } from "./scenarios";
import { Market, T0, simulate } from "./sim";

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

/**
 * SOL the shipped policy sells for inside one window on a launch pumped `mult`× by the public with `volumeSol`
 * of traded volume on the books, selling into a +20% rally until it holds; plus the allowance it was given.
 */
function windowProceeds(mult: number, volumeSol: number, params: StrategyParams): { sol: number; allowance: number; reasons: string[] } {
  const chain: Chain = launch(
    { terms: PRODUCTION_TERMS, virtualSol: 30_000_000_000n, raised: 50_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 2_000n },
    BigInt(T0),
  );
  const market = new Market(chain, null);
  market.t = 60_000;
  market.moveTo(Math.log(market.spot() * mult));
  market.t = 600_000;
  const now = market.now();
  const spot = ((chain.virtualSol + chain.realSol) << 64n) / chain.tokenReserve;
  chain.emaPrice = (spot * 100n) / 120n;
  chain.lastTradeTs = now;
  chain.volumeSol = BigInt(Math.round(volumeSol * 1e9));
  const sizing = { minTradeLamports: 10_000_000n, slippageBps: 100 };
  const windowCapSol = Number(solOut(chain.virtualSol + chain.realSol, chain.tokenReserve, (chain.vaultTokens * PRODUCTION_TERMS.sellBpsPerWindow) / 10_000n)) / 1e9;
  const allowance = sellAllowance(params, market.spot() / (Number(chain.bundleSol) / Number(chain.bundleTokens)), volumeSol, windowCapSol, NEUTRAL_FLOW).sol;
  let sol = 0n;
  const reasons: string[] = [];
  for (let i = 0; i < 50; i++) {
    const plan = evaluate(chain, sizing, now, params, NEUTRAL_FLOW).plan;
    reasons.push(plan.reason);
    if (plan.action !== "sell") break;
    const res = agentSell(chain, plan.amount, plan.minOut, now, market.slot() + 1 + i);
    assert.ok(res.ok, `sell rejected: ${res.ok ? "" : res.error}`);
    sol += res.out;
  }
  return { sol: Number(sol) / 1e9, allowance, reasons };
}

// The owner's guardrail: a launch at a modest multiple of its launch price with little traded volume sells for
// at most its allowance per window (valued at spot, so up to ~3% more as its own sells lower the price) and the
// hold says why; the same launch at a high multiple with a lot of volume sells what the on-chain cap allows.
test("sell guardrail bounds a window's proceeds until market cap and volume have grown", () => {
  assert.ok(DEFAULT_PARAMS.fullMcapMult > 1 && DEFAULT_PARAMS.fullVolumeSol > 1, "the guardrail ships on");
  // The mechanism, on a ramp slow enough to bind at 3× with 10 SOL traded (the shipped ramp opens at 3× / 50 SOL).
  const p = withParams(DEFAULT_PARAMS, { baseSellSol: 1, fullMcapMult: 17.6, fullVolumeSol: 1387, rampShape: 2.15 });
  const quiet = windowProceeds(3, 10, p);
  assert.ok(Number.isFinite(quiet.allowance) && quiet.allowance < 2, `allowance ${quiet.allowance} SOL should bind at 3× with 10 SOL traded`);
  assert.ok(quiet.sol > 0, "the quiet launch still sells into the rally");
  assert.ok(quiet.sol <= quiet.allowance * 1.03, `quiet window sold for ${quiet.sol.toFixed(3)} SOL > allowance ${quiet.allowance.toFixed(3)}`);
  assert.ok(quiet.reasons.some((r) => r.includes("sell allowance")), `no reason mentions the allowance: ${quiet.reasons.join(" | ")}`);
  const busy = windowProceeds(50, 1e5, p);
  assert.equal(busy.allowance, Infinity, "at 50× with 100k SOL traded only the on-chain cap applies");
  assert.ok(busy.sol > quiet.sol * 3, `busy window sold for ${busy.sol.toFixed(3)} SOL, quiet ${quiet.sol.toFixed(3)}`);
  assert.ok(!busy.reasons.some((r) => r.includes("sell allowance")), "no allowance note once it has ramped off");
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

  const shipped = evaluate(chain, { minTradeLamports: 10_000_000n, slippageBps: 100 }, now, DEFAULT_PARAMS, NEUTRAL_FLOW).plan;
  assert.ok(shipped.action !== "hold" || shipped.kind !== "in_band", shipped.reason);
  // The shipped 25 bps entry margin waits for −2.25%; at the band edge the dip is bought, and the program accepts it.
  const plan = evaluate(chain, { minTradeLamports: 10_000_000n, slippageBps: 100 }, now, withParams(DEFAULT_PARAMS, { buyMarginBps: 0 }), NEUTRAL_FLOW).plan;
  assert.equal(plan.action, "buy", plan.reason);
  const res = agentBuy(chain, plan.amount, plan.minOut, now, 1);
  assert.ok(res.ok, `agent_buy_pump rejected the planned buy: ${res.ok ? "" : res.error}`);
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
