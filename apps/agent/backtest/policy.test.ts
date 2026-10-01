import assert from "node:assert/strict";
import { test } from "node:test";
import { bps } from "@holdfast/sdk";
import { NEUTRAL_FLOW, type FlowFeatures } from "../src/flow";
import { DEFAULT_PARAMS, PARAM_KEYS, PARAM_SPACE, evaluate, type Sizing, type StrategyParams } from "../src/strategy";
import { PRODUCTION_TERMS, agentBuy, agentSell, launch, publicTokens, type Chain } from "./program";
import { Market, T0, mulberry32, type Rng } from "./sim";

function randomParams(r: Rng): StrategyParams {
  const p = { ...DEFAULT_PARAMS };
  for (const k of PARAM_KEYS) {
    const { lo, hi, log } = PARAM_SPACE[k];
    p[k] = log ? lo * (hi / lo) ** r() : lo + r() * (hi - lo);
  }
  return p;
}

const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const randomSizing = (r: Rng): Sizing => ({ minTradeLamports: BigInt(Math.floor(10 ** (5 + r() * 3))), slippageBps: Math.floor(r() * 300) });

/** Flow features across their whole range (gates, margin cuts and the early-cap relief all fire somewhere). */
function randomFlow(r: Rng): FlowFeatures {
  if (r() < 0.2) return NEUTRAL_FLOW;
  const volumeSol = 10 ** (r() * 3 - 2);
  return {
    spanSecs: Math.floor(r() * 1_800),
    volumeSol,
    netSol: volumeSol * (2 * r() - 1),
    trades: Math.floor(r() * 50),
    imbalance: 2 * r() - 1,
    imbalanceRecent: 2 * r() - 1,
    volumeRatio: 10 ** (r() * 2 - 1),
    volumeRatioRecent: 10 ** (r() * 2 - 1),
    vwapDevBps: 3_000 * (r() - 0.5),
    sinceTradeSecs: Math.floor(r() * 600),
  };
}

// Random walks through launch states. Public flow keeps pushing spot around the thresholds the
// program checks (vault average cost, average agent sell price × (1 − band), the EMA band edges),
// idle gaps move the EMA and roll windows, and the agent's own planned trades are applied so
// buy-backs and cost-basis changes happen. At every step the plan, under random parameters and
// sizing, must pass the program mirror on that exact state and clock, and every lamport the agent
// sold for must be back in the vault or credited to backers as profit.
test("policy never plans a trade the program rejects along launch histories", () => {
  const r = mulberry32(20_260_930);
  let plans = 0;
  let buys = 0;
  let sells = 0;
  let profitShared = 0n;
  for (let walk = 0; walk < 80; walk++) {
    const chain = launch(
      {
        terms: PRODUCTION_TERMS,
        virtualSol: 30_000_000_000n,
        raised: BigInt(Math.round((1 + r() * 60) * 1e9)),
        reserveBps: BigInt(Math.floor(r() * 8_000)),
        bundleSupplyBps: BigInt(100 + Math.floor(r() * 2_900)),
      },
      BigInt(T0),
    );
    const market = new Market(chain, null);
    const vaultSol0 = chain.vaultSol;
    for (let step = 0; step < 200; step++) {
      market.t += 1_000 + Math.floor(r() < 0.08 ? r() * 7_200_000 : r() * 60_000);
      const spot = market.spot();
      const u = r();
      let target: number;
      if (u < 0.3) target = (Number(chain.vaultCostSol) / Number(chain.vaultTokens || 1n)) * Math.exp(0.08 * gauss(r));
      else if (u < 0.45 && chain.agentTokensSold > 0n) target = (Number(chain.agentSolReceived) / Number(chain.agentTokensSold)) * 0.98 * Math.exp(0.03 * gauss(r));
      else if (u < 0.8) target = (Number(chain.emaPrice) / 2 ** 64) * (1 + 0.1 * (r() - 0.5));
      else target = spot * Math.exp(0.3 * gauss(r));
      if (publicTokens(chain) > 0n || target > spot) market.moveTo(Math.log(target));

      market.t += 1_000;
      const now = market.now();
      for (let k = 0; k < 3; k++) {
        const plan = evaluate(chain, randomSizing(r), now, k === 0 ? DEFAULT_PARAMS : randomParams(r), randomFlow(r)).plan;
        if (plan.action === "hold") continue;
        plans++;
        const probe = { ...chain };
        const res =
          plan.action === "buy"
            ? agentBuy(probe, plan.amount, plan.minOut, now, market.slot())
            : agentSell(probe, plan.amount, plan.minOut, now, market.slot());
        assert.ok(res.ok, `walk ${walk} step ${step}: ${plan.action} ${plan.amount} rejected with ${res.ok ? "" : res.error}: ${plan.reason}`);
        if (k === 0 && r() < 0.8) {
          Object.assign(chain, probe);
          if (plan.action === "buy") buys++;
          else sells++;
        }
      }
      assert.equal(
        chain.vaultSol + chain.agentSolSpent + chain.profitShared,
        vaultSol0 + chain.agentSolReceived,
        `walk ${walk} step ${step}: vault SOL + spent + profit shared ≠ start + received`,
      );
    }
    profitShared += chain.profitShared;
  }
  // The walks must actually reach both sides, including buy-backs after sells and sells in profit.
  assert.ok(plans > 2_000 && buys > 200 && sells > 200, `too few trades exercised: ${plans} plans, ${buys} buys, ${sells} sells`);
  assert.ok(profitShared > 0n, "no agent sell realized a profit");
});

