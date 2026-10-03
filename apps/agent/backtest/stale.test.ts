import assert from "node:assert/strict";
import { test } from "node:test";
import { bps } from "@holdfast/sdk";
import { NEUTRAL_FLOW } from "../src/flow";
import { DEFAULT_PARAMS, evaluate, planRejection, type Sizing } from "../src/strategy";
import { PRODUCTION_TERMS, PUMP_CURVE, PUMP_TERMS, agentBuy, agentSell, launch, publicBuy, publicSell, type Chain, type SimTerms } from "./program";
import { T0, mulberry32 } from "./sim";

const SIZING: Sizing = { minTradeLamports: 1_000_000n, minSellLamports: 1_000_000n, slippageBps: 100 };
const lam = (sol: number) => BigInt(Math.floor(sol * 1e9));

// The send-time check (`planRejection`, run on the stream's state right before a trade is broadcast) must agree with
// the program: a plan made on a state passes on that state (else the agent would never send), and once a public trade
// moved the state between decision and send, the check rejects the plan exactly when `agent_buy*` / `agent_sell*`
// would (else it either sends a doomed transaction or drops a valid trade). States sit right at the thresholds
// (EMA band edges, vault cost, average agent sell), so small public trades flip the verdict both ways.
for (const terms of [PRODUCTION_TERMS, PUMP_TERMS]) {
  test(`send-time check agrees with the program after public trades on ${terms.venue} states`, () => agreement(terms));
}

function agreement(t: SimTerms): void {
  const r = mulberry32(5_320);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const now = BigInt(T0 + 100_000);
  const minReserve = t.venue === "pump" ? Number(PUMP_CURVE.virtualTokens - PUMP_CURVE.realTokens) / 1e6 + 2e7 : 3e8;
  const seen = { plans: 0, buyRejected: 0, buyPassed: 0, sellRejected: 0, sellPassed: 0 };
  for (let i = 0; i < 20_000; i++) {
    const realSol = lam(1 + 10 ** (r() * 2.5));
    const tokenReserve = BigInt(Math.floor((minReserve + r() * 6.99e8) * 1e6));
    const spot = Number(30_000_000_000n + realSol) / Number(tokenReserve);
    const vaultTokens = BigInt(Math.floor(1e13 + r() * 3e14));
    const vaultSol = lam(1 + r() * 40);
    const sold = BigInt(Math.floor(r() * 2e14));
    const buyCap = bps(vaultSol, t.buyBpsPerWindow);
    const sellCap = bps(vaultTokens, t.sellBpsPerWindow);
    const chain: Chain = {
      ...launch({ terms: t, virtualSol: 30_000_000_000n, raised: 10_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 2_000n }, now),
      realSol,
      tokenReserve,
      vaultSol,
      vaultTokens,
      vaultCostSol: BigInt(Math.floor(Number(vaultTokens) * spot * (r() < 0.5 ? Math.exp(0.04 * gauss()) : 10 ** (-1.3 * r())))),
      agentTokensSold: sold,
      agentSolReceived: BigInt(Math.floor(Number(sold) * spot * Math.exp(0.05 * gauss()))),
      windowStart: now - BigInt(Math.floor(r() * 2 * Number(t.windowSecs))),
      windowBuyCap: buyCap,
      windowSolSpent: (buyCap * BigInt(Math.floor(r() * 1_000))) / 1_000n,
      windowSellCap: sellCap,
      windowTokensSold: (sellCap * BigInt(Math.floor(r() * 1_000))) / 1_000n,
      // EMA just past either band edge, so the plan is near the line a public trade can push spot over.
      emaPrice: BigInt(Math.floor(spot * 2 ** 64 * (r() < 0.5 ? 1.035 : 0.965) * Math.exp(0.01 * gauss()))),
      lastTradeTs: now - BigInt(Math.floor(r() * 600)),
      volumeSol: lam(10 ** (r() * 4)),
    };
    const plan = evaluate(chain, SIZING, now, DEFAULT_PARAMS, NEUTRAL_FLOW).plan;
    if (plan.action === "hold") continue;
    seen.plans++;
    assert.equal(planRejection(chain, now, plan), null, `state ${i}: fresh ${plan.action} rejected at send time: ${plan.reason}`);

    const moved: Chain = { ...chain };
    const size = Math.exp(gauss() * 1.5 - 1.5);
    const traded =
      r() < 0.5
        ? publicBuy(moved, BigInt(Math.floor(Number(realSol + 30_000_000_000n) * 0.02 * size)) + 1n, 0n, now, 1)
        : publicSell(moved, BigInt(Math.floor(Number(tokenReserve) * 0.02 * size)) + 1n, 0n, now, 1);
    if (!traded.ok) continue;
    const verdict = planRejection(moved, now, plan);
    const probe: Chain = { ...moved };
    const res = plan.action === "buy" ? agentBuy(probe, plan.amount, plan.minOut, now, 2) : agentSell(probe, plan.amount, plan.minOut, now, 2);
    assert.equal(verdict === null, res.ok, `state ${i}: send-time check says ${verdict ?? "ok"}, program says ${res.ok ? "ok" : res.error} (${plan.action} ${plan.amount}: ${plan.reason})`);
    const key = `${plan.action}${verdict === null ? "Passed" : "Rejected"}` as keyof typeof seen;
    seen[key]++;
  }
  // Both sides must actually be exercised in both outcomes.
  assert.ok(seen.buyRejected > 100 && seen.buyPassed > 100 && seen.sellRejected > 100 && seen.sellPassed > 100, JSON.stringify(seen));
}
