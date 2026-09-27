/**
 * The Band, as data: pure helpers shared by the landing instrument, the agent simulator and the
 * token chart overlay. Everything is derived from indexer rows and the launch's frozen `terms` with
 * the SDK's curve maths (`quoteBuy`/`quoteSell`, `agentZones`, `projectEma`) — no typed limits.
 */
import {
  agentZones,
  BPS,
  bps,
  compact,
  curveOf,
  fmtPrice,
  fmtSol,
  lamportsToSol,
  projectEma,
  quoteBuy,
  quoteSell,
  solOut,
  spotPrice,
  tokensToUi,
  type AgentZones,
  type CurveState,
  type LaunchJson,
} from "@holdfast/sdk";
import type { AgentDecision, Candle, LaunchSummary, TradeRow } from "@/lib/types";
import { SPARKLINE_MIN_POINTS } from "@/lib/thresholds";

/** Never draw a price line with fewer points than this (§4.2 §1, §6.10). */
export const BAND_MIN_POINTS = SPARKLINE_MIN_POINTS;
/** Hero chart: 5-minute candles over the last 24 hours. */
export const HERO_TF = 300 as const;
export const HERO_WINDOW_SECS = 86_400;

/** "2%" / "0.5%" from basis points. */
export const pctFromBps = (b: number) => `${+(b / 100).toFixed(2)}%`;

/** "−2.4%" / "+1.1%" with a typographic minus (same shape as the vault agent's reasons). */
export function fmtDeviation(fraction: number): string {
  const abs = Math.abs(fraction * 100).toFixed(1);
  return fraction < 0 && abs !== "0.0" ? `−${abs}%` : `+${abs}%`;
}

// ---------------------------------------------------------------------------------------------
// Series

export interface BandPoint {
  /** unix seconds */
  time: number;
  /** SOL per whole token */
  price: number;
  /** On-chain EMA as the program would see it at `time`; null before the first known trade. */
  ema: number | null;
}

/** Candles that fall inside the trailing window ending at `nowSec`. */
export function candlesSince(candles: Candle[] | undefined, nowSec: number, windowSecs = HERO_WINDOW_SECS): Candle[] {
  return (candles ?? []).filter((c) => c.time >= nowSec - windowSecs);
}

/**
 * Price line (candle closes, stamped at the candle's end) with the EMA at each point. The EMA comes
 * from the latest trade at or before the point — each trade row carries the launch's EMA and price
 * right after it — projected forward with the program's formula (`projectEma`). Optionally ends
 * with a live "now" point from the launch account.
 */
export function bandSeries(p: {
  candles: Candle[];
  tf: number;
  trades: TradeRow[];
  emaPeriodSecs: number;
  now?: { nowSec: number; launch: Pick<LaunchJson, "priceSol" | "emaSol" | "lastTradeTs"> };
}): BandPoint[] {
  const trades = [...p.trades].sort((a, b) => a.timestamp - b.timestamp);
  const emaAt = (t: number): number | null => {
    let last: TradeRow | undefined;
    for (const tr of trades) {
      if (tr.timestamp > t) break;
      last = tr;
    }
    if (!last || last.emaSol <= 0) return null;
    return projectEma({
      emaSol: last.emaSol,
      priceSol: last.priceSol,
      lastTradeTs: last.timestamp,
      nowSec: t,
      periodSecs: p.emaPeriodSecs,
    });
  };
  const points: BandPoint[] = p.candles.map((c) => {
    const time = c.time + p.tf;
    return { time, price: c.close, ema: emaAt(time) };
  });
  if (p.now && points.length && p.now.nowSec > points[points.length - 1].time) {
    const l = p.now.launch;
    points.push({
      time: p.now.nowSec,
      price: l.priceSol,
      ema: l.emaSol > 0 ? projectEma({ ...l, nowSec: p.now.nowSec, periodSecs: p.emaPeriodSecs }) : null,
    });
  }
  return points;
}

export interface AgentMarker {
  signature: string;
  time: number;
  /** Price right after the agent's trade. */
  price: number;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  /** Spot vs EMA when the agent traded (pre-trade price, as the program checked it). */
  deviation: number | null;
}

/**
 * Spot price just before a vault-agent trade, rebuilt from the post-trade reserves in the row (agent
 * trades pay no fee, so the full SOL amount moved the curve).
 */
