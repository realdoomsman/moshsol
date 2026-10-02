import {
  BPS,
  PUMP_VENUE_FEE_BPS,
  bps,
  bpsCeil,
  compact,
  countdown,
  fmtPrice,
  fmtSol,
  lamportsToSol,
  minOut,
  moveBps,
  priceQ64,
  q64ToSolPerToken,
  solOut,
  tokensOut,
  tokensToUi,
  venueOf,
  type CurveState,
  type LaunchAccount,
  type LaunchVenue,
} from "@holdfast/sdk";
import { FLOW_SHORT_SECS, type FlowFeatures } from "./flow";

/**
 * Pure decision logic in two layers.
 *
 * 1. Program mirror (`project`, `buyImpactOk`, `buyBelowCost`, `buyBelowAvgSell`, `sellCurveOk`, `sellAboveCost`):
 *    bigint-exact copies of programs/moshsol (state.rs `roll_window`, `update_ema`, `cost_basis`;
 *    instructions/agent.rs checks), so the agent sees exactly what the program will see at the given
 *    chain timestamp. All limits come from the launch's immutable `terms`, never from platform params.
 * 2. Policy (`StrategyParams`): how far past the band to wait before acting, how much of the
 *    bundle a rally may sell at a given price (inventory floor + sell guardrail), and how a dip is
 *    bought back (support mode). It only chooses among trades the mirror accepts.
 */

/** Size trades to use at most 90% of the on-chain impact limit. */
const IMPACT_USE_NUM = 9n;
const IMPACT_USE_DEN = 10n;

// ------------------------------------------------------------------ program mirror

/** Agent-relevant subset of `Launch.terms`, as bigint. */
export interface AgentTerms {
  bandBps: bigint;
  maxImpactBps: bigint;
  buyBpsPerWindow: bigint;
  sellBpsPerWindow: bigint;
  windowSecs: bigint;
  emaPeriodSecs: bigint;
  /** Lamports of vault SOL no agent buy (and no backer payout) may go below: the launch's fee / rent reserve. */
  minVaultSol: bigint;
}

/**
 * Launch fields the agent logic reads, as bigint. The reserves are the launch's own curve on Holdfast
 * launches and the venue's (bonding curve virtual reserves, or the PumpSwap pool balances) on pump
 * launches, so `project()` prices exactly what `agent_*` / `agent_*_pump` read.
 */
export interface MarketState {
  venue: LaunchVenue;
  terms: AgentTerms;
  virtualSol: bigint;
  realSol: bigint;
  tokenReserve: bigint;
  vaultSol: bigint;
  vaultTokens: bigint;
  vaultCostSol: bigint;
  bundleSol: bigint;
  bundleTokens: bigint;
  agentSolReceived: bigint;
  agentTokensSold: bigint;
  windowStart: bigint;
  windowBuyCap: bigint;
  windowSolSpent: bigint;
  windowSellCap: bigint;
  windowTokensSold: bigint;
  emaPrice: bigint;
  lastTradeTs: bigint;
  /** Cumulative counters the flow window (`flow.ts`) differences between polls. */
  volumeSol: bigint;
  tradeCount: number;
  agentBuys: number;
  agentSells: number;
  agentSolSpent: bigint;
}

/** `venue` is required for pump launches: their reserves live on pump.fun / PumpSwap (`fetchVenueState`). */
export function marketOf(l: LaunchAccount, venue?: CurveState): MarketState {
  const b = (v: { toString(): string }) => BigInt(v.toString());
  const t = l.terms;
  const kind = venueOf(l);
  let reserves: CurveState;
  if (kind === "pump") {
    if (!venue) throw new Error("marketOf: pump launch without its venue state");
    reserves = venue;
  } else {
    reserves = { virtualSol: b(l.virtualSol), realSol: b(l.realSol), tokenReserve: b(l.tokenReserve) };
  }
  return {
    venue: kind,
    terms: {
      bandBps: BigInt(t.agentBandBps),
      maxImpactBps: BigInt(t.agentMaxImpactBps),
      buyBpsPerWindow: BigInt(t.agentBuyBpsPerWindow),
      sellBpsPerWindow: BigInt(t.agentSellBpsPerWindow),
      windowSecs: BigInt(t.agentWindowSecs),
      emaPeriodSecs: BigInt(t.emaPeriodSecs),
      minVaultSol: b(t.minVaultSol),
    },
    virtualSol: reserves.virtualSol,
    realSol: reserves.realSol,
    tokenReserve: reserves.tokenReserve,
    vaultSol: b(l.vaultSol),
    vaultTokens: b(l.vaultTokens),
    vaultCostSol: b(l.vaultCostSol),
    bundleSol: b(l.bundleSol),
    bundleTokens: b(l.bundleTokens),
    agentSolReceived: b(l.agentSolReceived),
    agentTokensSold: b(l.agentTokensSold),
    windowStart: b(l.windowStart),
    windowBuyCap: b(l.windowBuyCap),
    windowSolSpent: b(l.windowSolSpent),
    windowSellCap: b(l.windowSellCap),
    windowTokensSold: b(l.windowTokensSold),
    emaPrice: b(l.emaPrice),
    lastTradeTs: b(l.lastTradeTs),
    volumeSol: b(l.volumeSol),
    tradeCount: Number(l.tradeCount.toString()),
    agentBuys: l.agentBuys,
    agentSells: l.agentSells,
    agentSolSpent: b(l.agentSolSpent),
  };
}

export interface Sizing {
  minTradeLamports: bigint;
  slippageBps: number;
}

