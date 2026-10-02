import assert from "node:assert/strict";
import { test } from "node:test";
import { FlowWindow, type FlowFeatures, type FlowInput } from "../src/flow";

const T0 = 1_700_000_000n;
const SOL = 1_000_000_000n;

/** A 30 SOL virtual curve holding `realSol`, with the Launch counters at `volumeSol` / `tradeCount`. */
function market(realSol: bigint, volumeSol: bigint, tradeCount: number, at: bigint): FlowInput {
  return {
    virtualSol: 30n * SOL,
    realSol,
    tokenReserve: 1_000_000_000_000_000n - realSol * 10_000n,
    volumeSol,
    tradeCount,
    agentSolSpent: 0n,
    agentSolReceived: 0n,
    agentBuys: 0,
    agentSells: 0,
    lastTradeTs: at,
  };
}

/** Feature-wise equal up to float rounding (a merged second's volume is swapped out of running sums). */
function assertSame(a: FlowFeatures, b: FlowFeatures): void {
  for (const k of Object.keys(b) as (keyof FlowFeatures)[]) {
    assert.ok(a[k] === b[k] || Math.abs(a[k] - b[k]) <= 1e-9 * Math.abs(b[k]), `${k}: ${a[k]} ≠ ${b[k]}`);
  }
}

// The stream delivers every account update; several can share one chain second. Folding them in one by one must
// give the window the poller would have built from the second's last update alone, with each trade visible at once.
test("updates within one chain second merge into that second's sample", () => {
  const streamed = new FlowWindow();
  const polled = new FlowWindow();
  // A quiet minute of small buys…
  for (let i = 0n; i < 60n; i++) {
    const m = market(5n * SOL + i * 10_000_000n, i * 10_000_000n, Number(i), T0 + i);
    streamed.observe(m, T0 + i);
    polled.observe(m, T0 + i);
  }
  // …then a dump printed in two trades within one second.
  const t = T0 + 60n;
  const first = streamed.observe(market(4n * SOL, 1_200_000_000n, 61, t), t);
  assert.ok(first.imbalanceRecent < 0, `the dump's first print shows at once (imbalance ${first.imbalanceRecent})`);
  const merged = streamed.observe(market(3n * SOL, 2_200_000_000n, 62, t), t);
  assert.ok(merged.netSol < first.netSol, "the second print in the same second deepens the sell flow");
  assertSame(merged, polled.observe(market(3n * SOL, 2_200_000_000n, 62, t), t));
  // The next second is measured from the merged counters: both windows stay identical.
  const next = T0 + 61n;
  const m = market(3n * SOL, 2_300_000_000n, 63, next);
  assertSame(streamed.observe(m, next), polled.observe(m, next));
});
