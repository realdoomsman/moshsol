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
  windowBuyCap,
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
  /** The official Holdfast token's launch (mint = the platform's buyback mint): the program also lets it buy pullbacks above its average sell. */
  official?: boolean;
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
  /** Smallest buy (lamports in) the agent sends. */
  minTradeLamports: bigint;
  /** Smallest sell (expected lamports out) the agent sends: sells go out as few large clips into strength, never as dust. */
  minSellLamports: bigint;
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
  /**
   * Window caps (lamports / token base units): the sell cap as snapshotted by `roll_window`, the buy cap as
   * the program checks it (`windowBuyCap`: the snapshot raised with the vault's SOL plus what the window spent).
   */
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

  const rolled = now >= m.windowStart + t.windowSecs;
  const windowStart = rolled ? now : m.windowStart;
  const solSpent = rolled ? 0n : m.windowSolSpent;
  const tokensSold = rolled ? 0n : m.windowTokensSold;
  const buyCap = windowBuyCap(rolled ? bps(m.vaultSol, t.buyBpsPerWindow) : m.windowBuyCap, m.vaultSol, solSpent, t.buyBpsPerWindow);
  const sellCap = rolled ? bps(m.vaultTokens, t.sellBpsPerWindow) : m.windowSellCap;
  const buyRemaining = buyCap > solSpent ? buyCap - solSpent : 0n;
  const sellRemaining = sellCap > tokensSold ? sellCap - tokensSold : 0n;

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
  return m.official === true || buyBelowCost(p, solIn, tokens) || buyBelowAvgSell(m, solIn, tokens);
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

/**
 * Why `agent_buy*` / `agent_sell*` would reject `plan` — its exact amount and slippage floor — on `m` at chain time
 * `now`, or null when it passes. Plans are sized on the state of their decision; this re-checks one on the state at
 * send time (a public trade in between can lift spot out of the buy band or push a fill under its floor): band,
 * window budget, vault floor / balance, impact, slippage floor and the cost rule at the fill the state gives now.
 * A plan `evaluate` just made on the same state always passes.
 */
export function planRejection(m: MarketState, now: bigint, plan: TradePlan): string | null {
  const p = project(m, now);
  const dev = `${fmtDeviation(p.deviationPpm)} vs EMA`;
  if (plan.action === "buy") {
    if (p.price > p.buyCeiling) return `spot ${dev}, no longer below the buy band`;
    if (plan.amount > p.buyRemaining) return "the window's buy budget no longer covers it";
    if (plan.amount > spendableSol(m)) return "vault SOL above its floor no longer covers it";
    if (!buyImpactOk(m, p, plan.amount)) return "it would now move spot past the impact limit";
    const tokens = buyFill(m, p, plan.amount);
    if (tokens < plan.minOut) return "the fill is now under its slippage floor";
    if (!buyCostOk(m, p, plan.amount, tokens)) return "the fill is now above vault avg cost and avg sell − band";
    return null;
  }
  if (p.price < p.sellFloor) return `spot ${dev}, no longer above the sell band`;
  if (plan.amount > p.sellRemaining) return "the window's sell budget no longer covers it";
  if (plan.amount > m.vaultTokens) return "the vault no longer holds the tokens";
  if (!sellCurveOk(m, p, plan.amount)) return "it would now move spot past the impact limit";
  const { net } = sellFill(m, p, plan.amount);
  if (net < plan.minOut) return "the fill is now under its slippage floor";
  if (!sellAboveCost(m, plan.amount, net)) return "the fill is now under vault avg cost + band";
  return null;
}

// ------------------------------------------------------------------ policy

/**
 * Tunable policy, searched by `pnpm --filter @holdfast/agent backtest train` (apps/agent/backtest). The
 * backtest also tried volatility-scaled entries, a depth ladder, window pacing, falling-knife and pump
 * filters and an inventory skew; switching them off did not hurt on the validation split, so they are
 * gone. Tuned margins fit TRAIN but did not beat v1 in the walk-forward test, so the defaults stay at v1's
 * 25 bps entry. The flow knobs read `FlowFeatures` (flow.ts: public volume, net flow and trades between polls);
 * the sell ladder and the sell pause are the owner's risk rules and ship regardless of the objective.
 */