/** State as the program will see it after `roll_window` + `update_ema` at `now`. */
export interface Projection {
  now: bigint;
  x: bigint;
  y: bigint;
  price: bigint;
  ema: bigint;
  /** Highest price at which agent_buy is allowed (program formula, integer-exact). */
  buyCeiling: bigint;
  /** Lowest price at which agent_sell is allowed. */
  sellFloor: bigint;
  /** Start of the agent window the next trade lands in (`now` when that trade would roll it). */
  windowStart: bigint;
  windowEnd: bigint;
  /** Window caps as snapshotted by `roll_window` (lamports / token base units). */
  buyCap: bigint;
  sellCap: bigint;
  buyRemaining: bigint;
  sellRemaining: bigint;
  /** Deviation of spot from EMA in 1e-4 % units (1_000_000 = 100%). */
  deviationPpm: bigint;
  /** Vault average cost as (lamports, token base units), `Launch::cost_basis`. */
  costSol: bigint;
  costTokens: bigint;
}

export function project(m: MarketState, now: bigint): Projection {
  const t = m.terms;
  const x = m.virtualSol + m.realSol;
  const y = m.tokenReserve;
  const price = priceQ64(x, y);

  let windowStart = m.windowStart;
  let buyCap = m.windowBuyCap;
  let sellCap = m.windowSellCap;
  let buyRemaining = m.windowBuyCap > m.windowSolSpent ? m.windowBuyCap - m.windowSolSpent : 0n;
  let sellRemaining = m.windowSellCap > m.windowTokensSold ? m.windowSellCap - m.windowTokensSold : 0n;
  if (now >= m.windowStart + t.windowSecs) {
    windowStart = now;
    buyCap = bps(m.vaultSol, t.buyBpsPerWindow);
    sellCap = bps(m.vaultTokens, t.sellBpsPerWindow);
    buyRemaining = buyCap;
    sellRemaining = sellCap;
  }

  // EMA weight dt / (dt + period), floored step, applied before reserves change. Pump launches sample the
  // venue price only on agent trades, so the program clamps dt to the period there (`update_ema_with`).
  let ema = m.emaPrice;
  if (ema === 0n) {
    ema = price;
  } else {
    const idle = now > m.lastTradeTs ? now - m.lastTradeTs : 0n;
    const dt = m.venue === "pump" && idle > t.emaPeriodSecs ? t.emaPeriodSecs : idle;
    const den = dt + t.emaPeriodSecs;
    if (price >= ema) ema += ((price - ema) * dt) / den;
    else ema -= ((ema - price) * dt) / den;
  }

  const [costSol, costTokens] = m.vaultTokens > 0n ? [m.vaultCostSol, m.vaultTokens] : [m.bundleSol, m.bundleTokens];
  return {
    now,
    x,
    y,
    price,
    ema,
    buyCeiling: (ema / BPS) * (BPS - t.bandBps),
    sellFloor: (ema / BPS) * (BPS + t.bandBps),
    windowStart,
    windowEnd: windowStart + t.windowSecs,
    buyCap,
    sellCap,
    buyRemaining,
    sellRemaining,
    deviationPpm: ((price - ema) * 1_000_000n) / ema,
    costSol,
    costTokens,
  };
}

/**
 * The venue's taker fee on the agent's own trades: pump.fun and PumpSwap take 1.25% of every fill
 * (`pump_venue.rs` measures the fill net of it), the Holdfast curve charges agent trades nothing.
 */
export function venueFeeBps(m: Pick<MarketState, "venue">): bigint {
  return m.venue === "pump" ? BigInt(PUMP_VENUE_FEE_BPS) : 0n;
}

/** Lamports of a buy of `solIn` that reach the reserves (the venue's fee, rounded up, comes off first). */
export function buyNet(m: Pick<MarketState, "venue">, solIn: bigint): bigint {
  return solIn - bpsCeil(solIn, venueFeeBps(m));
}

/** Smallest `solIn` whose net reaches `net` (the identity on the Holdfast curve). */
export function grossForNet(m: Pick<MarketState, "venue">, net: bigint): bigint {
  const fee = venueFeeBps(m);
  return (net * BPS + (BPS - fee) - 1n) / (BPS - fee);
}

/** Tokens a buy of `solIn` fills (`spent` / `tokens` of `agent_buy*`). */
export function buyFill(m: Pick<MarketState, "venue">, p: Projection, solIn: bigint): bigint {
  return tokensOut(p.x, p.y, buyNet(m, solIn));
}

/**
 * A sell of `tokensIn`: `gross` leaves the reserves (never more than what is real), `net` is what the
 * launch receives after the venue's fee (the `sol` of `agent_sell*`, checked against cost basis and `min_sol_out`).
 */
export function sellFill(m: Pick<MarketState, "venue" | "realSol">, p: Projection, tokensIn: bigint): { gross: bigint; net: bigint } {
  const out = solOut(p.x, p.y, tokensIn);
  const gross = out > m.realSol ? m.realSol : out;
  return { gross, net: gross - bpsCeil(gross, venueFeeBps(m)) };
}

/** agent_buy impact check for `solIn` lamports: the move is at most `maxImpactBps` (rounded up). */
export function buyImpactOk(m: MarketState, p: Projection, solIn: bigint): boolean {
  const net = buyNet(m, solIn);
  const out = tokensOut(p.x, p.y, net);
  if (net <= 0n || out <= 0n || out >= p.y) return false;
  return moveBps(p.price, priceQ64(p.x + net, p.y - out)) <= m.terms.maxImpactBps;
}

/** agent_buy path 1: fill price (solIn / tokens) at or below the vault's average cost. */
export function buyBelowCost(p: Projection, solIn: bigint, tokens: bigint): boolean {
  return solIn * p.costTokens <= tokens * p.costSol;
}

