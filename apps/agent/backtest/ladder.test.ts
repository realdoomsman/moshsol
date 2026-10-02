import assert from "node:assert/strict";
import { test } from "node:test";
import { FlowWindow, NEUTRAL_FLOW, type FlowFeatures } from "../src/flow";
import { DEFAULT_PARAMS, evaluate, ladderShare, ladderWindowShare, type Sizing } from "../src/strategy";
import { FairValueFlow, pathFromCandles, type Candle } from "./flows";
import { PUMP_TERMS, agentSell, launch, type Chain } from "./program";
import { FAIR_HALF_LIFE_MS } from "./scenarios";
import { DEFAULT_SIM, Market, T0, simulate, type Scenario } from "./sim";

const SIZING: Sizing = { minTradeLamports: 10_000_000n, minSellLamports: 50_000_000n, slippageBps: 100 };

test("the ladder's defaults sell ~10% of the bundle at 3×, ~20% at 5×, 35% at 10×, nothing below 1.5×", () => {
  const share = (mult: number) => ladderShare(DEFAULT_PARAMS, mult);
  assert.equal(share(1.5), 0);
  assert.ok(Math.abs(share(3) - 0.1) < 0.01, `3×: ${share(3)}`);
  assert.ok(Math.abs(share(5) - 0.2) < 0.01, `5×: ${share(5)}`);
  assert.ok(Math.abs(share(10) - 0.35) < 1e-9, `10×: ${share(10)}`);
  for (let m = 1.6; m < 100; m *= 1.1) assert.ok(share(m * 1.1) > share(m), `the ladder rises with the multiple (${m.toFixed(2)}×)`);
  assert.equal(ladderWindowShare(DEFAULT_PARAMS, 10), 1, "from 10× a window may sell its whole cap");
});

/** A pump launch (11.6 SOL bundle) pumped by the public to `mult`× its bundle price, EMA 20% under spot, fresh window. */
function pumped(mult: number): { chain: Chain; now: bigint; slot: () => number } {
  const chain = launch({ terms: PUMP_TERMS, virtualSol: 0n, raised: 17_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 7_500n }, BigInt(T0));
  const market = new Market(chain, null);
  market.t = 60_000;
  market.moveTo(Math.log((Number(chain.bundleSol) / Number(chain.bundleTokens)) * mult));
  market.t = 2 * Number(PUMP_TERMS.windowSecs) * 1_000;
  const now = market.now();
  chain.emaPrice = (((chain.virtualSol + chain.realSol) << 64n) / chain.tokenReserve / 120n) * 100n;
  chain.lastTradeTs = now;
  let slot = market.slot();
  return { chain, now, slot: () => ++slot };
}

/** Sells one window lets the shipped policy take at `mult`× (no flow history: no pause fires). */
function windowSells(mult: number): { tokens: bigint; cap: bigint; sizes: number[]; reasons: string[] } {
  const { chain, now, slot } = pumped(mult);
  const sizes: number[] = [];
  const reasons: string[] = [];
  let cap = 0n;
  for (let i = 0; i < 50; i++) {
    const plan = evaluate(chain, SIZING, now, DEFAULT_PARAMS, NEUTRAL_FLOW).plan;
    reasons.push(plan.reason);
    if (plan.action !== "sell") break;
    const res = agentSell(chain, plan.amount, plan.minOut, now, slot());
    assert.ok(res.ok, `sell rejected: ${res.ok ? "" : res.error}`);
    cap = chain.windowSellCap;
    sizes.push(Number(res.out) / 1e9);
  }
  return { tokens: chain.windowTokensSold, cap, sizes, reasons };
}

// The window is paced by the ladder: at 3× a window sells about the ladder's 3× share relative to its 10× share of the
// program's window cap, and keeps the rest for higher prices; at 10× it sells the whole cap. Each sell is as large as
// 90% of the launch's impact limit allows (never a stream of 0.01 SOL clips), and none is under the 0.05 SOL minimum.
test("a window sells at the ladder's pace, in impact-sized clips", () => {
  const low = windowSells(3);
  const high = windowSells(10);
  assert.ok(low.tokens > 0n && high.tokens > 0n, `low ${low.tokens}, high ${high.tokens}: ${low.reasons.at(-1)}`);
  const lowShare = Number(low.tokens) / Number(low.cap);
  const expected = ladderWindowShare(DEFAULT_PARAMS, 3);
  assert.ok(lowShare <= expected * 1.05 && lowShare >= expected * 0.6, `3×: sold ${lowShare.toFixed(3)} of the cap, ladder pace ${expected.toFixed(3)}`);
  assert.ok(/at this multiple a window sells \d+% of its/.test(low.reasons.at(-1)!), low.reasons.at(-1));
  // Its own sells walk spot (and with it the ladder's pace) back under 10× as the window fills.
  assert.ok(Number(high.tokens) >= Number(high.cap) * 0.9, `10×: sold ${high.tokens} of the ${high.cap} cap`);
  for (const size of [...low.sizes, ...high.sizes]) assert.ok(size >= 0.05, `sell of ${size} SOL under the minimum`);
  assert.ok(Math.max(...high.sizes) > 1, `largest sell at 10× ${Math.max(...high.sizes).toFixed(3)} SOL: sells should be impact-sized`);
});