export function preTradePrice(t: TradeRow, virtualSol: string | bigint): number {
  const x = BigInt(virtualSol) + BigInt(t.realSol);
  const y = BigInt(t.tokenReserve);
  const sol = BigInt(t.solAmount);
  const tokens = BigInt(t.tokenAmount);
  const before: CurveState = t.isBuy
    ? { virtualSol: 0n, realSol: x - sol, tokenReserve: y + tokens }
    : { virtualSol: 0n, realSol: x + sol, tokenReserve: y - tokens };
  return before.realSol > 0n && before.tokenReserve > 0n ? spotPrice(before) : t.priceSol;
}

/** Vault-agent trades as chart markers (oldest first). */
export function agentMarkers(trades: TradeRow[], virtualSol: string | bigint): AgentMarker[] {
  return trades
    .filter((t) => t.isAgent)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t) => {
      const before = preTradePrice(t, virtualSol);
      return {
        signature: t.signature,
        time: t.timestamp,
        price: t.priceSol,
        side: t.isBuy ? "buy" : "sell",
        sol: lamportsToSol(t.solAmount),
        tokens: tokensToUi(t.tokenAmount),
        deviation: t.emaSol > 0 ? before / t.emaSol - 1 : null,
      };
    });
}

/** "Agent bought 0.12 SOL · −2.4% vs EMA" / "Agent sold 1.2M $MOSH · +3.1% vs EMA". */
export function describeAgentTrade(m: AgentMarker, symbol: string): string {
  const what = m.side === "buy" ? `Agent bought ${fmtSol(m.sol, 4)} SOL` : `Agent sold ${compact(m.tokens)} $${symbol}`;
  return m.deviation === null ? what : `${what} · ${fmtDeviation(m.deviation)} vs EMA`;
}

/** Band edges around an EMA value. */
export function bandEdges(ema: number, bandBps: number): { low: number; high: number } {
  const b = bandBps / 10_000;
  return { low: ema * (1 - b), high: ema * (1 + b) };
}

// ---------------------------------------------------------------------------------------------
// Hero pick