/** agent_buy path 2 (buy-back, paid from vault SOL like any buy): fill at least `band` below the average agent sell price. */
export function buyBelowAvgSell(m: MarketState, solIn: bigint, tokens: bigint): boolean {
  return m.agentTokensSold > 0n && solIn * m.agentTokensSold * BPS <= tokens * m.agentSolReceived * (BPS - m.terms.bandBps);
}

/** agent_buy cost rule: either path. Monotone in `solIn` (the fill price only rises with size), so `largestFeasible` applies. */
export function buyCostOk(m: MarketState, p: Projection, solIn: bigint, tokens: bigint): boolean {
  return buyBelowCost(p, solIn, tokens) || buyBelowAvgSell(m, solIn, tokens);
}

/** Vault SOL an agent buy may spend: everything above the launch's `minVaultSol` floor (`VaultFloor`). */
export function spendableSol(m: Pick<MarketState, "vaultSol" | "terms">): bigint {
  return m.vaultSol > m.terms.minVaultSol ? m.vaultSol - m.terms.minVaultSol : 0n;
}

/** agent_sell curve and impact checks for `tokensIn` base units. */
export function sellCurveOk(m: MarketState, p: Projection, tokensIn: bigint): boolean {
  const out = solOut(p.x, p.y, tokensIn);
  if (out <= 0n || out > m.realSol) return false;
  return moveBps(p.price, priceQ64(p.x - out, p.y + tokensIn)) <= m.terms.maxImpactBps;
}

/** agent_sell cost basis: net fill (sol / tokensIn) at least the vault's average cost plus band. */
export function sellAboveCost(m: MarketState, tokensIn: bigint, sol: bigint): boolean {
  return sol * m.vaultTokens * BPS >= tokensIn * m.vaultCostSol * (BPS + m.terms.bandBps);
}

/** Net lamports to add to the reserves so spot reaches `target` (Q64), 0 when it already is there. */
export function buyToPrice(p: Projection, target: bigint): bigint {
  const xTarget = isqrt((p.x * p.x * target) / p.price);
  return xTarget > p.x ? xTarget - p.x : 0n;
}

/** Tokens to sell so spot reaches `target` (Q64), 0 when it already is there. */
export function sellToPrice(p: Projection, target: bigint): bigint {
  const xTarget = isqrt((p.x * p.x * target) / p.price);
  // Selling t tokens moves x to x·y/(y+t); solve for the t that lands on xTarget.
  return xTarget > 0n && xTarget < p.x ? (p.x * p.y) / xTarget - p.y : 0n;
}

/** Highest spot a buy may push to under 90% of the impact limit, and lowest a sell may push to. */
export function impactTargets(p: Projection, maxImpactBps: bigint): { up: bigint; down: bigint } {
  const use = (maxImpactBps * IMPACT_USE_NUM) / IMPACT_USE_DEN;
  return { up: (p.price * (BPS + use)) / BPS, down: (p.price * (BPS - use)) / BPS };
}

export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/** Largest a in [0, hi] with ok(a) true, assuming ok is monotone (true then false). */
export function largestFeasible(hi: bigint, ok: (a: bigint) => boolean): bigint {
  if (hi <= 0n) return 0n;
  if (ok(hi)) return hi;
  let lo = 0n;
  let top = hi - 1n;
  while (lo < top) {
    const mid = (lo + top + 1n) >> 1n;
    if (ok(mid)) lo = mid;
    else top = mid - 1n;
  }
  return lo;
}

export function minBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b < a ? b : a));
}

// ------------------------------------------------------------------ policy

/**
 * Tunable policy, searched by `pnpm --filter @holdfast/agent backtest train` (apps/agent/backtest). The
 * backtest also tried volatility-scaled entries, a depth ladder, window pacing, falling-knife and pump
 * filters and an inventory skew; switching them off did not hurt on the validation split, so they are
 * gone. Tuned margins and floor fit TRAIN but did not beat v1 in the walk-forward test, so the defaults
 * stay at v1's 25 bps entry with the floor off (holdSlope 10 keeps nothing above ~1.1× the bundle price).
 * The flow knobs read `FlowFeatures` (flow.ts: public volume, net flow and trades between polls); the
 * sell guardrail is a risk constraint the owner asked for and ships regardless of the objective.
 */
