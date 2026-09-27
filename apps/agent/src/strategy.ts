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
 * Pure decision logic. Everything here mirrors programs/moshsol (state.rs `roll_window`,
 * `update_ema`, `cost_basis`; instructions/agent.rs checks) in bigint so the agent sees exactly
 * what the program will see at the given chain timestamp. All limits come from the launch's
 * immutable `terms`, never from the current platform params.
 */

/** Extra distance beyond the band before acting, absorbing EMA drift between decision and execution. */
const SAFETY_MARGIN_BPS = 25n;
/** Size trades to use at most 90% of the on-chain impact limit. */
const IMPACT_USE_NUM = 9n;
const IMPACT_USE_DEN = 10n;

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
  /** Max share of the remaining window budget a single trade may use, in bps. */
  maxFractionBps: bigint;
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
  windowEnd: bigint;
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
  let buyRemaining = m.windowBuyCap > m.windowSolSpent ? m.windowBuyCap - m.windowSolSpent : 0n;
  let sellRemaining = m.windowSellCap > m.windowTokensSold ? m.windowSellCap - m.windowTokensSold : 0n;
  if (now >= m.windowStart + t.windowSecs) {
    windowStart = now;
    buyRemaining = bps(m.vaultSol, t.buyBpsPerWindow);
    sellRemaining = bps(m.vaultTokens, t.sellBpsPerWindow);
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
    windowEnd: windowStart + t.windowSecs,
    buyRemaining,
    sellRemaining,
    deviationPpm: ((price - ema) * 1_000_000n) / ema,
    costSol,
    costTokens,
  };
}

export type HoldKind = "in_band" | "margin" | "budget" | "vault_empty" | "too_small" | "impact" | "cost_basis";

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
/** Average price of `lamports` over `baseUnits` as display text (SOL per whole token). */
const avgPriceStr = (lamports: bigint, baseUnits: bigint) =>
  fmtPrice(baseUnits > 0n ? Number(lamports) / 1e9 / (Number(baseUnits) / 1e6) : 0);

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
function largestFeasible(hi: bigint, ok: (a: bigint) => boolean): bigint {
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

function min(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b < a ? b : a));
}

function budgetHold(proj: Projection, remaining: string): Plan {
  return {
    action: "hold",
    kind: "budget",
    reason: `window budget exhausted (${remaining} left), resets in ${countdown(Number(proj.windowEnd), Number(proj.now))}`,
  };
}

function planBuy(m: MarketState, s: Sizing, proj: Projection): Plan {
  const t = m.terms;
  const { x, y, price, deviationPpm, costSol, costTokens } = proj;
  const dev = fmtDeviation(deviationPpm);
  if (m.vaultSol === 0n) return { action: "hold", kind: "vault_empty", reason: `dip ${dev} vs EMA but vault has no SOL` };

  const perTrade = min((proj.buyRemaining * s.maxFractionBps) / BPS, proj.buyRemaining, m.vaultSol);
  if (perTrade < s.minTradeLamports) return budgetHold(proj, solStr(proj.buyRemaining));

  const impactTarget = (price * (BPS + (t.maxImpactBps * IMPACT_USE_NUM) / IMPACT_USE_DEN)) / BPS;
  const target = min((proj.ema * (BPS - t.bandBps)) / BPS, impactTarget);
  const xTarget = isqrt((x * x * target) / price);
  const ideal = xTarget > x ? xTarget - x : 0n;
  if (ideal < s.minTradeLamports) {
    return { action: "hold", kind: "too_small", reason: `dip ${dev} vs EMA, ideal buy ${solStr(ideal)} below minimum` };
  }

  const impactOk = (solIn: bigint) => {
    const out = tokensOut(x, y, solIn);
    if (out <= 0n || out >= y) return false;
    return moveBps(price, priceQ64(x + solIn, y - out)) <= t.maxImpactBps;
  };
  // Path 1: fill price (solIn / tokens) at or below the vault's average cost.
  const belowCost = (solIn: bigint) => solIn * costTokens <= tokensOut(x, y, solIn) * costSol;
  // Path 2: buy-back from earlier sell proceeds, fill at least `band` below the average agent sell price.
  const belowAvgSell = (solIn: bigint) =>
    m.agentTokensSold > 0n &&
    solIn * m.agentTokensSold * BPS <= tokensOut(x, y, solIn) * m.agentSolReceived * (BPS - t.bandBps);

  const hi = min(ideal, perTrade);
  let solIn = largestFeasible(hi, (a) => impactOk(a) && belowCost(a));
  let how = `at/below vault avg cost ${avgPriceStr(costSol, costTokens)}`;
  if (solIn < s.minTradeLamports) {
    // Prefer the below-cost path (it does not consume the buy-back budget); fall back to buy-back.
    solIn = largestFeasible(min(hi, m.buybackSol), (a) => impactOk(a) && belowAvgSell(a));
    how = `buy-back below avg sell ${avgPriceStr(m.agentSolReceived, m.agentTokensSold)}`;
  }
  if (solIn < s.minTradeLamports) {
    if (!impactOk(s.minTradeLamports)) {
      return { action: "hold", kind: "impact", reason: `dip ${dev} vs EMA, impact limit leaves buy below minimum` };
    }
    const cost = `spot above vault avg cost ${avgPriceStr(costSol, costTokens)}`;
    const buyback =
      m.agentTokensSold === 0n || m.buybackSol < s.minTradeLamports
        ? `buy-back budget ${solStr(m.buybackSol)}`
        : `buy-back needs fill ≤ ${avgPriceStr((m.agentSolReceived * (BPS - t.bandBps)) / BPS, m.agentTokensSold)}`;
    return { action: "hold", kind: "cost_basis", reason: `dip ${dev} vs EMA but ${cost}, ${buyback}` };
  }
  const expectedTokens = tokensOut(x, y, solIn);
  const impactBps = moveBps(price, priceQ64(x + solIn, y - expectedTokens));
  return {
    action: "buy",
    kind: "dip",
    reason: `dip ${dev} vs EMA: buy ${solStr(solIn)} ${how} (impact ${Number(impactBps) / 100}%)`,
    amount: solIn,
    expectedOut: expectedTokens,
    minOut: minOut(expectedTokens, s.slippageBps),
    impactBps,
  };
}