/** Lamports for about `sol` SOL. */
const lam = (sol: number) => BigInt(Math.floor(sol * 1e9));

// Arbitrary (not necessarily reachable) states right at the program's thresholds: vault cost,
// average agent sell price and EMA each within a few % of spot, windows part-used or expired,
// empty vault sides, small curves where the impact limit and `realSol` bind.
test("policy never plans a trade the program rejects on arbitrary states", () => {
  const r = mulberry32(7_331);
  const t = PRODUCTION_TERMS;
  const now = BigInt(T0 + 100_000);
  let buys = 0;
  let sells = 0;
  for (let i = 0; i < 30_000; i++) {
    const realSol = lam(10 ** (r() * 2.7) - 1);
    const tokenReserve = BigInt(Math.floor((3e8 + r() * 6.99e8) * 1e6));
    const spot = Number(30_000_000_000n + realSol) / Number(tokenReserve);
    const vaultTokens = r() < 0.05 ? 0n : BigInt(Math.floor(r() * 3e14));
    const vaultSol = r() < 0.05 ? 0n : lam(r() * 60);
    const sold = r() < 0.3 ? 0n : BigInt(Math.floor(r() * 2e14));
    const received = BigInt(Math.floor(Number(sold) * spot * Math.exp(0.05 * gauss(r))));
    const buyCap = bps(vaultSol, t.buyBpsPerWindow);
    const sellCap = bps(vaultTokens, t.sellBpsPerWindow);
    const chain: Chain = {
      ...launch({ terms: t, virtualSol: 30_000_000_000n, raised: 10_000_000_000n, reserveBps: 3_000n, bundleSupplyBps: 2_000n }, now),
      realSol,
      tokenReserve,
      vaultSol,
      vaultTokens,
      vaultCostSol: BigInt(Math.floor(Number(vaultTokens) * spot * Math.exp(0.04 * gauss(r)))),
      agentTokensSold: sold,
      agentSolReceived: received,
      buybackSol: BigInt(Math.floor(Number(received) * r())),
      windowStart: now - BigInt(Math.floor(r() * 2 * Number(t.windowSecs))),
      windowBuyCap: buyCap,
      windowSolSpent: (buyCap * BigInt(Math.floor(r() * 1_000))) / 1_000n,
      windowSellCap: sellCap,
      windowTokensSold: (sellCap * BigInt(Math.floor(r() * 1_000))) / 1_000n,
      emaPrice: BigInt(Math.floor(spot * 2 ** 64 * Math.exp(0.06 * gauss(r)))),
      lastTradeTs: now - BigInt(Math.floor(r() * 600)),
      volumeSol: lam(10 ** (r() * 4)),
    };
    const plan = evaluate(chain, randomSizing(r), now, i % 2 === 0 ? DEFAULT_PARAMS : randomParams(r), randomFlow(r)).plan;
    if (plan.action === "hold") continue;
    const res = plan.action === "buy" ? agentBuy(chain, plan.amount, plan.minOut, now, 1) : agentSell(chain, plan.amount, plan.minOut, now, 1);
    assert.ok(res.ok, `state ${i}: ${plan.action} ${plan.amount} rejected with ${res.ok ? "" : res.error}: ${plan.reason}`);
    if (plan.action === "buy") buys++;
    else sells++;
  }
  assert.ok(buys > 500 && sells > 500, `too few trades exercised: ${buys} buys, ${sells} sells`);
});