export interface StrategyParams {
  /** Extra depth past the band before buying / selling, bps of the EMA (absorbs EMA drift until landing). */
  buyMarginBps: number;
  sellMarginBps: number;
  /**
   * Inventory floor for rally selling: the vault keeps at least bundleTokens × (1 − holdSlope ×
   * ln(spot / bundle average price)) tokens, so net selling grows with each e-fold of price instead
   * of with time and a runner can't drain the bag window after window.
   */
  holdSlope: number;
  /** Sell margin cut per unit of positive short-window imbalance (bps): sell earlier into net buying. 0 = off. */
  sellFlowBps: number;
  /** Hold rally sells while the short-window volume rate is below this multiple of the median minute volume (thin rally). 0 = off. */
  sellThinRatio: number;
  /** Hold dip buys while more than this share of the latest minute's volume were sells and that minute was at least median-active (live sell-off). 1 = off. */
  buyDumpShare: number;
  /** Buy margin cut (bps) after a selling climax (≥ 2× median volume, net selling) whose latest minute sells less than the window (exhaustion). 0 = off. */
  buyClimaxBps: number;
  /** VWAP anchor: buy only this many bps below, sell only this many bps above the 30 min volume-weighted average price. 0 = off. */
  vwapEntryBps: number;
  /**
   * Sell guardrail, by state rather than age: per agent window, rally sells may take `baseSellSol` SOL of
   * proceeds (valued at spot) while the launch trades near its launch price with little volume, regardless of
   * the on-chain window cap. The allowance ramps geometrically to the on-chain cap as BOTH the market-cap
   * multiple (spot / bundle price, log scale, full at `fullMcapMult`) and the traded volume (`volume_sol`
   * since launch, log scale from 1 SOL, full at `fullVolumeSol`) grow: progress = min(both)^rampShape (> 1
   * ramps late). A rally with net buying on at least `strongVolumeRatio` × the median minute volume may sell
   * `strongFlowMult` × the allowance (sell into bullish volume, never size up into a thin uptick).
   */
  baseSellSol: number;
  fullMcapMult: number;
  fullVolumeSol: number;
  rampShape: number;
  strongVolumeRatio: number;
  strongFlowMult: number;
  /**
   * Low-volume support mode for dip buys: while the launch's 24 h activity (SOL, `FlowFeatures.volume24hSol`)
   * is below `supportVolumeMult` × the vault's SOL, buy-backs shrink to `supportClipShare` of the size the
   * band / impact / window rules would allow and keep at least `supportSpacingSecs` between the agent's own
   * fills — small, spaced buys that give a quiet chart volume without spending the window budget in one clip.
   * 0 = off (every dip buy is sized to the band edge, paced only by the window budget).
   */
  supportVolumeMult: number;
  supportClipShare: number;
  supportSpacingSecs: number;
  /**
   * Clip granularity: one decision buys at most `buyClipShare` / sells at most `sellClipShare` of what the window
   * may still trade (buys: the window's buy budget left, capped by the vault SOL above its floor; sells: the
   * window's sell budget left after the inventory floor and the sell guardrail), never below the minimum trade.
   * Every clip passes band, cost, budget and impact on its own. 1 = off (one clip to the band edge).
   */
  buyClipShare: number;
  sellClipShare: number;
  /**
   * At least this many seconds between the agent's own fills on a launch, either side (so a buy and a sell are
   * never closer than this either), counted from the decision that first saw the last fill. 0 = off.
   */
  clipSpacingSecs: number;
}

export type ParamKey = keyof StrategyParams;

/** Search space of the optimizer and the validation range of `STRATEGY_PARAMS` overrides. */
export const PARAM_SPACE: Record<ParamKey, { lo: number; hi: number; log?: boolean }> = {
  buyMarginBps: { lo: 0, hi: 1_500 },
  sellMarginBps: { lo: 0, hi: 1_500 },
  holdSlope: { lo: 0.02, hi: 10, log: true },
  sellFlowBps: { lo: 0, hi: 1_500 },
  sellThinRatio: { lo: 0, hi: 2 },
  buyDumpShare: { lo: 0.5, hi: 1 },
  buyClimaxBps: { lo: 0, hi: 1_500 },
  vwapEntryBps: { lo: 0, hi: 1_500 },
  baseSellSol: { lo: 0.1, hi: 5, log: true },
  fullMcapMult: { lo: 2, hi: 50, log: true },
  fullVolumeSol: { lo: 20, hi: 5_000, log: true },
  rampShape: { lo: 0.33, hi: 3, log: true },
  strongVolumeRatio: { lo: 1, hi: 5 },
  strongFlowMult: { lo: 1, hi: 10, log: true },
  supportVolumeMult: { lo: 0, hi: 20 },
  supportClipShare: { lo: 0.05, hi: 1 },
  supportSpacingSecs: { lo: 30, hi: 3_600, log: true },
  buyClipShare: { lo: 0.05, hi: 1 },
  sellClipShare: { lo: 0.05, hi: 1 },
  clipSpacingSecs: { lo: 0, hi: 600 },
};

export const PARAM_KEYS = Object.keys(PARAM_SPACE) as ParamKey[];

/**
 * Shipped defaults (`backtest flow`, 74 pools): v1's 25 bps entry, inventory floor off, flow knobs off — the
 * trained flow policy won on TEST (+0.40 vs this) but lost in the walk-forward test (−0.32), so it stays an
 * opt-in via STRATEGY_PARAMS. The sell ramp ships as a risk constraint: with a 1 SOL base allowance and the
 * trained ramp it is neutral on value. `backtest support` (no profit share, 2026-10): re-tuning the ramp and
 * the support knobs jointly on walk-forward TRAIN (+0.09 in-sample) lost on walk-forward TEST (−0.44 vs this
 * policy) and on TEST (−0.83), a bolder hand-set ramp (2 SOL base, full at 8× / 300 SOL) won walk-forward
 * (+0.22) but lost TEST (−1.62), so the ramp stays. The support mode at this preset (24 h activity below 2× the
 * vault's SOL → ⅓-size buys ≥ 5 min apart) changes no backtest number (walk-forward −0.001, TEST 0.000): it
 * only fires on charts quieter than the dataset's pools, which is exactly where it is meant to give volume.
 */
export const DEFAULT_PARAMS: StrategyParams = {
  buyMarginBps: 25,
  sellMarginBps: 25,
  holdSlope: 10,
  sellFlowBps: 0,
  sellThinRatio: 0,
  buyDumpShare: 1,
  buyClimaxBps: 0,
  vwapEntryBps: 0,
  baseSellSol: 1,
  fullMcapMult: 17.6,
  fullVolumeSol: 1387,
  rampShape: 2.15,
  strongVolumeRatio: 1.39,
  strongFlowMult: 6.63,
  supportVolumeMult: 2,
  supportClipShare: 0.33,
  supportSpacingSecs: 300,
  // Event-driven timing (backtest/results/speed.md; selected by the speed gate at 3 s cooldown with the buy-back-cost
  // guardrail: "clips ≤ 10%"): objective ≥ 0.39 on WF TEST and TEST with a worst 10% not below v1's, ~32 fills/h
  // instead of 3–4.
  buyClipShare: 0.1,
  sellClipShare: 0.1,
  clipSpacingSecs: 0,
};