/** Live launch with the most trades — the hero's fallback when the king has too little history. */
export function mostTraded(live: LaunchSummary[]): LaunchSummary | null {
  let best: LaunchSummary | null = null;
  for (const l of live) {
    if (l.status !== "live") continue;
    if (!best || l.tradeCount > best.tradeCount) best = l;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Vault agent decisions (from the agent's /status)

/**
 * A raw agent action as user copy: hold → "Holding", skip → "Waiting" (cooldown, back-off or pause;
 * the reason says which), buy → "Buying the dip" / "Bought", sell → "Selling the rally" / "Sold".
 */
export function decisionLabel(d: Pick<AgentDecision, "action" | "signature">): string {
  switch (d.action) {
    case "buy":
      return d.signature ? "Bought" : "Buying the dip";
    case "sell":
      return d.signature ? "Sold" : "Selling the rally";
    case "skip":
      return "Waiting";
    default:
      return "Holding";
  }
}

/**
 * The clause of an agent reason worth a headline: "price inside band (+0.4% vs EMA)" → "price
 * inside band"; "cooldown after last trade, 12s left; wants dip …" → "cooldown after last trade, 12s left".
 */
export function decisionClause(reason: string): string {
  return reason.split(";")[0].split(" (")[0].split(":")[0].trim();
}

/** One-line headline for an agent decision: "Holding: price inside band", "Waiting: cooldown …", "Bought". */
export function decisionHeadline(d: Pick<AgentDecision, "action" | "reason" | "signature" | "error">): string {
  if (d.error && (d.action === "buy" || d.action === "sell")) return `${d.action === "buy" ? "Buy" : "Sell"} failed`;
  const label = decisionLabel(d);
  if (d.action === "buy" || d.action === "sell") return label;
  const clause = decisionClause(d.reason);
  return clause ? `${label}: ${clause}` : label;
}

/** Spot vs EMA of a decision, as a fraction. */
export const decisionDeviation = (d: Pick<AgentDecision, "priceSol" | "emaSol">) =>
  d.emaSol > 0 ? d.priceSol / d.emaSol - 1 : 0;

// ---------------------------------------------------------------------------------------------
// Agent simulator: the on-chain agent rules evaluated at a hypothetical spot price.

/** Integer square root (floor) for bigints. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/** Spot S (SOL per whole token) is S·1e3 lamports per base unit; scaled by 1e24 for bigint maths. */
const PRICE_SCALE = 10n ** 24n;

/**
 * The launch's curve after a trade moves spot to `price` (SOL per whole token) along x·y = k.
 * Clamped at the curve's floor (no real SOL left).
 */
export function curveAtPrice(c: CurveState, price: number): CurveState {
  const x = c.virtualSol + c.realSol;
  const k = x * c.tokenReserve;
  const raw = BigInt(Math.max(0, Math.round(price * 1e27)));
  let x2 = isqrt((k * raw) / PRICE_SCALE);
  if (x2 < c.virtualSol) x2 = c.virtualSol;
  return { virtualSol: c.virtualSol, realSol: x2 - c.virtualSol, tokenReserve: k / x2 };
}

/** Lowest spot the curve can reach (all real SOL sold back out). */
export function curveFloorPrice(c: CurveState): number {
  const k = (c.virtualSol + c.realSol) * c.tokenReserve;
  return spotPrice({ virtualSol: c.virtualSol, realSol: 0n, tokenReserve: k / c.virtualSol });
}

/** Largest a in [0, hi] with ok(a), assuming ok is monotone (true, then false). */
function largest(hi: bigint, ok: (a: bigint) => boolean): bigint {
  if (hi <= 0n) return 0n;
  if (ok(hi)) return hi;
  if (!ok(1n)) return 0n;
  let lo = 1n;
  let top = hi - 1n;
  while (lo < top) {
    const mid = (lo + top + 1n) >> 1n;
    if (ok(mid)) lo = mid;
    else top = mid - 1n;
  }
  return lo;
}

/** Window budgets as the program will see them now (`roll_window`). */
export function windowBudgets(l: LaunchJson, nowSec: number): { buySol: bigint; sellTokens: bigint; resetsAt: number } {
  const t = l.terms;
  if (nowSec >= l.windowStart + t.agentWindowSecs) {
    return {
      buySol: bps(BigInt(l.vaultSol), t.agentBuyBpsPerWindow),
      sellTokens: bps(BigInt(l.vaultTokens), t.agentSellBpsPerWindow),
      resetsAt: nowSec + t.agentWindowSecs,
    };
  }
  const buyCap = BigInt(l.windowBuyCap);
  const spent = BigInt(l.windowSolSpent);
  const sellCap = BigInt(l.windowSellCap);
  const sold = BigInt(l.windowTokensSold);
  return {
    buySol: buyCap > spent ? buyCap - spent : 0n,
    sellTokens: sellCap > sold ? sellCap - sold : 0n,
    resetsAt: l.windowStart + t.agentWindowSecs,
  };
}

export type SimAction = "buy" | "sell" | "hold";

export interface SimCheck {
  id: "price" | "cost" | "budget" | "impact";
  label: string;
  ok: boolean;
  detail: string;
}

export interface SimDecision {
  action: SimAction;
  /** Plain-English reason in the vault agent's own wording. */
  reason: string;
  /** "Up to 0.0297 SOL this window" / "Up to 1.13M tokens this window" / null on hold. */
  size: string | null;
  /** Which side's rules the checklist shows (below the EMA → buy rules, above → sell rules). */
  side: "buy" | "sell";
  checks: SimCheck[];
  deviation: number;
  zones: AgentZones;
}

const sol4 = (lamports: bigint) => `${fmtSol(lamportsToSol(lamports), 4)} SOL`;
const avg = (lamports: bigint, base: bigint) =>
  fmtPrice(base > 0n ? Number(lamports) / 1e9 / (Number(base) / 1e6) : 0);

/**
 * What the program would let the vault agent do if spot were `price` right now: the launch's
 * frozen terms, its vault, window budgets and cost basis, with SDK quotes on the moved curve
 * (agent trades pay no fee). Sizes are the largest fill every on-chain check accepts.
 */
export function simulateAgent(l: LaunchJson, price: number, nowSec: number): SimDecision {
  const t = l.terms;
  const zones = agentZones(l, nowSec);
  const band = BigInt(t.agentBandBps);
  const maxImpact = t.agentMaxImpactBps;
  const bandPct = pctFromBps(t.agentBandBps);
  const impactPct = pctFromBps(maxImpact);
  const c = curveAtPrice(curveOf(l), price);
  const spot = spotPrice(c);
  const deviation = zones.ema > 0 ? spot / zones.ema - 1 : 0;
  const dev = fmtDeviation(deviation);
  const budgets = windowBudgets(l, nowSec);
  const vaultSol = BigInt(l.vaultSol);
  const vaultTokens = BigInt(l.vaultTokens);
  const [costSol, costTokens] =
    vaultTokens > 0n ? [BigInt(l.vaultCostSol), vaultTokens] : [BigInt(l.bundleSol), BigInt(l.bundleTokens)];
  const side: "buy" | "sell" = spot < zones.ema ? "buy" : "sell";

  if (side === "buy") {
    const isDip = spot <= zones.bandLow;
    const cap = budgets.buySol < vaultSol ? budgets.buySol : vaultSol;
    const impactOk = (a: bigint) => {
      const q = quoteBuy(c, a, 0);
      return q.tokensOut > 0n && q.tokensOut < c.tokenReserve && q.impactBps <= maxImpact;
    };
    const belowCost = (a: bigint) => a * costTokens <= quoteBuy(c, a, 0).tokensOut * costSol;
    const soldTokens = BigInt(l.agentTokensSold);
    const buyback = BigInt(l.buybackSol);
    const belowAvgSell = (a: bigint) =>
      soldTokens > 0n &&
      a <= buyback &&
      a * soldTokens * BPS <= quoteBuy(c, a, 0).tokensOut * BigInt(l.agentSolReceived) * (BPS - band);

    let size = largest(cap, (a) => impactOk(a) && belowCost(a));
    let how = `at/below vault avg cost ${avg(costSol, costTokens)}`;
    let costOk = belowCost(1n);
    if (size === 0n) {
      const bb = largest(cap < buyback ? cap : buyback, (a) => impactOk(a) && belowAvgSell(a));
      if (bb > 0n) {
        size = bb;
        how = `buy-back below avg sell ${avg(BigInt(l.agentSolReceived), soldTokens)}`;
        costOk = true;
      }
    }
    const impact = size > 0n ? quoteBuy(c, size, 0).impactBps : 0;
    const checks: SimCheck[] = [
      { id: "price", label: `Price ≥ ${bandPct} under EMA`, ok: isDip, detail: `${dev} vs EMA` },
      {
        id: "cost",
        label: "Fill ≤ vault avg cost",
        ok: costOk,
        detail: `avg cost ${fmtPrice(zones.avgCost)}`,
      },
      {
        id: "budget",
        label: "Window budget left",
        ok: cap > 0n,
        detail: `${sol4(cap)} left`,
      },
      {
        id: "impact",
        label: `Impact ≤ ${impactPct}`,
        ok: size > 0n || cap === 0n ? impact <= maxImpact : impactOk(1n),
        detail: size > 0n ? `${(impact / 100).toFixed(2)}% at full size` : `max ${impactPct}`,
      },
    ];
    if (!isDip) {
      return { action: "hold", reason: `price inside band (${dev} vs EMA)`, size: null, side, checks, deviation, zones };
    }
    if (vaultSol === 0n) {
      return { action: "hold", reason: `dip ${dev} vs EMA but vault has no SOL`, size: null, side, checks, deviation, zones };
    }
    if (cap === 0n) {
      return {
        action: "hold",
        reason: `window budget exhausted (${sol4(cap)} left)`,
        size: null,
        side,
        checks,
        deviation,
        zones,
      };
    }
    if (size === 0n) {
      const why = costOk
        ? "impact limit leaves no buy"
        : `spot above vault avg cost ${avg(costSol, costTokens)}, buy-back budget ${sol4(buyback)}`;
      return { action: "hold", reason: `dip ${dev} vs EMA but ${why}`, size: null, side, checks, deviation, zones };
    }
    return {
      action: "buy",
      reason: `dip ${dev} vs EMA: buy up to ${sol4(size)} ${how} (impact ${(impact / 100).toFixed(2)}%)`,
      size: `Up to ${sol4(size)} this window`,
      side,
      checks,
      deviation,
      zones,
    };
  }

  // Sell side.
  const isRally = spot >= zones.bandHigh;
  const x = c.virtualSol + c.realSol;
  const cap = budgets.sellTokens < vaultTokens ? budgets.sellTokens : vaultTokens;
  const fillOk = (a: bigint) => {
    const out = solOut(x, c.tokenReserve, a);
    return out > 0n && out * vaultTokens * BPS >= a * BigInt(l.vaultCostSol) * (BPS + band);
  };
  const impactOk = (a: bigint) => {
    const out = solOut(x, c.tokenReserve, a);
    return out > 0n && out <= c.realSol && quoteSell(c, a, 0).impactBps <= maxImpact;
  };
  const size = vaultTokens > 0n ? largest(cap, (a) => fillOk(a) && impactOk(a)) : 0n;
  // Smallest sell that returns any SOL: probes the fill rule at spot.
  const probe = x > 0n ? c.tokenReserve / x + 1n : 1n;
  const costOk = vaultTokens > 0n && fillOk(probe);
  const q = size > 0n ? quoteSell(c, size, 0) : null;
  const need = vaultTokens > 0n ? avg((BigInt(l.vaultCostSol) * (BPS + band)) / BPS, vaultTokens) : "—";
  const checks: SimCheck[] = [
    { id: "price", label: `Price ≥ ${bandPct} over EMA`, ok: isRally, detail: `${dev} vs EMA` },
    { id: "cost", label: `Fill ≥ avg cost + ${bandPct}`, ok: costOk, detail: `needs ≥ ${need}` },
    {
      id: "budget",
      label: "Window budget left",
      ok: cap > 0n,
      detail: `${compact(tokensToUi(cap))} tokens left`,
    },
    {
      id: "impact",
      label: `Impact ≤ ${impactPct}`,
      ok: q ? q.impactBps <= maxImpact : impactOk(probe),
      detail: q ? `${(q.impactBps / 100).toFixed(2)}% at full size` : `max ${impactPct}`,
    },
  ];
  if (!isRally) {
    return { action: "hold", reason: `price inside band (${dev} vs EMA)`, size: null, side, checks, deviation, zones };
  }
  if (vaultTokens === 0n) {
    return { action: "hold", reason: `rally ${dev} vs EMA but vault has no tokens`, size: null, side, checks, deviation, zones };
  }
  if (cap === 0n) {
    return {
      action: "hold",
      reason: `window budget exhausted (${compact(tokensToUi(cap))} tokens left)`,
      size: null,
      side,
      checks,
      deviation,
      zones,
    };
  }
  if (!q) {
    const why = costOk ? "impact/cost limits leave no sell" : `fill must be ≥ ${need} (vault avg cost + band)`;
    return { action: "hold", reason: `rally ${dev} vs EMA but ${why}`, size: null, side, checks, deviation, zones };
  }
  return {
    action: "sell",
    reason: `rally ${dev} vs EMA: sell up to ${compact(tokensToUi(size))} tokens for ~${sol4(q.solOut)} (impact ${(q.impactBps / 100).toFixed(2)}%)`,
    size: `Up to ${compact(tokensToUi(size))} tokens this window`,
    side,
    checks,
    deviation,
    zones,
  };
}

/**
 * Presets for the simulator chips. Moves are relative to the launch's spot and clamped at the curve
 * floor (labels show the move the curve can actually make); moves the curve can't make are dropped.
 */
export function simulatorPresets(l: LaunchJson, nowSec: number): { id: string; label: string; price: number }[] {
  const z = agentZones(l, nowSec);
  const spot = l.priceSol;
  const floor = curveFloorPrice(curveOf(l)) * 1.0001;
  const drop = Math.max(spot * 0.92, floor);
  const dump = Math.max(Math.min(z.avgCost, z.bandLow) * 0.97, floor);
  const dropPct = (1 - drop / spot) * 100;
  const presets: { id: string; label: string; price: number }[] = [];
  // Skip a drop the floor squeezes to nothing, or one that lands where the dump preset does.
  if (dropPct >= 0.5 && Math.abs(drop - dump) / spot > 0.001) {
    presets.push({ id: "drop", label: `Price drops ${+dropPct.toFixed(1)}%`, price: drop });
  }
  presets.push({ id: "inside", label: "Inside band", price: z.ema }, { id: "rally", label: "Rally +6%", price: spot * 1.06 });
  if (dump < z.avgCost) presets.push({ id: "dump", label: "Dump below cost", price: dump });
  return presets;
}

/**
 * Vertical domain for the simulator: spot, the band (EMA ± band) and the nearby presets, padded so
 * the handle has room on both sides of the band. Reference levels far from the action (vault avg
 * cost, curve floor, a sell fill floor) don't stretch it — the diagram pins those to its edge.
 * `include` adds a price the user jumped to (the "Dump below cost" preset). `floor` is the lowest spot
 * the curve can reach; the domain may extend below it, but a simulated price never goes under it.
 */
export function simulatorDomain(
  l: LaunchJson,
  nowSec: number,
  include: number | null = null,
): { min: number; max: number; floor: number } {
  const z = agentZones(l, nowSec);
  const near = simulatorPresets(l, nowSec)
    .filter((p) => p.id !== "dump")
    .map((p) => p.price);
  const floor = curveFloorPrice(curveOf(l));
  const core = [z.bandLow, z.bandHigh, l.priceSol, ...near, ...(include === null ? [] : [include])];
  const lo = Math.min(...core);
  const hi = Math.max(...core);
  const pad = Math.max((z.bandHigh - z.bandLow) * 0.75, (hi - lo) * 0.2);
  return { min: Math.max(0, lo - pad), max: hi + pad, floor };
}
