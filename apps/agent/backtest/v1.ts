import { BPS, minOut, moveBps, priceQ64, solOut, tokensOut } from "@holdfast/sdk";
import {
  buyBelowAvgSell,
  buyBelowCost,
  buyImpactOk,
  buyToPrice,
  impactTargets,
  largestFeasible,
  minBig,
  project,
  sellAboveCost,
  sellCurveOk,
  sellToPrice,
  type HoldKind,
  type MarketState,
  type Plan,
  type Sizing,
} from "../src/strategy";

/**
 * The agent's decision rule before the parameterized policy, frozen as the `v1` baseline: act 25 bps
 * past the band, size each trade to push spot back to the band edge (≤ 90% of the impact limit) with
 * at most half of the remaining window budget, 50 bps slippage floor. Uses the same exact program-mirror
 * predicates.
 */
const SAFETY_MARGIN_BPS = 25n;
const MAX_FRACTION_BPS = 5_000n;
const SLIPPAGE_BPS = 50;

const hold = (kind: HoldKind): Plan => ({ action: "hold", kind, reason: `v1 ${kind}` });

export function evaluateV1(m: MarketState, s: Sizing, now: bigint): Plan {
  const p = project(m, now);
  const t = m.terms;
  const band = t.bandBps;
  if (p.price <= (p.ema / BPS) * (BPS - band - SAFETY_MARGIN_BPS)) {
    if (m.vaultSol === 0n) return hold("vault_empty");
    const perTrade = minBig((p.buyRemaining * MAX_FRACTION_BPS) / BPS, p.buyRemaining, m.vaultSol);
    if (perTrade < s.minTradeLamports) return hold("budget");
    const ideal = buyToPrice(p, minBig((p.ema * (BPS - band)) / BPS, impactTargets(p, t.maxImpactBps).up));
    if (ideal < s.minTradeLamports) return hold("too_small");
    const hi = minBig(ideal, perTrade);
    const impactOk = (a: bigint) => buyImpactOk(p, t.maxImpactBps, a);
    const fill = (a: bigint) => tokensOut(p.x, p.y, a);
    let solIn = largestFeasible(hi, (a) => impactOk(a) && buyBelowCost(p, a, fill(a)));
    if (solIn < s.minTradeLamports) solIn = largestFeasible(minBig(hi, m.buybackSol), (a) => impactOk(a) && buyBelowAvgSell(m, a, fill(a)));
    if (solIn < s.minTradeLamports) return hold("cost_basis");
    const out = tokensOut(p.x, p.y, solIn);
    const impactBps = moveBps(p.price, priceQ64(p.x + solIn, p.y - out));
    return { action: "buy", kind: "dip", reason: "v1 dip", amount: solIn, expectedOut: out, minOut: minOut(out, SLIPPAGE_BPS), impactBps };
  }
  if (p.price >= (p.ema / BPS) * (BPS + band + SAFETY_MARGIN_BPS)) {
    if (m.vaultTokens === 0n) return hold("vault_empty");
    const perTrade = minBig((p.sellRemaining * MAX_FRACTION_BPS) / BPS, p.sellRemaining, m.vaultTokens);
    if (perTrade === 0n || solOut(p.x, p.y, perTrade) < s.minTradeLamports) return hold("budget");
    const floorTarget = (p.ema * (BPS + band)) / BPS;
    const impactTarget = impactTargets(p, t.maxImpactBps).down;
    const ideal = sellToPrice(p, floorTarget > impactTarget ? floorTarget : impactTarget);
    if (ideal === 0n || solOut(p.x, p.y, ideal) < s.minTradeLamports) return hold("too_small");
    const tokensIn = largestFeasible(minBig(ideal, perTrade), (a) => sellCurveOk(m, p, a) && sellAboveCost(m, a, solOut(p.x, p.y, a)));
    const out = solOut(p.x, p.y, tokensIn);
    if (tokensIn === 0n || out < s.minTradeLamports) return hold("cost_basis");
    const impactBps = moveBps(p.price, priceQ64(p.x - out, p.y + tokensIn));
    return { action: "sell", kind: "rally", reason: "v1 rally", amount: tokensIn, expectedOut: out, minOut: minOut(out, SLIPPAGE_BPS), impactBps };
  }
  return hold(p.price <= p.buyCeiling || p.price >= p.sellFloor ? "entry" : "in_band");
}