// A crash reads as a rally against a lagging pump EMA (sampled only by agent trades); the flow window's 15-min high,
// net flow since that high and 3-min VWAP must hold the sell, and say why.
test("a fresh crash pauses rally sells even though spot is still far above the lagging EMA", () => {
  const { chain, now } = pumped(8);
  const flow = new FlowWindow();
  const start = Number(now) - 600;
  const rs = chain.realSol;
  const k = (chain.virtualSol + rs) * chain.tokenReserve;
  let f: FlowFeatures = NEUTRAL_FLOW;
  // Ten minutes of buying up to the high, then four minutes of selling 70% of the curve's real SOL out.
  const end = start + 840;
  for (let at = start; at <= end; at += 2) {
    const s = at - start;
    const realSol = s <= 600 ? (rs * BigInt(500 + s)) / 1_100n : (rs * BigInt(1_100 - Math.round(((s - 600) / 240) * 770))) / 1_100n;
    Object.assign(chain, { realSol, tokenReserve: k / (chain.virtualSol + realSol), lastTradeTs: BigInt(at) });
    f = flow.observe(chain, BigInt(at));
  }
  // The pump EMA only moved on agent trades: it still sits at the bundle price.
  chain.emaPrice = (chain.bundleSol << 64n) / chain.bundleTokens;
  assert.ok(f.drawdownHigh > 0.5 && f.netSinceHighSol < 0, `drawdown ${f.drawdownHigh}, net since high ${f.netSinceHighSol}`);
  const plan = evaluate(chain, SIZING, BigInt(end), DEFAULT_PARAMS, f).plan;
  assert.equal(plan.action, "hold");
  assert.match(plan.reason, /^rally \+[\d.]+% vs EMA but sell paused: −\d+\.\d% from 15-min high, sellers in control/);
});

/**
 * The TEST launch (mainnet EGy86Q…, Axiom chart): from its pre-bundle $3K to $48.5K in about six minutes (16.2×; ~12×
 * the bundle price, completing the pump.fun curve near the top), then −86% in three minutes and ten minutes of chop with
 * dead-cat bounces under the high. Minute candles relative to the post-bundle spot (≈ 1.39× the bundle price).
 */
const TEST_LAUNCH_TOP = 8.4;
function testLaunchCandles(): Candle[] {
  const candles: Candle[] = [];
  let p = 1;
  const add = (c: number, wick = 0.03) => {
    const t = candles.length * 60;
    const up = c >= p;
    candles.push([t, p, Math.max(p, c) * (1 + wick), Math.min(p, c) * (1 - (up ? 0.04 : wick)), c, 0]);
    p = c;
  };
  add(1.02);
  add(0.99);
  const rise = TEST_LAUNCH_TOP ** (1 / 6);
  for (let i = 0; i < 6; i++) add(p * rise);
  add(p * 0.97);
  const dump = (0.134 / 0.97) ** (1 / 3);
  for (let i = 0; i < 3; i++) add(p * dump);
  for (const c of [1.12, 0.98, 1.08, 0.95, 1.1, 1.0, 0.97, 1.06, 0.98, 1.02]) add(p * c);
  return candles;
}

function testLaunchScenario(): Scenario {
  const path = pathFromCandles(testLaunchCandles());
  return {
    id: "test-launch-EGy86Q",
    tag: "pump",
    model: "fair",
    setup: { terms: PUMP_TERMS, virtualSol: 0n, raised: 17_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 7_500n },
    durationMs: path.durationMs,
    prepare: (market, rng) => new FairValueFlow(path, Math.log(market.spot()), FAIR_HALF_LIFE_MS, rng),
  };
}

// The owner's intent on the launch that exposed the old ramp: sell more the higher it goes, never into the crash.
// Event-driven agent (1 s reaction, 3 s cooldown), the current pump terms (8% impact, 5% per 15 min window).
test("TEST launch replay: most sell proceeds come above 5× and nothing is sold in the dump", () => {
  const sc = testLaunchScenario();
  const run = simulate(sc, { kind: "tuned", params: DEFAULT_PARAMS }, { ...DEFAULT_SIM, pollMs: 1_000, rereadMs: 150, cooldownMs: 3_000, recordFills: true });
  const a = run.agent!;
  assert.equal(a.plannedRejects, 0, `planned rejects: ${JSON.stringify(a.plannedRejectKinds)}`);
  const chain = launch(sc.setup, BigInt(T0));
  const bundlePrice = Number(chain.bundleSol) / Number(chain.bundleTokens);
  const top = run.startPrice * TEST_LAUNCH_TOP;
  const sells = a.fills!.filter((f) => f.action === "sell");
  const sold = sells.reduce((s, f) => s + f.sol, 0);
  const above5 = sells.filter((f) => f.spot >= 5 * bundlePrice).reduce((s, f) => s + f.sol, 0);
  const topAt = 8 * 60_000;
  const inDump = sells.filter((f) => f.t > topAt && f.spot < 0.7 * top);
  assert.ok(sells.length > 0, "the rally is sold into");
  assert.ok(above5 > sold / 2, `${above5.toFixed(3)} of ${sold.toFixed(3)} SOL sold above 5×`);
  assert.deepEqual(
    inDump.map((f) => `${(f.t / 1_000).toFixed(0)}s ${f.sol.toFixed(3)} SOL at ${(f.spot / bundlePrice).toFixed(2)}×: ${f.reason}`),
    [],
    "no sell more than 30% under the high once the dump started",
  );
  for (const f of sells) assert.ok(f.sol >= 0.05 * 0.99, `sell of ${f.sol} SOL under the minimum`);
});
