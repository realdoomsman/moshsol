import assert from "node:assert/strict";
import { test } from "node:test";
import { solOut } from "@holdfast/sdk";
import { NEUTRAL_FLOW } from "../src/flow";
import { DEFAULT_PARAMS, evaluate, sellAllowance, type StrategyParams } from "../src/strategy";
import { compare, runObjective } from "./metrics";
import { PRODUCTION_TERMS, agentSell, launch, type Chain } from "./program";
import { ScenarioBuilder } from "./scenarios";
import { Market, T0, simulate, type Policy } from "./sim";

// Seeded public flow and seeded agent timing make a run a pure function of (scenario, policy), so
// this comparison is stable: the default policy must keep beating the frozen v1 rule on a fixed
// synthetic launch whose seed is outside the TRAIN and TEST sets.
test("default policy beats v1 on a fixed synthetic launch", () => {
  const sc = new ScenarioBuilder().build({ kind: "synthetic", seed: 900, hours: 12 });
  const base = simulate(sc, { kind: "none" });
  assert.deepEqual(simulate(sc, { kind: "none" }), base, "the simulation must be deterministic");
  const objective = (policy: Policy) => runObjective(compare(base, simulate(sc, policy)));
  const tuned = objective({ kind: "tuned", params: DEFAULT_PARAMS });
  const v1 = objective({ kind: "v1" });
  assert.ok(tuned > v1, `default objective ${tuned.toFixed(2)} ≤ v1 ${v1.toFixed(2)}`);
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
  const p = DEFAULT_PARAMS;
  assert.ok(p.fullMcapMult > 1 && p.fullVolumeSol > 1, "the guardrail ships on");
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