export interface StrategyParams {
  /** Extra depth past the band before buying / selling, bps of the EMA (absorbs EMA drift until landing). */
  buyMarginBps: number;
  sellMarginBps: number;
  /**
   * Sell ladder: how much of the bundle rally sells may have taken at a given multiple M = spot / the vault's
   * average cost. Nothing below `ladderStartMult`, then `ladderShare10x` × (ln(M / start) / ln(10 / start))^`ladderShape`
   * (capped at the whole bundle): the defaults reach ~10% at 3×, ~20% at 5×, 35% at 10×, ~50% at 20×. The vault
   * keeps bundleTokens × (1 − that share) and sells the excess (dip-bought tokens included), each sell as large as
   * that gap, the window and 90% of the impact limit allow. Per window the bundle's tokens go at the same pace: at most
   * share / `ladderShare10x` of the program's window cap (all of it from 10×), so a rally that runs within one
   * window keeps the budget for its higher prices instead of spending it early.
   */
  ladderStartMult: number;
  ladderShare10x: number;
  ladderShape: number;
  /**
   * Sell pause: no rally sell while spot is more than this far under its 15 min high with the public net selling
   * since that high (a crash, not the agent's own sells). Rally sells also need spot at or above the 3 min VWAP and
   * no net public selling over the latest minute, so they only go into green candles. Not switchable off (≤ 50%).
   */
  sellPauseDrawdown: number;
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
  /** Payout market gate: net buying on at least this multiple of the median minute volume (`payoutMarketStrong`). */
  strongVolumeRatio: number;
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
   * Buy clip granularity: one decision buys at most `buyClipShare` of what the window may still buy (the window's
   * buy budget left, capped by the vault SOL above its floor), never below the minimum trade. Every clip passes
   * band, cost, budget and impact on its own. 1 = off (one clip to the band edge). Sells are not clipped: each
   * takes the ladder gap up to the impact limit.
   */
  buyClipShare: number;
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
  ladderStartMult: { lo: 1, hi: 5, log: true },
  ladderShare10x: { lo: 0.05, hi: 1, log: true },
  ladderShape: { lo: 0.25, hi: 4, log: true },
  sellPauseDrawdown: { lo: 0.05, hi: 0.5 },
  sellFlowBps: { lo: 0, hi: 1_500 },
  sellThinRatio: { lo: 0, hi: 2 },
  buyDumpShare: { lo: 0.5, hi: 1 },
  buyClimaxBps: { lo: 0, hi: 1_500 },
  vwapEntryBps: { lo: 0, hi: 1_500 },
  strongVolumeRatio: { lo: 1, hi: 5 },
  supportVolumeMult: { lo: 0, hi: 20 },
  supportClipShare: { lo: 0.05, hi: 1 },
  supportSpacingSecs: { lo: 30, hi: 3_600, log: true },
  buyClipShare: { lo: 0.05, hi: 1 },
  clipSpacingSecs: { lo: 0, hi: 600 },
};

export const PARAM_KEYS = Object.keys(PARAM_SPACE) as ParamKey[];

/**
 * Shipped defaults: v1's 25 bps entry, flow knobs off, the support mode at 24 h activity below 2× the vault's SOL
 * (⅓-size buys ≥ 5 min apart; it only fires on charts quieter than the dataset's pools). The sell ladder and the sell
 * pause are the owner's call after the first live launch (TEST: 9× in minutes, then −86%; the previous per-window
 * SOL allowance was spent in 0.01 SOL clips at 2–4×, and the lagging pump EMA kept it selling into the dump).
 */
