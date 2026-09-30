import {
  BPS,
  bps,
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
  type LaunchAccount,
} from "@holdfast/sdk";

/**
 * Pure decision logic in two layers.
 *
 * 1. Program mirror (`project`, `buyImpactOk`, `buyBelowCost`, `buyBelowAvgSell`, `sellCurveOk`, `sellAboveCost`):
 *    bigint-exact copies of programs/moshsol (state.rs `roll_window`, `update_ema`, `cost_basis`;
 *    instructions/agent.rs checks), so the agent sees exactly what the program will see at the given
 *    chain timestamp. All limits come from the launch's immutable `terms`, never from platform params.
 * 2. Policy (`StrategyParams`): how far past the band to wait before acting and how much of the
 *    bundle a rally may sell at a given price (inventory floor). It only chooses among trades the
 *    mirror accepts.
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
}

/** Launch fields the agent logic reads, as bigint. */
export interface MarketState {
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
  buybackSol: bigint;
  windowStart: bigint;
  windowBuyCap: bigint;
  windowSolSpent: bigint;
  windowSellCap: bigint;
  windowTokensSold: bigint;
  emaPrice: bigint;
  lastTradeTs: bigint;
}

export function marketOf(l: LaunchAccount): MarketState {
  const b = (v: { toString(): string }) => BigInt(v.toString());
  const t = l.terms;
  return {
    terms: {
      bandBps: BigInt(t.agentBandBps),
      maxImpactBps: BigInt(t.agentMaxImpactBps),
      buyBpsPerWindow: BigInt(t.agentBuyBpsPerWindow),
      sellBpsPerWindow: BigInt(t.agentSellBpsPerWindow),
      windowSecs: BigInt(t.agentWindowSecs),
      emaPeriodSecs: BigInt(t.emaPeriodSecs),
    },
    virtualSol: b(l.virtualSol),
    realSol: b(l.realSol),
    tokenReserve: b(l.tokenReserve),
    vaultSol: b(l.vaultSol),
    vaultTokens: b(l.vaultTokens),
    vaultCostSol: b(l.vaultCostSol),
    bundleSol: b(l.bundleSol),
    bundleTokens: b(l.bundleTokens),
    agentSolReceived: b(l.agentSolReceived),
    agentTokensSold: b(l.agentTokensSold),
    buybackSol: b(l.buybackSol),
    windowStart: b(l.windowStart),
    windowBuyCap: b(l.windowBuyCap),
    windowSolSpent: b(l.windowSolSpent),
    windowSellCap: b(l.windowSellCap),
    windowTokensSold: b(l.windowTokensSold),
    emaPrice: b(l.emaPrice),
    lastTradeTs: b(l.lastTradeTs),
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

  // EMA weight dt / (dt + period), floored step, applied before reserves change.
  let ema = m.emaPrice;
  if (ema === 0n) {
    ema = price;
  } else {
    const dt = now > m.lastTradeTs ? now - m.lastTradeTs : 0n;
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

/** agent_buy impact check for `solIn` lamports: the move is at most `maxImpactBps` (rounded up). */
export function buyImpactOk(p: Projection, maxImpactBps: bigint, solIn: bigint): boolean {
  const out = tokensOut(p.x, p.y, solIn);
  if (out <= 0n || out >= p.y) return false;
  return moveBps(p.price, priceQ64(p.x + solIn, p.y - out)) <= maxImpactBps;
}

/** agent_buy path 1: fill price (solIn / tokens) at or below the vault's average cost. */
export function buyBelowCost(p: Projection, solIn: bigint, tokens: bigint): boolean {
  return solIn * p.costTokens <= tokens * p.costSol;
}

/** agent_buy path 2 (buy-back, also needs `solIn ≤ buybackSol`): fill at least `band` below the average agent sell price. */
export function buyBelowAvgSell(m: MarketState, solIn: bigint, tokens: bigint): boolean {
  return m.agentTokensSold > 0n && solIn * m.agentTokensSold * BPS <= tokens * m.agentSolReceived * (BPS - m.terms.bandBps);
}

/** agent_sell curve and impact checks for `tokensIn` base units. */
export function sellCurveOk(m: MarketState, p: Projection, tokensIn: bigint): boolean {
  const out = solOut(p.x, p.y, tokensIn);
  if (out <= 0n || out > m.realSol) return false;
  return moveBps(p.price, priceQ64(p.x - out, p.y + tokensIn)) <= m.terms.maxImpactBps;
}

/** agent_sell cost basis: fill (sol / tokensIn) at least the vault's average cost plus band. */
export function sellAboveCost(m: MarketState, tokensIn: bigint, sol: bigint): boolean {
  return sol * m.vaultTokens * BPS >= tokensIn * m.vaultCostSol * (BPS + m.terms.bandBps);
}

/** Lamports to buy so spot reaches `target` (Q64), 0 when it already is there. */
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
}

export type ParamKey = keyof StrategyParams;

/** Search space of the optimizer and the validation range of `STRATEGY_PARAMS` overrides. */
export const PARAM_SPACE: Record<ParamKey, { lo: number; hi: number; log?: boolean }> = {
  buyMarginBps: { lo: 0, hi: 1_500 },
  sellMarginBps: { lo: 0, hi: 1_500 },
  holdSlope: { lo: 0.02, hi: 10, log: true },
};

export const PARAM_KEYS = Object.keys(PARAM_SPACE) as ParamKey[];

export const DEFAULT_PARAMS: StrategyParams = {
  buyMarginBps: 25,
  sellMarginBps: 25,
  holdSlope: 10,
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

export type HoldKind = "in_band" | "entry" | "floor" | "budget" | "vault_empty" | "too_small" | "impact" | "cost_basis";

/** Trade plan: `amount` is lamports in for buys, token base units in for sells; `minOut` is the slippage floor. */
export interface TradePlan {
  action: "buy" | "sell";
  kind: "dip" | "rally";
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

function planBuy(m: MarketState, s: Sizing, proj: Projection, head: string): Plan {
  const t = m.terms;
  const { price, costSol, costTokens } = proj;
  if (m.vaultSol === 0n) return hold("vault_empty", `${head} but vault has no SOL`);
  const room = minBig(proj.buyRemaining, m.vaultSol);
  if (room < s.minTradeLamports) return budgetHold(proj, solStr(proj.buyRemaining));
  const ideal = buyToPrice(proj, minBig((proj.ema * (BPS - t.bandBps)) / BPS, impactTargets(proj, t.maxImpactBps).up));
  if (ideal < s.minTradeLamports) return hold("too_small", `${head}, ideal buy ${solStr(ideal)} below minimum`);

  const impactOk = (a: bigint) => buyImpactOk(proj, t.maxImpactBps, a);
  // Cost rules are checked against the slippage floor, so any fill the transaction accepts passes them.
  const worstFill = (a: bigint) => minOut(tokensOut(proj.x, proj.y, a), s.slippageBps);
  const hi = minBig(ideal, room);
  let solIn = largestFeasible(hi, (a) => impactOk(a) && buyBelowCost(proj, a, worstFill(a)));
  let how = `at/below vault avg cost ${avgPriceStr(costSol, costTokens)}`;
  if (solIn < s.minTradeLamports) {
    // Prefer the below-cost path (it does not consume the buy-back budget); fall back to buy-back.
    solIn = largestFeasible(minBig(hi, m.buybackSol), (a) => impactOk(a) && buyBelowAvgSell(m, a, worstFill(a)));
    how = `buy-back below avg sell ${avgPriceStr(m.agentSolReceived, m.agentTokensSold)}`;
  }
  if (solIn < s.minTradeLamports) {
    if (!impactOk(s.minTradeLamports)) return hold("impact", `${head}, impact limit leaves buy below minimum`);
    const cost = `spot above vault avg cost ${avgPriceStr(costSol, costTokens)}`;
    const buyback =
      m.agentTokensSold === 0n || m.buybackSol < s.minTradeLamports
        ? `buy-back budget ${solStr(m.buybackSol)}`
        : `buy-back needs fill ≤ ${avgPriceStr((m.agentSolReceived * (BPS - t.bandBps)) / BPS, m.agentTokensSold)}`;
    return hold("cost_basis", `${head} but ${cost}, ${buyback}`);
  }
  const expectedTokens = tokensOut(proj.x, proj.y, solIn);
  const impactBps = moveBps(price, priceQ64(proj.x + solIn, proj.y - expectedTokens));
  return {
    action: "buy",
    kind: "dip",
    reason: `${head}: buy ${solStr(solIn)} ${how} (impact ${Number(impactBps) / 100}%)`,
    amount: solIn,
    expectedOut: expectedTokens,
    minOut: minOut(expectedTokens, s.slippageBps),
    impactBps,
  };
}

function planSell(m: MarketState, s: Sizing, proj: Projection, holdSlope: number, head: string): Plan {
  const t = m.terms;
  const { x, y, price } = proj;
  if (m.vaultTokens === 0n) return hold("vault_empty", `${head} but vault has no tokens`);
  const budget = minBig(proj.sellRemaining, m.vaultTokens);
  if (budget === 0n || solOut(x, y, budget) < s.minTradeLamports) return budgetHold(proj, tokStr(proj.sellRemaining));
  const bundlePrice = Number(m.bundleSol) / Number(m.bundleTokens);
  const keepShare = Math.max(0, Math.min(1, 1 - holdSlope * Math.log(Number(x) / Number(y) / bundlePrice)));
  const keep = (m.bundleTokens * BigInt(Math.round(keepShare * 1_000_000))) / 1_000_000n;
  const room = m.vaultTokens > keep ? minBig(budget, m.vaultTokens - keep) : 0n;
  if (room === 0n || solOut(x, y, room) < s.minTradeLamports) {
    return hold("floor", `${head} but the vault keeps ${tokStr(keep)} at this price (${Math.round(keepShare * 100)}% of the bundle)`);
  }
  const floorTarget = (proj.ema * (BPS + t.bandBps)) / BPS;
  const impactTarget = impactTargets(proj, t.maxImpactBps).down;
  const ideal = sellToPrice(proj, floorTarget > impactTarget ? floorTarget : impactTarget);
  if (ideal === 0n || solOut(x, y, ideal) < s.minTradeLamports) return hold("too_small", `${head}, ideal sell below minimum`);

  // Cost rule checked against the slippage floor, so any fill the transaction accepts passes it.
  const tokensIn = largestFeasible(minBig(ideal, room), (a) => {
    if (!sellCurveOk(m, proj, a)) return false;
    return sellAboveCost(m, a, minOut(solOut(x, y, a), s.slippageBps));
  });
  const expectedSol = solOut(x, y, tokensIn);
  if (tokensIn === 0n || expectedSol < s.minTradeLamports) {
    // Spot (Q64 lamports per base unit) vs cost × (1 + band): if spot fails, no size can pass.
    if (price * m.vaultTokens * BPS < (m.vaultCostSol << 64n) * (BPS + t.bandBps)) {
      const need = avgPriceStr((m.vaultCostSol * (BPS + t.bandBps)) / BPS, m.vaultTokens);
      return hold("cost_basis", `${head} but fill must be ≥ ${need} (vault avg cost + band)`);
    }
    return hold("impact", `${head}, impact/cost limits leave sell below minimum`);
  }
  const impactBps = moveBps(price, priceQ64(x - expectedSol, y + tokensIn));
  return {
    action: "sell",
    kind: "rally",
    reason: `${head}: sell ${tokStr(tokensIn)} for ~${solStr(expectedSol)} (impact ${Number(impactBps) / 100}%)`,
    amount: tokensIn,
    expectedOut: expectedSol,
    minOut: minOut(expectedSol, s.slippageBps),
    impactBps,
  };
}

/** Decision at chain time `now`. */
export function evaluate(m: MarketState, s: Sizing, now: bigint, params: StrategyParams): Evaluation {
  const proj = project(m, now);
  const done = (plan: Plan): Evaluation => ({ projection: proj, plan });
  const dev = fmtDeviation(proj.deviationPpm);
  const band = Number(m.terms.bandBps);
  const devBps = Number(proj.deviationPpm) / 100;
  if (proj.price <= proj.buyCeiling) {
    const head = `dip ${dev} vs EMA`;
    if (-devBps < band + params.buyMarginBps) return done(hold("entry", `${head}, acting from −${pctStr(band + params.buyMarginBps)}`));
    return done(planBuy(m, s, proj, head));
  }
  if (proj.price >= proj.sellFloor) {
    const head = `rally ${dev} vs EMA`;
    if (devBps < band + params.sellMarginBps) return done(hold("entry", `${head}, acting from +${pctStr(band + params.sellMarginBps)}`));
    return done(planSell(m, s, proj, params.holdSlope, head));
  }
  return done(hold("in_band", `price inside band (${dev} vs EMA)`));
}

/** Display prices (SOL per whole token) for a projection. */
export function displayPrices(p: Projection) {
  return {
    priceSol: q64ToSolPerToken(p.price),
    emaSol: q64ToSolPerToken(p.ema),
    bandLowSol: q64ToSolPerToken(p.buyCeiling),
    bandHighSol: q64ToSolPerToken(p.sellFloor),
  };
}