/** `base` with the given overrides; throws on unknown keys or values outside `PARAM_SPACE`. */
export function withParams(base: StrategyParams, overrides: Record<string, unknown>): StrategyParams {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    const space = PARAM_SPACE[k as ParamKey];
    if (!space) throw new Error(`unknown strategy parameter "${k}" (known: ${PARAM_KEYS.join(", ")})`);
    if (typeof v !== "number" || !Number.isFinite(v) || v < space.lo || v > space.hi) {
      throw new Error(`strategy parameter ${k} must be a number in [${space.lo}, ${space.hi}], got ${JSON.stringify(v)}`);
    }
    out[k as ParamKey] = v;
  }
  return out;
}

export type HoldKind =
  | "in_band"
  | "entry"
  | "flow"
  | "floor"
  | "allowance"
  | "budget"
  | "vault_empty"
  | "vault_floor"
  | "too_small"
  | "impact"
  | "cost_basis"
  | "spacing";

/**
 * Trade plan: `amount` is lamports in for buys, token base units in for sells; `minOut` is the slippage floor.
 * `kind`: `dip` = buy at/below the vault's average cost, `buyback` = buy below the average agent sell price,
 * `rally` = sell; `support` marks a buy clipped by the low-volume support mode.
 */
export interface TradePlan {
  action: "buy" | "sell";
  kind: "dip" | "buyback" | "rally";
  support?: boolean;
  reason: string;
  amount: bigint;
  expectedOut: bigint;
  minOut: bigint;
  impactBps: bigint;
}

export type Plan = TradePlan | { action: "hold"; kind: HoldKind; reason: string };

export interface Evaluation {
  projection: Projection;
  plan: Plan;
}

/** "−0.8%" / "+2.4%" with a typographic minus. */
export function fmtDeviation(ppm: bigint): string {
  const pct = Number(ppm) / 10_000;
  const abs = Math.abs(pct).toFixed(1);
  return pct < 0 && abs !== "0.0" ? `−${abs}%` : `+${abs}%`;
}

const solStr = (lamports: bigint) => `${fmtSol(lamportsToSol(lamports), 4)} SOL`;
const tokStr = (baseUnits: bigint) => `${compact(tokensToUi(baseUnits))} tokens`;
const pctStr = (bpsValue: number) => `${(bpsValue / 100).toFixed(1)}%`;
/** Average price of `lamports` over `baseUnits` as display text (SOL per whole token). */
const avgPriceStr = (lamports: bigint, baseUnits: bigint) =>
  fmtPrice(baseUnits > 0n ? Number(lamports) / 1e9 / (Number(baseUnits) / 1e6) : 0);

const hold = (kind: HoldKind, reason: string): Plan => ({ action: "hold", kind, reason });

function budgetHold(proj: Projection, remaining: string): Plan {
  return hold("budget", `window budget exhausted (${remaining} left), resets in ${countdown(Number(proj.windowEnd), Number(proj.now))}`);
}

/** Support mode decision for this poll: on when the 24 h activity is below `supportVolumeMult` × the vault's SOL. */
export function supportMode(params: StrategyParams, m: Pick<MarketState, "vaultSol">, flow: FlowFeatures): { on: boolean; threshold: number } {
  const threshold = params.supportVolumeMult * (Number(m.vaultSol) / 1e9);
  return { on: params.supportVolumeMult > 0 && flow.volume24hSol < threshold, threshold };
}

function planBuy(m: MarketState, s: Sizing, proj: Projection, params: StrategyParams, flow: FlowFeatures, head: string): Plan {
  const t = m.terms;
  const { price, costSol, costTokens } = proj;
  if (m.vaultSol === 0n) return hold("vault_empty", `${head} but vault has no SOL`);
  const spendable = spendableSol(m);
  if (spendable < s.minTradeLamports) {
    return hold("vault_floor", `${head} but vault SOL ${solStr(m.vaultSol)} is at its ${solStr(t.minVaultSol)} floor (fees / rent reserve)`);
  }
  const room = minBig(proj.buyRemaining, spendable);
  if (room < s.minTradeLamports) return budgetHold(proj, solStr(proj.buyRemaining));
  // `buyToPrice` is the net the reserves take; the agent spends that plus the venue's fee.
  let ideal = grossForNet(m, buyToPrice(proj, minBig((proj.ema * (BPS - t.bandBps)) / BPS, impactTargets(proj, t.maxImpactBps).up)));
  if (ideal < s.minTradeLamports) return hold("too_small", `${head}, ideal buy ${solStr(ideal)} below minimum`);
  // Low-volume support mode: a quiet chart gets smaller, spaced clips instead of one buy to the band edge.
  const support = supportMode(params, m, flow);
  let supportNote = "";
  if (support.on) {
    const quiet = `24 h activity ${fmtSol(flow.volume24hSol, 2)} SOL < ${fmtSol(support.threshold, 2)} SOL (${params.supportVolumeMult}× vault)`;
    if (flow.sinceAgentTradeSecs < params.supportSpacingSecs) {
      const wait = Math.ceil(params.supportSpacingSecs - flow.sinceAgentTradeSecs);
      return hold("spacing", `${head} but support mode (${quiet}) spaces buys ${Math.round(params.supportSpacingSecs)}s apart, next in ${wait}s`);
    }
    ideal = (ideal * BigInt(Math.round(params.supportClipShare * 10_000))) / BPS;
    if (ideal < s.minTradeLamports) ideal = s.minTradeLamports;
    supportNote = `; support mode: ${quiet}, clip ${Math.round(params.supportClipShare * 100)}%`;
  }
  // Clip granularity: at most `buyClipShare` of the window's buy room per decision, never below the minimum trade.
  const buyClip = (room * BigInt(Math.round(params.buyClipShare * 10_000))) / BPS;
  const clipRoom = params.buyClipShare >= 1 ? room : buyClip > s.minTradeLamports ? buyClip : s.minTradeLamports;
  const clipNote = clipRoom < minBig(ideal, room) ? `; clip ≤ ${Math.round(params.buyClipShare * 100)}% of ${solStr(room)} window room` : "";

  const impactOk = (a: bigint) => buyImpactOk(m, proj, a);
  // Cost rules are checked against the slippage floor, so any fill the transaction accepts passes them.
  const worstFill = (a: bigint) => minOut(buyFill(m, proj, a), s.slippageBps);
  const solIn = largestFeasible(minBig(ideal, clipRoom), (a) => impactOk(a) && buyCostOk(m, proj, a, worstFill(a)));
  if (solIn < s.minTradeLamports) {
    if (!impactOk(s.minTradeLamports)) return hold("impact", `${head}, impact limit leaves buy below minimum`);
    const cost = `spot above vault avg cost ${avgPriceStr(costSol, costTokens)}`;
    const buyback =
      m.agentTokensSold === 0n
        ? "nothing sold yet to buy back"
        : `buy-back needs fill ≤ ${avgPriceStr((m.agentSolReceived * (BPS - t.bandBps)) / BPS, m.agentTokensSold)}`;
    return hold("cost_basis", `${head} but ${cost}, ${buyback}`);
  }
  const expectedTokens = buyFill(m, proj, solIn);
  // Label by the path the fill passes (the below-cost path first, like the program checks it).
  const belowCost = buyBelowCost(proj, solIn, worstFill(solIn));
  const how = belowCost
    ? `at/below vault avg cost ${avgPriceStr(costSol, costTokens)}`
    : `buy-back below avg sell ${avgPriceStr(m.agentSolReceived, m.agentTokensSold)}`;
  const impactBps = moveBps(price, priceQ64(proj.x + buyNet(m, solIn), proj.y - expectedTokens));
  return {
    action: "buy",
    kind: belowCost ? "dip" : "buyback",
    ...(support.on ? { support: true } : {}),
    reason: `${head}: buy ${solStr(solIn)} ${how} (impact ${Number(impactBps) / 100}%)${supportNote}${clipNote}`,
    amount: solIn,
    expectedOut: expectedTokens,
    minOut: minOut(expectedTokens, s.slippageBps),
    impactBps,
  };
}

