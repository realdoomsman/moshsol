import assert from "node:assert/strict";
import { test } from "node:test";
import { NEUTRAL_FLOW, type FlowFeatures } from "../src/flow";
import { DEFAULT_PARAMS, evaluate, payoutMarketStrong, project, withParams } from "../src/strategy";
import { PRODUCTION_TERMS, agentBuy, agentSell, launch, type Chain } from "./program";
import { Market, T0 } from "./sim";

const SIZING = { minTradeLamports: 10_000_000n, minSellLamports: 50_000_000n, slippageBps: 100 };

/** A 50 SOL launch after a rally sell at 3× (where the sell ladder lets a window sell), now dipped `dipPct` under the EMA so the buy-back path is open. */
function dipped(dipPct: number): { chain: Chain; now: bigint } {
  const chain = launch({ terms: PRODUCTION_TERMS, virtualSol: 30_000_000_000n, raised: 50_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 2_000n }, BigInt(T0));
  const market = new Market(chain, null);
  market.t = 60_000;
  market.moveTo(Math.log(market.spot() * 3));
  market.t = 120_000;
  const rally = evaluate(chain, SIZING, market.now(), DEFAULT_PARAMS, NEUTRAL_FLOW).plan;
  assert.equal(rally.action, "sell", rally.reason);
  assert.ok(agentSell(chain, rally.amount, rally.minOut, market.now(), market.slot() + 1).ok);
  market.t = 600_000;
  market.moveTo(Math.log(market.spot() * (1 - dipPct)));
  market.t = 660_000;
  const now = market.now();
  const spot = ((chain.virtualSol + chain.realSol) << 64n) / chain.tokenReserve;
  chain.emaPrice = (spot * 100n) / BigInt(Math.round(100 * (1 - dipPct)));
  chain.lastTradeTs = now;
  return { chain, now };
}

// The support mode is a sizing rule on top of the program's cost / impact / window checks: a quiet launch gets a
// clip of the normal size and waits out the spacing, a busy one gets the full buy; both pass the program mirror.
test("support mode clips and spaces dip buys on a quiet launch and steps aside on a busy one", () => {
  const { chain, now } = dipped(0.06);
  // General clipping off so the support clip is compared with the unclipped buy.
  const support = withParams(DEFAULT_PARAMS, { supportVolumeMult: 2, supportClipShare: 0.25, supportSpacingSecs: 300, buyClipShare: 1 });
  const vaultSol = Number(chain.vaultSol) / 1e9;
  const quiet: FlowFeatures = { ...NEUTRAL_FLOW, volume24hSol: vaultSol * 0.5, sinceAgentTradeSecs: 3_600 };
  const busy: FlowFeatures = { ...NEUTRAL_FLOW, volume24hSol: vaultSol * 10, sinceAgentTradeSecs: 3_600 };

  const full = evaluate(chain, SIZING, now, support, busy).plan;
  assert.equal(full.action, "buy", full.reason);
  assert.ok(!full.support, "a busy launch is not in support mode");
  const clipped = evaluate(chain, SIZING, now, support, quiet).plan;
  assert.equal(clipped.action, "buy", clipped.reason);
  assert.ok(clipped.support && clipped.reason.includes("support mode"), clipped.reason);
  assert.ok(clipped.amount <= (full.amount * 26n) / 100n && clipped.amount >= SIZING.minTradeLamports, `clip ${clipped.amount} vs full ${full.amount}`);
  assert.equal(clipped.kind, "buyback");
  for (const plan of [full, clipped]) {
    const res = agentBuy({ ...chain }, plan.amount, plan.minOut, now, chain.lastPublicTradeSlot + 1);
    assert.ok(res.ok, `program rejected ${plan.reason}: ${res.ok ? "" : res.error}`);
  }
  const spaced = evaluate(chain, SIZING, now, support, { ...quiet, sinceAgentTradeSecs: 100 }).plan;
  assert.equal(spaced.action, "hold");
  assert.equal(spaced.kind, "spacing");
  assert.ok(spaced.reason.includes("next in 200s"), spaced.reason);
  const off = evaluate(chain, SIZING, now, withParams(DEFAULT_PARAMS, { supportVolumeMult: 0 }), quiet).plan;
  assert.equal(off.action, "buy");
  assert.ok(!off.support, "supportVolumeMult 0 switches the mode off");
});

// No buy may take the vault below its SOL floor: with the floor binding the planner holds with the reason.
test("dip buys stop at the vault's SOL floor", () => {
  const { chain, now } = dipped(0.06);
  chain.vaultSol = chain.terms.minVaultSol + 5_000_000n;
  const plan = evaluate(chain, SIZING, now, DEFAULT_PARAMS, NEUTRAL_FLOW).plan;
  assert.equal(plan.action, "hold");
  assert.equal(plan.kind, "vault_floor");
  assert.ok(plan.reason.includes("floor"), plan.reason);
});

// The payout gate is the sell ramp's view of strength: a dip, net selling, thin volume or a drawdown each block it.
test("payout market gate opens only into a strong market", () => {
  const { chain, now } = dipped(0.06);
  const strongFlow: FlowFeatures = { ...NEUTRAL_FLOW, spanSecs: 1_800, imbalance: 0.4, volumeRatio: 3, vwapDevBps: 250, drawdown24h: 0.05 };
  const dip = payoutMarketStrong(chain, project(chain, now), DEFAULT_PARAMS, strongFlow);
  assert.ok(!dip.ok && dip.reason.includes("under EMA band"), dip.reason);

  const spot = ((chain.virtualSol + chain.realSol) << 64n) / chain.tokenReserve;
  chain.emaPrice = (spot * 100n) / 110n;
  const rally = project(chain, now);
  assert.ok(payoutMarketStrong(chain, rally, DEFAULT_PARAMS, strongFlow).ok);
  const blocked: [Partial<FlowFeatures>, string][] = [
    [{ imbalance: -0.1 }, "net selling"],
    [{ volumeRatio: 1 }, "thin volume"],
    [{ vwapDevBps: -50 }, "below the 30 min VWAP"],
    [{ drawdown24h: 0.4 }, "under the 24 h high"],
  ];
  for (const [patch, text] of blocked) {
    const gate = payoutMarketStrong(chain, rally, DEFAULT_PARAMS, { ...strongFlow, ...patch });
    assert.ok(!gate.ok && gate.reason.includes(text), `${JSON.stringify(patch)}: ${gate.reason}`);
  }
});