export const DEFAULT_PARAMS: StrategyParams = {
  buyMarginBps: 25,
  sellMarginBps: 25,
  ladderStartMult: 1.5,
  ladderShare10x: 0.35,
  ladderShape: 1.25,
  // 35%, not 20%: on the first 7 pumped mainnet launches (5–25× in the first minutes, back near 1× by 30 min) a 20%
  // pause stopped rally sells on the first pullback off the high and the vault rode the rest down.
  sellPauseDrawdown: 0.35,
  sellFlowBps: 0,
  sellThinRatio: 0,
  buyDumpShare: 1,
  buyClimaxBps: 0,
  vwapEntryBps: 0,
  strongVolumeRatio: 1.39,
  supportVolumeMult: 2,
  supportClipShare: 0.33,
  supportSpacingSecs: 300,
  // Event-driven timing (backtest/results/speed.md; selected by the speed gate at 3 s cooldown with the buy-back-cost
  // guardrail: "clips ≤ 10%"): ~32 fills/h instead of 3–4.
  buyClipShare: 0.1,
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
  | "ladder"
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
  // The official token buys below its average sell in bigger clips (`OFFICIAL_BUYBACK_CLIP`): those lock in profit.
  const clipShare = m.official ? Math.max(params.buyClipShare, OFFICIAL_BUYBACK_CLIP) : params.buyClipShare;
  const clipOf = (share: number) => {
    const c = (room * BigInt(Math.round(share * 10_000))) / BPS;
    return share >= 1 ? room : c > s.minTradeLamports ? c : s.minTradeLamports;
  };
  const clipRoom = clipOf(clipShare);
  const clipNote = clipRoom < minBig(ideal, room) ? `; clip ≤ ${Math.round(clipShare * 100)}% of ${solStr(room)} window room` : "";

  const impactOk = (a: bigint) => buyImpactOk(m, proj, a);
  // Cost rules are checked against the slippage floor, so any fill the transaction accepts passes them.
  const worstFill = (a: bigint) => minOut(buyFill(m, proj, a), s.slippageBps);
  const strictCostOk = (a: bigint) => buyBelowCost(proj, a, worstFill(a)) || buyBelowAvgSell(m, a, worstFill(a));
  const solIn = largestFeasible(minBig(ideal, clipRoom), (a) => impactOk(a) && strictCostOk(a));
  if (solIn < s.minTradeLamports) {
    if (!impactOk(s.minTradeLamports)) return hold("impact", `${head}, impact limit leaves buy below minimum`);
    const cost = `spot above vault avg cost ${avgPriceStr(costSol, costTokens)}`;
    const buyback =
      m.agentTokensSold === 0n
        ? "nothing sold yet to buy back"
        : `buy-back needs fill ≤ ${avgPriceStr((m.agentSolReceived * (BPS - t.bandBps)) / BPS, m.agentTokensSold)}`;
    // The official token supports its chart on real pullbacks too: smaller clips, only well off the 15 min high.
    if (m.official) {
      const off = `${(flow.drawdownHigh * 100).toFixed(1)}% off the 15-min high`;
      if (flow.drawdownHigh < OFFICIAL_PULLBACK) {
        return hold("cost_basis", `${head} but ${buyback}; pullback buys need ≥ ${OFFICIAL_PULLBACK * 100}% off the 15-min high (now ${off})`);
      }
      const pull = largestFeasible(minBig(ideal, clipOf(params.buyClipShare)), impactOk);
      if (pull < s.minTradeLamports) return hold("impact", `${head}, impact limit leaves pullback buy below minimum`);
      const out = buyFill(m, proj, pull);
      const moved = moveBps(price, priceQ64(proj.x + buyNet(m, pull), proj.y - out));
      return {
        action: "buy",
        kind: "buyback",
        reason: `${head}, ${off}: pullback buy ${solStr(pull)} above avg sell ${avgPriceStr(m.agentSolReceived, m.agentTokensSold)} (official token, impact ${Number(moved) / 100}%)`,
        amount: pull,
        expectedOut: out,
        minOut: minOut(out, s.slippageBps),
        impactBps: moved,
      };
    }
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

/** Official token: buy-backs below the average sell take up to this share of the window's buy room per clip. */
const OFFICIAL_BUYBACK_CLIP = 0.33;
/** Official token: pullback buys above the average sell need spot at least this far under its 15 min high. */
const OFFICIAL_PULLBACK = 0.07;

/** Climax volume: the short window trades at least this multiple of the median minute volume. */
const CLIMAX_VOLUME_RATIO = 2;

/** Share of the bundle the sell ladder lets rally sells have taken at `mult` = spot / vault average cost (0..1). */
export function ladderShare(p: StrategyParams, mult: number): number {
  if (!(mult > p.ladderStartMult)) return 0;
  const progress = Math.log(mult / p.ladderStartMult) / Math.log(10 / p.ladderStartMult);
  return Math.min(1, p.ladderShare10x * progress ** p.ladderShape);
}

/**
 * Share of the program's window sell cap the ladder spends at `mult`: the ladder's share relative to its 10× share, so a
 * rally that runs within one window keeps most of the window's budget for its higher prices (all of it from 10×).
 */
export function ladderWindowShare(p: StrategyParams, mult: number): number {
  return Math.min(1, ladderShare(p, mult) / p.ladderShare10x);
}

function planSell(m: MarketState, s: Sizing, proj: Projection, params: StrategyParams, head: string): Plan {
  const t = m.terms;
  const { x, y, price, costSol, costTokens } = proj;
  /** Lamports the launch receives for selling `tokens` (net of the venue's fee). */
  const proceeds = (tokens: bigint) => sellFill(m, proj, tokens).net;
  const minSell = solStr(s.minSellLamports);
  if (m.vaultTokens === 0n) return hold("vault_empty", `${head} but vault has no tokens`);
  // Sell ladder: at this multiple of the vault's average cost the vault keeps bundleTokens × (1 − share); the rest may go.
  const mult = Number(x) / Number(y) / (Number(costSol) / Number(costTokens));
  const share = ladderShare(params, mult);
  const keep = (m.bundleTokens * BigInt(Math.round((1 - share) * 1_000_000))) / 1_000_000n;
  const gap = m.vaultTokens > keep ? m.vaultTokens - keep : 0n;
  const held = m.bundleTokens > 0n ? Number(m.vaultTokens) / Number(m.bundleTokens) : 0;
  const ladder = `ladder at ${mult.toFixed(1)}× avg cost sells ${Math.round(share * 100)}% of the bundle, vault holds ${Math.round(held * 100)}% of it`;
  if (gap === 0n || proceeds(gap) < s.minSellLamports) {
    const left = gap === 0n ? "nothing left to sell at this price" : `~${solStr(proceeds(gap))} left, below the ${minSell} minimum sell`;
    return hold("ladder", `${head} but ${ladder}: ${left}`);
  }
  // Per window, the bundle's tokens go at the ladder's pace (tokens bought back on dips beyond the bundle sell freely).
  const windowShare = ladderWindowShare(params, mult);
  const excess = m.vaultTokens > m.bundleTokens ? m.vaultTokens - m.bundleTokens : 0n;
  const allowed = minBig(proj.sellCap, (proj.sellCap * BigInt(Math.round(windowShare * 1_000_000))) / 1_000_000n + excess);
  const windowSold = proj.sellCap - proj.sellRemaining;
  const room = minBig(allowed > windowSold ? allowed - windowSold : 0n, gap);
  if (room === 0n || proceeds(room) < s.minSellLamports) {
    if (allowed >= proj.sellCap) return budgetHold(proj, tokStr(proj.sellRemaining));
    return hold(
      "ladder",
      `${head} but ${ladder}; at this multiple a window sells ${Math.round(windowShare * 100)}% of its ${tokStr(proj.sellCap)} cap, ` +
        `${tokStr(windowSold)} sold, resets in ${countdown(Number(proj.windowEnd), Number(proj.now))}`,
    );
  }
  // One clip as large as the ladder gap and the window allow, down to the EMA band edge or 90% of the impact limit.
  const floorTarget = (proj.ema * (BPS + t.bandBps)) / BPS;
  const impactTarget = impactTargets(proj, t.maxImpactBps).down;
  const ideal = sellToPrice(proj, floorTarget > impactTarget ? floorTarget : impactTarget);
  if (ideal === 0n || proceeds(ideal) < s.minSellLamports) {
    return hold("too_small", `${head}, a sell to the band edge / impact limit takes ~${solStr(ideal === 0n ? 0n : proceeds(ideal))}, below the ${minSell} minimum sell`);
  }
  // Cost rule checked against the slippage floor, so any fill the transaction accepts passes it.
  const tokensIn = largestFeasible(minBig(ideal, room), (a) => {
    if (!sellCurveOk(m, proj, a)) return false;
    return sellAboveCost(m, a, minOut(proceeds(a), s.slippageBps));
  });
  const fill = sellFill(m, proj, tokensIn);
  const expectedSol = fill.net;
  if (tokensIn === 0n || expectedSol < s.minSellLamports) {
    // Net spot (Q64 lamports per base unit, after the venue's fee) vs cost × (1 + band): if spot fails, no size can pass.
    const netSpot = (price * (BPS - venueFeeBps(m))) / BPS;
    if (netSpot * m.vaultTokens * BPS < (m.vaultCostSol << 64n) * (BPS + t.bandBps)) {
      const need = avgPriceStr((m.vaultCostSol * (BPS + t.bandBps)) / BPS, m.vaultTokens);
      return hold("cost_basis", `${head} but fill must be ≥ ${need} (vault avg cost + band)`);
    }
    return hold("impact", `${head}, impact/cost limits leave sell below the ${minSell} minimum`);
  }
  const impactBps = moveBps(price, priceQ64(x - fill.gross, y + tokensIn));
  const capNote = room < gap && tokensIn === room ? `; the rest of this window's ${Math.round(windowShare * 100)}% of its cap` : "";
  return {
    action: "sell",
    kind: "rally",
    reason: `${head}: sell ${tokStr(tokensIn)} for ~${solStr(expectedSol)} (impact ${Number(impactBps) / 100}%); ${ladder}${capNote}`,
    amount: tokensIn,
    expectedOut: expectedSol,
    minOut: minOut(expectedSol, s.slippageBps),
    impactBps,
  };
}

/**
 * Why a rally sell must wait for the market: a crash (spot more than `sellPauseDrawdown` under its 15 min high with the
 * public net selling since that high), spot under the 3 min VWAP (the lagging pump EMA alone can read a dump as a rally),
 * or net public selling over the latest minute (a red candle). Null = sell into it.
 */
export function sellPause(params: StrategyParams, flow: FlowFeatures): string | null {
  if (flow.drawdownHigh > params.sellPauseDrawdown && flow.netSinceHighSol < 0) {
    return `sell paused: −${(flow.drawdownHigh * 100).toFixed(1)}% from 15-min high, sellers in control (net −${(-flow.netSinceHighSol).toFixed(2)} SOL since the high)`;
  }
  if (flow.vwapShortDevBps < 0) return `sell paused: spot −${(-flow.vwapShortDevBps / 100).toFixed(1)}% under the 3-min VWAP, waiting for buyers to lift it`;
  if (flow.imbalanceRecent < 0) {
    return `sell paused: sellers in control over the last minute (${Math.round(((1 - flow.imbalanceRecent) / 2) * 100)}% of the volume were sells)`;
  }
  return null;
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
    const paused = sellPause(params, flow);
    if (paused) return done(hold("flow", `${head} but ${paused}`));
    if (spacing) return done(hold("spacing", `${head} but ${spacing}`));
    return done(planSell(m, s, proj, params, head));
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