/** Climax volume: the short window trades at least this multiple of the median minute volume. */
const CLIMAX_VOLUME_RATIO = 2;

export interface SellAllowance {
  /** SOL of proceeds this window may still take; Infinity = only the on-chain cap applies. */
  sol: number;
  /** Ramp progress 0..1 (1 = the on-chain cap). */
  progress: number;
  /** The rally came with net buying on strong volume: `strongFlowMult` applied. */
  strong: boolean;
}

/**
 * The sell guardrail's allowance per window (SOL of proceeds, valued at spot): `baseSellSol` ramping
 * geometrically to the on-chain window cap `windowCapSol` as the smaller of the market-cap and traded-volume
 * progress (both on a log scale) rises to 1, shaped by `rampShape`; strong buy flow multiplies it.
 */
export function sellAllowance(p: StrategyParams, mcapMult: number, volumeSol: number, windowCapSol: number, flow: FlowFeatures): SellAllowance {
  const toward = (value: number, full: number) => (full <= 1 ? 1 : Math.min(1, Math.max(0, Math.log(Math.max(1, value)) / Math.log(full))));
  const progress = Math.min(toward(mcapMult, p.fullMcapMult), toward(volumeSol, p.fullVolumeSol)) ** p.rampShape;
  const strong = flow.imbalance > 0 && flow.volumeRatio >= p.strongVolumeRatio;
  if (progress >= 1 || windowCapSol <= p.baseSellSol) return { sol: Infinity, progress, strong };
  const sol = p.baseSellSol * (windowCapSol / p.baseSellSol) ** progress * (strong ? p.strongFlowMult : 1);
  return { sol, progress, strong };
}