function planSell(m: MarketState, s: Sizing, proj: Projection): Plan {
  const t = m.terms;
  const { x, y, price, deviationPpm } = proj;
  const dev = fmtDeviation(deviationPpm);
  if (m.vaultTokens === 0n) return { action: "hold", kind: "vault_empty", reason: `rally ${dev} vs EMA but vault has no tokens` };

  const perTrade = min((proj.sellRemaining * s.maxFractionBps) / BPS, proj.sellRemaining, m.vaultTokens);
  if (perTrade === 0n || solOut(x, y, perTrade) < s.minTradeLamports) {
    return budgetHold(proj, `${compact(tokensToUi(proj.sellRemaining))} tokens`);
  }

  const impactTarget = (price * (BPS - (t.maxImpactBps * IMPACT_USE_NUM) / IMPACT_USE_DEN)) / BPS;
  const floorTarget = (proj.ema * (BPS + t.bandBps)) / BPS;
  const target = floorTarget > impactTarget ? floorTarget : impactTarget;
  const xTarget = isqrt((x * x * target) / price);
  // Selling t tokens moves x to x·y/(y+t); solve for the t that lands on xTarget.
  const ideal = xTarget > 0n && xTarget < x ? (x * y) / xTarget - y : 0n;
  if (ideal === 0n || solOut(x, y, ideal) < s.minTradeLamports) {
    return { action: "hold", kind: "too_small", reason: `rally ${dev} vs EMA, ideal sell below minimum` };
  }

  const ok = (tokensIn: bigint) => {
    const out = solOut(x, y, tokensIn);
    if (out <= 0n || out > m.realSol) return false;
    // Fill (out / tokensIn) must be at least the vault's average cost plus band.
    if (out * m.vaultTokens * BPS < tokensIn * m.vaultCostSol * (BPS + t.bandBps)) return false;
    return moveBps(price, priceQ64(x - out, y + tokensIn)) <= t.maxImpactBps;
  };
  const tokensIn = largestFeasible(min(ideal, perTrade), ok);
  const expectedSol = solOut(x, y, tokensIn);
  if (tokensIn === 0n || expectedSol < s.minTradeLamports) {
    // Spot (Q64 lamports per base unit) vs cost × (1 + band): if spot fails, no size can pass.
    if (price * m.vaultTokens * BPS < (m.vaultCostSol << 64n) * (BPS + t.bandBps)) {
      const need = avgPriceStr((m.vaultCostSol * (BPS + t.bandBps)) / BPS, m.vaultTokens);
      return { action: "hold", kind: "cost_basis", reason: `rally ${dev} vs EMA but fill must be ≥ ${need} (vault avg cost + band)` };
    }
    return { action: "hold", kind: "impact", reason: `rally ${dev} vs EMA, impact/cost limits leave sell below minimum` };
  }
  const impactBps = moveBps(price, priceQ64(x - expectedSol, y + tokensIn));
  return {
    action: "sell",
    kind: "rally",
    reason: `rally ${dev} vs EMA: sell ${compact(tokensToUi(tokensIn))} tokens for ~${solStr(expectedSol)} (impact ${Number(impactBps) / 100}%)`,
    amount: tokensIn,
    expectedOut: expectedSol,
    minOut: minOut(expectedSol, s.slippageBps),
    impactBps,
  };
}

export function evaluate(m: MarketState, s: Sizing, now: bigint): Evaluation {
  const proj = project(m, now);
  const band = m.terms.bandBps;
  const dev = fmtDeviation(proj.deviationPpm);
  const buyTrigger = (proj.ema / BPS) * (BPS - band - SAFETY_MARGIN_BPS);
  const sellTrigger = (proj.ema / BPS) * (BPS + band + SAFETY_MARGIN_BPS);

  let plan: Plan;
  if (proj.price <= buyTrigger) plan = planBuy(m, s, proj);
  else if (proj.price >= sellTrigger) plan = planSell(m, s, proj);
  else if (proj.price <= proj.buyCeiling || proj.price >= proj.sellFloor) {
    plan = { action: "hold", kind: "margin", reason: `price at band edge (${dev} vs EMA), inside ${SAFETY_MARGIN_BPS} bps safety margin` };
  } else {
    plan = { action: "hold", kind: "in_band", reason: `price inside band (${dev} vs EMA)` };
  }
  return { projection: proj, plan };
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