function planSell(m: MarketState, s: Sizing, proj: Projection, params: StrategyParams, flow: FlowFeatures, head: string): Plan {
  const t = m.terms;
  const { x, y, price } = proj;
  /** Lamports the launch receives for selling `tokens` (net of the venue's fee). */
  const proceeds = (tokens: bigint) => sellFill(m, proj, tokens).net;
  if (m.vaultTokens === 0n) return hold("vault_empty", `${head} but vault has no tokens`);
  const budget = minBig(proj.sellRemaining, m.vaultTokens);
  if (budget === 0n || proceeds(budget) < s.minTradeLamports) return budgetHold(proj, tokStr(proj.sellRemaining));
  const bundlePrice = Number(m.bundleSol) / Number(m.bundleTokens);
  const keepShare = Math.max(0, Math.min(1, 1 - params.holdSlope * Math.log(Number(x) / Number(y) / bundlePrice)));
  const keep = (m.bundleTokens * BigInt(Math.round(keepShare * 1_000_000))) / 1_000_000n;
  let room = m.vaultTokens > keep ? minBig(budget, m.vaultTokens - keep) : 0n;
  if (room === 0n || proceeds(room) < s.minTradeLamports) {
    return hold("floor", `${head} but the vault keeps ${tokStr(keep)} at this price (${Math.round(keepShare * 100)}% of the bundle)`);
  }
  // Sell guardrail: proceeds per window (at spot) capped below the on-chain window cap until market cap and traded volume have grown.
  const windowCapSol = Number(proceeds(minBig(proj.sellCap, m.vaultTokens))) / 1e9;
  const mcapMult = Number(x) / Number(y) / bundlePrice;
  const volumeSol = Number(m.volumeSol) / 1e9;
  const allowance = sellAllowance(params, mcapMult, volumeSol, windowCapSol, flow);
  let capNote = "";
  if (allowance.sol < windowCapSol) {
    // The allowance is SOL of proceeds. Value what this window already sold at what buying it back would cost on
    // today's curve (x·S / (y − S)): with nothing else traded that is exactly what the sells took out of the curve
    // (before the venue's fee), and buyers since only raise it, so the bound is conservative whichever way the price
    // moved. Then size the rest as the tokens whose gross leaves the curve (x·T / (y + T) = cap). Counting tokens, or
    // valuing them at today's sell price, lets several clips overshoot the allowance.
    const sold = proj.sellCap - proj.sellRemaining;
    const allowanceLamports = BigInt(Math.floor(allowance.sol * 1e9));
    const soldLamports = sold === 0n ? 0n : sold < y ? (x * sold) / (y - sold) : allowanceLamports;
    const leftLamports = allowanceLamports > soldLamports ? allowanceLamports - soldLamports : 0n;
    const capLamports = grossForNet(m, leftLamports);
    const left = leftLamports === 0n ? 0n : capLamports < x ? (y * capLamports) / (x - capLamports) : room;
    const cap =
      `mcap ${mcapMult.toFixed(1)}× launch, ${fmtSol(volumeSol, 1)} SOL traded: sell allowance ${fmtSol(allowance.sol, 3)} SOL this window` +
      `${allowance.strong ? ` (strong buy flow ×${params.strongFlowMult.toFixed(1)})` : ""}`;
    if (left === 0n || proceeds(left) < s.minTradeLamports) return hold("allowance", `${head} but ${cap}, ${solStr(proceeds(sold))} sold`);
    if (left < room) {
      room = left;
      capNote = `; ${cap}`;
    }
  }
  const floorTarget = (proj.ema * (BPS + t.bandBps)) / BPS;
  const impactTarget = impactTargets(proj, t.maxImpactBps).down;
  const ideal = sellToPrice(proj, floorTarget > impactTarget ? floorTarget : impactTarget);
  if (ideal === 0n || proceeds(ideal) < s.minTradeLamports) return hold("too_small", `${head}, ideal sell below minimum`);
  // Clip granularity: at most `sellClipShare` of what this window may still sell per decision; proceeds are concave
  // in the tokens sold, so `atLeast` (the minimum trade's share of the room, scaled up) still clears the minimum.
  if (params.sellClipShare < 1) {
    const atLeast = (room * ((s.minTradeLamports * 1_001n) / 1_000n)) / proceeds(room) + 1n;
    const sellClip = (room * BigInt(Math.round(params.sellClipShare * 10_000))) / BPS;
    const clip = sellClip > atLeast ? sellClip : atLeast;
    if (clip < minBig(ideal, room)) capNote += `; clip ≤ ${Math.round(params.sellClipShare * 100)}% of ${tokStr(room)} window room`;
    room = minBig(clip, room);
  }

  // Cost rule checked against the slippage floor, so any fill the transaction accepts passes it.
  const tokensIn = largestFeasible(minBig(ideal, room), (a) => {
    if (!sellCurveOk(m, proj, a)) return false;
    return sellAboveCost(m, a, minOut(proceeds(a), s.slippageBps));
  });
  const fill = sellFill(m, proj, tokensIn);
  const expectedSol = fill.net;
  if (tokensIn === 0n || expectedSol < s.minTradeLamports) {
    // Net spot (Q64 lamports per base unit, after the venue's fee) vs cost × (1 + band): if spot fails, no size can pass.
    const netSpot = (price * (BPS - venueFeeBps(m))) / BPS;
    if (netSpot * m.vaultTokens * BPS < (m.vaultCostSol << 64n) * (BPS + t.bandBps)) {
      const need = avgPriceStr((m.vaultCostSol * (BPS + t.bandBps)) / BPS, m.vaultTokens);
      return hold("cost_basis", `${head} but fill must be ≥ ${need} (vault avg cost + band)`);
    }
    return hold("impact", `${head}, impact/cost limits leave sell below minimum`);
  }
  const impactBps = moveBps(price, priceQ64(x - fill.gross, y + tokensIn));
  return {
    action: "sell",
    kind: "rally",
    reason: `${head}: sell ${tokStr(tokensIn)} for ~${solStr(expectedSol)} (impact ${Number(impactBps) / 100}%)${capNote}`,
    amount: tokensIn,
    expectedOut: expectedSol,
    minOut: minOut(expectedSol, s.slippageBps),
    impactBps,
  };
}

/** Decision at chain time `now` with the launch's flow features as of this poll. */
export function evaluate(m: MarketState, s: Sizing, now: bigint, params: StrategyParams, flow: FlowFeatures): Evaluation {
  const proj = project(m, now);
  const done = (plan: Plan): Evaluation => ({ projection: proj, plan });
  const dev = fmtDeviation(proj.deviationPpm);
  const band = Number(m.terms.bandBps);
  const devBps = Number(proj.deviationPpm) / 100;
  const vwap = `${(flow.vwapDevBps / 100).toFixed(1)}% vs 30 min VWAP`;
  // Clip spacing guards both sides: no fill, and so never a buy and a sell, closer than `clipSpacingSecs` on this launch.
  const spacing =
    flow.sinceAgentTradeSecs < params.clipSpacingSecs
      ? `clips are spaced ${Math.round(params.clipSpacingSecs)}s apart on either side (last agent fill ${Math.round(flow.sinceAgentTradeSecs)}s ago), next in ${Math.ceil(params.clipSpacingSecs - flow.sinceAgentTradeSecs)}s`
      : null;
  if (proj.price <= proj.buyCeiling) {
    const head = `dip ${dev} vs EMA`;
    // Selling climax that is easing: the window sold on climax volume, the latest minute sells less than the window did.
    const exhausted = flow.volumeRatio >= CLIMAX_VOLUME_RATIO && flow.imbalance < 0 && flow.imbalanceRecent >= flow.imbalance;
    const margin = exhausted ? Math.max(0, params.buyMarginBps - params.buyClimaxBps) : params.buyMarginBps;
    if (-devBps < band + margin) return done(hold("entry", `${head}, acting from −${pctStr(band + margin)}${exhausted ? " (selling exhausted)" : ""}`));
    const sellShare = (1 - flow.imbalanceRecent) / 2;
    if (sellShare > params.buyDumpShare && flow.volumeRatioRecent >= 1) {
      return done(hold("flow", `${head} but live sell-off: ${Math.round(sellShare * 100)}% of the last minute's volume were sells, waiting for ≤ ${Math.round(params.buyDumpShare * 100)}%`));
    }
    if (params.vwapEntryBps > 0 && flow.vwapDevBps > -params.vwapEntryBps) return done(hold("flow", `${head} but ${vwap}, buying from −${pctStr(params.vwapEntryBps)}`));
    if (spacing) return done(hold("spacing", `${head} but ${spacing}`));
    return done(planBuy(m, s, proj, params, flow, head));
  }
  if (proj.price >= proj.sellFloor) {
    const head = `rally ${dev} vs EMA`;
    const margin = Math.max(0, params.sellMarginBps - params.sellFlowBps * Math.max(0, flow.imbalance));
    if (devBps < band + margin) return done(hold("entry", `${head}, acting from +${pctStr(band + margin)}`));
    if (params.sellThinRatio > 0 && flow.volumeRatio < params.sellThinRatio) {
      return done(hold("flow", `${head} but thin: volume ${flow.volumeRatio.toFixed(2)}× the median minute, selling from ${params.sellThinRatio.toFixed(2)}×`));
    }
    if (params.vwapEntryBps > 0 && flow.vwapDevBps < params.vwapEntryBps) return done(hold("flow", `${head} but ${vwap}, selling from +${pctStr(params.vwapEntryBps)}`));
    if (spacing) return done(hold("spacing", `${head} but ${spacing}`));
    return done(planSell(m, s, proj, params, flow, head));
  }
  return done(hold("in_band", `price inside band (${dev} vs EMA)`));
}

/** Thresholds of the payout market gate (not tuned: payouts are outside the backtest objective). */
export const PAYOUT_GATE = {
  /** A payout waits while spot is more than this far below its 24 h high. */
  maxDrawdown: 0.2,
  /** Spot must be at least this multiple of the bundle (launch) price. */
  minMcapMult: 1,
} as const;

/**
 * Whether the market is strong enough to pay backers right now ("the coin is sending"), by the sell ramp's
 * observables: spot above the EMA band, net buying on at least `strongVolumeRatio` × the median minute
 * volume, above the 30 min VWAP and the launch price, and not in a 24 h drawdown. Payouts are
 * opportunistic: in a dip the vault's SOL is for buying back, never for paying out.
 */
export function payoutMarketStrong(m: MarketState, proj: Projection, params: StrategyParams, flow: FlowFeatures): { ok: boolean; reason: string } {
  const dev = fmtDeviation(proj.deviationPpm);
  if (proj.price < proj.sellFloor) return { ok: false, reason: `price under EMA band (${dev} vs EMA)` };
  if (flow.spanSecs < FLOW_SHORT_SECS) return { ok: false, reason: `no buy flow observed yet (${Math.round(flow.spanSecs)}s of flow history)` };
  if (flow.imbalance <= 0) {
    const minutes = Math.round(Math.min(flow.spanSecs, FLOW_SHORT_SECS) / 60);
    return { ok: false, reason: flow.imbalance < 0 ? `net selling over the last ${minutes} min (imbalance ${flow.imbalance.toFixed(2)})` : `no net buying over the last ${minutes} min` };
  }
  if (flow.volumeRatio < params.strongVolumeRatio) {
    return { ok: false, reason: `thin volume: ${flow.volumeRatio.toFixed(2)}× the median minute, needs ${params.strongVolumeRatio.toFixed(2)}×` };
  }
  if (flow.vwapDevBps <= 0) return { ok: false, reason: `price below the 30 min VWAP (${(flow.vwapDevBps / 100).toFixed(1)}%)` };
  if (flow.drawdown24h > PAYOUT_GATE.maxDrawdown) return { ok: false, reason: `${Math.round(flow.drawdown24h * 100)}% under the 24 h high` };
  const mcapMult = m.bundleTokens > 0n ? (Number(proj.x) / Number(proj.y)) * (Number(m.bundleTokens) / Number(m.bundleSol)) : 0;
  if (mcapMult < PAYOUT_GATE.minMcapMult) return { ok: false, reason: `mcap ${mcapMult.toFixed(2)}× launch, below ${PAYOUT_GATE.minMcapMult}×` };
  return {
    ok: true,
    reason: `strong market: ${dev} vs EMA, buy flow ${flow.volumeRatio.toFixed(2)}× median volume, +${(flow.vwapDevBps / 100).toFixed(1)}% vs VWAP, mcap ${mcapMult.toFixed(1)}× launch`,
  };
}

/** Display prices (SOL per whole token) of a decision. */
export interface DisplayPrices {
  priceSol: number;
  emaSol: number;
  bandLowSol: number;
  bandHighSol: number;
}

export function displayPrices(p: Projection): DisplayPrices {
  return {
    priceSol: q64ToSolPerToken(p.price),
    emaSol: q64ToSolPerToken(p.ema),
    bandLowSol: q64ToSolPerToken(p.buyCeiling),
    bandHighSol: q64ToSolPerToken(p.sellFloor),
  };
}
