import { BPS, PUMP_VENUE_FEE_BPS, TOKEN_UNIT, TOTAL_SUPPLY, bps, bpsCeil, moveBps, priceQ64, solInForTokens, solOut, tokensOut, type LaunchVenue } from "@holdfast/sdk";
import { venueFeeBps, type AgentTerms, type MarketState } from "../src/strategy";

/**
 * The launch account and every instruction that changes it after `launch`, ported statement by
 * statement from programs/moshsol (launch_token.rs / pump_launch.rs, trade.rs, agent.rs /
 * pump_agent.rs, state.rs) on top of the SDK's bigint mirror of math.rs. Written independently of the
 * agent's planner so the backtest (and the property test) can catch a planner that emits trades the
 * program would reject. Instructions run on a copy and commit only on success, like a transaction
 * that reverts on error.
 *
 * Venues: a Holdfast launch trades its own curve (`virtualSol` / `realSol` / `tokenReserve` are the
 * launch's fields, every trade prices the EMA and books volume). A pump launch's reserves are its
 * pump.fun bonding curve (`virtualSol` = the curve's virtual offset, `realSol` = real SOL reserves,
 * `tokenReserve` = virtual token reserves, as `curveStateOf`): the venue keeps a 1.25% fee on every
 * trade including the agent's, public trades never touch the launch (no EMA sample, no volume), and
 * the agent's realized profit splits `burnShareBps` to the buyback pool and the rest to backers.
 */

export interface SimTerms extends AgentTerms {
  venue: LaunchVenue;
  /** Holdfast curve trade fee; 0 on pump launches (`LaunchTerms::pump`), whose venue fee never reaches the launch. */
  tradeFeeBps: bigint;
  launchFeeBps: bigint;
  /** Share of realized agent profit booked to the buyback pool (pump launches; 0 on Holdfast launches). */
  burnShareBps: bigint;
}

export interface Chain extends MarketState {
  terms: SimTerms;
  /** All trade fees charged so far (Holdfast: backers + creator + platform; pump: kept by the venue). */
  feesSol: bigint;
  /** Realized agent-sell profit credited to backers so far (`VaultProfitShared` amounts net of the pool share). */
  profitShared: bigint;
  /** Realized agent-sell profit booked to the launch's buyback pool (`Launch.buyback_pool_sol`). */
  buybackPoolSol: bigint;
  lastPublicTradeSlot: number;
  lastAgentTradeSlot: number;
}

export type ProgramError =
  | "SameSlotTrade"
  | "ZeroAmount"
  | "InsufficientVault"
  | "InsufficientLiquidity"
  | "Slippage"
  | "AgentWindowLimit"
  | "AgentBuyNotDip"
  | "AgentSellNotRally"
  | "AgentAboveCostBasis"
  | "AgentBelowCostBasis"
  | "AgentPriceImpact";

export type TxResult = { ok: true; out: bigint } | { ok: false; error: ProgramError };

class Revert {
  constructor(readonly error: ProgramError) {}
}

function require(cond: boolean, error: ProgramError): void {
  if (!cond) throw new Revert(error);
}

/** Runs `ix` on a copy of `chain` and commits it only if no `require` failed. */
function transact(chain: Chain, ix: (l: Chain) => bigint): TxResult {
  const l = { ...chain };
  try {
    const out = ix(l);
    Object.assign(chain, l);
    return { ok: true, out };
  } catch (err) {
    if (err instanceof Revert) return { ok: false, error: err.error };
    throw err;
  }
}

/** pump.fun's bonding curve at creation (`Global` initial reserves; the token supply is TOTAL_SUPPLY). */
export const PUMP_CURVE = {
  virtualSol: 30_000_000_000n,
  virtualTokens: 1_073_000_000n * TOKEN_UNIT,
  realTokens: 793_100_000n * TOKEN_UNIT,
} as const;
/** Rent pump.fun's `create` takes out of the raise (mint, curve, its ATA, metadata), ≈0.02 SOL. */
const PUMP_CREATE_COST = 20_000_000n;
/** constants.rs `PUMP_BUY_FEE_HEADROOM_BPS`. */
const PUMP_BUY_FEE_HEADROOM_BPS = 300n;

const curveSol = (l: Chain) => l.virtualSol + l.realSol;
const spot = (l: Chain) => priceQ64(curveSol(l), l.tokenReserve);

/** Fee the venue charges the public: the launch's trade fee on the Holdfast curve, pump.fun's on a pump launch. */
export function publicFeeBps(l: Pick<Chain, "venue" | "terms">): bigint {
  return l.venue === "pump" ? BigInt(PUMP_VENUE_FEE_BPS) : l.terms.tradeFeeBps;
}

/** Tokens a buy can still take out of the venue (pump.fun sells only its real reserves). */
function buyableTokens(l: Chain): bigint {
  return l.venue === "pump" ? l.tokenReserve - (PUMP_CURVE.virtualTokens - PUMP_CURVE.realTokens) : l.tokenReserve - 1n;
}

/** state.rs `update_ema` (`update_ema_with` the venue spot on pump launches). */
function updateEma(l: Chain, now: bigint): void {
  const p = spot(l);
  if (l.emaPrice === 0n) {
    l.emaPrice = p;
  } else {
    const dt = now > l.lastTradeTs ? now - l.lastTradeTs : 0n;
    const den = dt + l.terms.emaPeriodSecs;
    if (p >= l.emaPrice) l.emaPrice += ((p - l.emaPrice) * dt) / den;
    else l.emaPrice -= ((l.emaPrice - p) * dt) / den;
  }
  l.lastTradeTs = now;
}

/** state.rs `roll_window`. */
function rollWindow(l: Chain, now: bigint): void {
  if (now >= l.windowStart + l.terms.windowSecs) {
    l.windowStart = now;
    l.windowBuyCap = bps(l.vaultSol, l.terms.buyBpsPerWindow);
    l.windowSellCap = bps(l.vaultTokens, l.terms.sellBpsPerWindow);
    l.windowSolSpent = 0n;
    l.windowTokensSold = 0n;
  }
}

export interface LaunchSetup {
  terms: SimTerms;
  /** Holdfast launches: the curve's virtual SOL (pump launches use pump.fun's). */
  virtualSol: bigint;
  raised: bigint;
  reserveBps: bigint;
  bundleSupplyBps: bigint;
}

/** The bundle buy of `launch` / `launch_pump`: (reserves after it, lamports spent, tokens bought, vault SOL left). */
function bundle(s: LaunchSetup, net: bigint): { reserves: Pick<Chain, "virtualSol" | "realSol" | "tokenReserve">; spent: bigint; tokens: bigint; left: bigint } {
  const cap = bps(TOTAL_SUPPLY, s.bundleSupplyBps);
  if (s.terms.venue === "pump") {
    // pump_launch.rs: create rent, then `buy(amount, budget)` sized from the fee-free quote with headroom.
    const remaining = net - PUMP_CREATE_COST;
    const budget = remaining - bps(remaining, s.reserveBps);
    const sized = budget - bps(budget, PUMP_BUY_FEE_HEADROOM_BPS);
    const quoted = tokensOut(PUMP_CURVE.virtualSol, PUMP_CURVE.virtualTokens, sized);
    const tokens = [cap, PUMP_CURVE.realTokens].reduce((a, b) => (b < a ? b : a), quoted);
    if (tokens <= 0n) throw new Error("launch_pump: bundle buys nothing");
    const cost = solInForTokens(PUMP_CURVE.virtualSol, PUMP_CURVE.virtualTokens, tokens);
    const spent = cost + bpsCeil(cost, PUMP_VENUE_FEE_BPS);
    if (spent > budget) throw new Error("launch_pump: bundle over budget");
    return {
      reserves: { virtualSol: PUMP_CURVE.virtualSol, realSol: cost, tokenReserve: PUMP_CURVE.virtualTokens - tokens },
      spent,
      tokens,
      left: remaining - spent,
    };
  }
  const budget = net - bps(net, s.reserveBps);
  let tokens = tokensOut(s.virtualSol, TOTAL_SUPPLY, budget);
  let spent = budget;
  if (tokens > cap) {
    tokens = cap;
    const need = solInForTokens(s.virtualSol, TOTAL_SUPPLY, cap);
    spent = need < budget ? need : budget;
  }
  if (tokens <= 0n) throw new Error("launch: bundle buys nothing");
  return { reserves: { virtualSol: s.virtualSol, realSol: spent, tokenReserve: TOTAL_SUPPLY - tokens }, spent, tokens, left: net - spent };
}

/** launch_token.rs `launch` / pump_launch.rs `launch_pump`: the bundle buy at `now`, EMA seeded at the post-bundle spot, a fresh window. */
export function launch(s: LaunchSetup, now: bigint): Chain {
  const launchFee = bps(s.raised, s.terms.launchFeeBps);
  const { reserves, spent, tokens, left } = bundle(s, s.raised - launchFee);
  const l: Chain = {
    venue: s.terms.venue,
    terms: s.terms,
    ...reserves,
    vaultSol: left,
    vaultTokens: tokens,
    vaultCostSol: spent,
    bundleSol: spent,
    bundleTokens: tokens,
    agentSolReceived: 0n,
    agentTokensSold: 0n,
    buybackSol: 0n,
    windowStart: now,
    windowBuyCap: 0n,
    windowSolSpent: 0n,
    windowSellCap: 0n,
    windowTokensSold: 0n,
    emaPrice: 0n,
    lastTradeTs: now,
    agentBuys: 0,
    agentSells: 0,
    agentSolSpent: 0n,
    volumeSol: spent,
    tradeCount: 1,
    feesSol: 0n,
    profitShared: 0n,
    buybackPoolSol: 0n,
    // The simulated slot clock starts at 0; -1 = no trade yet (the program starts at 0 on a chain far past slot 0).
    lastPublicTradeSlot: -1,
    lastAgentTradeSlot: -1,
  };
  l.emaPrice = spot(l);
  l.windowStart = now - s.terms.windowSecs; // i64::MIN / 2 in the program: forces the roll below
  rollWindow(l, now);
  return l;
}

/** trade.rs `buy` (pump launches: pump.fun's `buy_exact_sol_in`, which never touches the launch): returns tokens out. */
export function publicBuy(chain: Chain, solIn: bigint, minTokensOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    require(solIn > 0n, "ZeroAmount");
    if (l.venue === "holdfast") {
      require(slot > l.lastAgentTradeSlot, "SameSlotTrade");
      l.lastPublicTradeSlot = slot;
      updateEma(l, now);
    }
    const fee = bpsCeil(solIn, publicFeeBps(l));
    const net = solIn - fee;
    const tokens = tokensOut(curveSol(l), l.tokenReserve, net);
    require(tokens > 0n, "ZeroAmount");
    require(tokens <= buyableTokens(l), "InsufficientLiquidity");
    require(tokens >= minTokensOut, "Slippage");
    l.realSol += net;
    l.tokenReserve -= tokens;
    l.feesSol += fee;
    if (l.venue === "holdfast") {
      l.volumeSol += solIn;
      l.tradeCount += 1;
    }
    return tokens;
  });
}

/** trade.rs `sell` (pump launches: pump.fun's `sell`): returns net lamports out. */
export function publicSell(chain: Chain, tokensIn: bigint, minSolOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    require(tokensIn > 0n, "ZeroAmount");
    if (l.venue === "holdfast") {
      require(slot > l.lastAgentTradeSlot, "SameSlotTrade");
      l.lastPublicTradeSlot = slot;
      updateEma(l, now);
    }
    const gross = solOut(curveSol(l), l.tokenReserve, tokensIn);
    require(gross <= l.realSol, "InsufficientLiquidity");
    const fee = bpsCeil(gross, publicFeeBps(l));
    const net = gross - fee;
    require(net > 0n, "ZeroAmount");
    require(net >= minSolOut, "Slippage");
    l.realSol -= gross;
    l.tokenReserve += tokensIn;
    l.feesSol += fee;
    if (l.venue === "holdfast") {
      l.volumeSol += gross;
      l.tradeCount += 1;
    }
    return net;
  });
}

/** agent.rs `prelude` / pump_agent.rs `prepare` + the EMA sample of the venue price. */
function agentPrelude(l: Chain, now: bigint, slot: number): void {
  require(slot > l.lastPublicTradeSlot, "SameSlotTrade");
  l.lastAgentTradeSlot = slot;
  rollWindow(l, now);
  updateEma(l, now);
}

/** agent.rs `agent_buy` / pump_agent.rs `agent_buy_pump`: returns tokens bought into the vault. */
export function agentBuy(chain: Chain, solIn: bigint, minTokensOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    agentPrelude(l, now, slot);
    const t = l.terms;
    require(solIn > 0n, "ZeroAmount");
    require(solIn <= l.vaultSol, "InsufficientVault");
    require(l.windowSolSpent + solIn <= l.windowBuyCap, "AgentWindowLimit");
    const before = spot(l);
    require(before <= (l.emaPrice / BPS) * (BPS - t.bandBps), "AgentBuyNotDip");
    // The venue's fee comes off the spend; the launch measures `spent` = solIn and the net fill.
    const fee = bpsCeil(solIn, venueFeeBps(l));
    const net = solIn - fee;
    const tokens = tokensOut(curveSol(l), l.tokenReserve, net);
    require(tokens > 0n, "ZeroAmount");
    require(tokens <= buyableTokens(l), "InsufficientLiquidity");
    require(tokens >= minTokensOut, "Slippage");
    const [costSol, costTokens] = l.vaultTokens > 0n ? [l.vaultCostSol, l.vaultTokens] : [l.bundleSol, l.bundleTokens];
    if (!(solIn * costTokens <= tokens * costSol)) {
      const belowAvgSell =
        l.agentTokensSold > 0n && solIn * l.agentTokensSold * BPS <= tokens * l.agentSolReceived * (BPS - t.bandBps);
      require(belowAvgSell && solIn <= l.buybackSol, "AgentAboveCostBasis");
      l.buybackSol -= solIn;
    }
    l.realSol += net;
    l.tokenReserve -= tokens;
    l.feesSol += fee;
    l.vaultSol -= solIn;
    l.vaultTokens += tokens;
    l.vaultCostSol += solIn;
    require(moveBps(before, spot(l)) <= t.maxImpactBps, "AgentPriceImpact");
    l.windowSolSpent += solIn;
    l.agentBuys += 1;
    l.agentSolSpent += solIn;
    l.volumeSol += solIn;
    l.tradeCount += 1;
    return tokens;
  });
}

/**
 * agent.rs `agent_sell` / pump_agent.rs `agent_sell_pump`: returns the fill in lamports (net of the venue's
 * fee). The sold tokens' average cost (removed from the basis rounded down, charged against the fill
 * rounded up) returns to the vault and the buy-back budget; the realized profit above it goes
 * `burnShareBps` to the buyback pool and the rest to backers.
 */
export function agentSell(chain: Chain, tokensIn: bigint, minSolOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    agentPrelude(l, now, slot);
    const t = l.terms;
    require(tokensIn > 0n, "ZeroAmount");
    require(tokensIn <= l.vaultTokens, "InsufficientVault");
    require(l.windowTokensSold + tokensIn <= l.windowSellCap, "AgentWindowLimit");
    const before = spot(l);
    require(before >= (l.emaPrice / BPS) * (BPS + t.bandBps), "AgentSellNotRally");
    const gross = solOut(curveSol(l), l.tokenReserve, tokensIn);
    require(gross > 0n, "ZeroAmount");
    require(gross <= l.realSol, "InsufficientLiquidity");
    const fee = bpsCeil(gross, venueFeeBps(l));
    const sol = gross - fee;
    require(sol > 0n, "ZeroAmount");
    require(sol >= minSolOut, "Slippage");
    require(sol * l.vaultTokens * BPS >= tokensIn * l.vaultCostSol * (BPS + t.bandBps), "AgentBelowCostBasis");
    // state.rs `vault_cost_of`: the sold tokens' share of the basis, rounded up.
    const cost = (l.vaultCostSol * tokensIn + l.vaultTokens - 1n) / l.vaultTokens;
    const profit = sol > cost ? sol - cost : 0n;
    const kept = sol - profit;
    l.vaultCostSol -= cost;
    l.realSol -= gross;
    l.tokenReserve += tokensIn;
    l.feesSol += fee;
    l.vaultTokens -= tokensIn;
    l.vaultSol += kept;
    // state.rs `credit_buyback_pool`, then `credit_backers` with the rest.
    const pool = bps(profit, t.burnShareBps);
    l.buybackPoolSol += pool;
    l.profitShared += profit - pool;
    require(moveBps(before, spot(l)) <= t.maxImpactBps, "AgentPriceImpact");
    l.windowTokensSold += tokensIn;
    l.agentSells += 1;
    l.agentSolReceived += sol;
    l.agentTokensSold += tokensIn;
    l.buybackSol += kept;
    l.volumeSol += sol;
    l.tradeCount += 1;
    return sol;
  });
}

/** Tokens held by the public: everything outside the venue and the vault. */
export function publicTokens(l: Chain): bigint {
  return (l.venue === "pump" ? PUMP_CURVE.virtualTokens : TOTAL_SUPPLY) - l.tokenReserve - l.vaultTokens;
}

/** Production terms (scripts/src/setup.ts, PROFILE=production): the Holdfast-curve launches. */
export const PRODUCTION_TERMS: SimTerms = {
  venue: "holdfast",
  tradeFeeBps: 100n,
  launchFeeBps: 100n,
  burnShareBps: 0n,
  bandBps: 200n,
  maxImpactBps: 300n,
  buyBpsPerWindow: 1_000n,
  sellBpsPerWindow: 500n,
  windowSecs: 3_600n,
  emaPeriodSecs: 1_800n,
};

/** The same agent terms frozen by `create_launch_pump` (`LaunchTerms::pump`: no trade fee, the platform's 25% burn share). */
export const PUMP_TERMS: SimTerms = { ...PRODUCTION_TERMS, venue: "pump", tradeFeeBps: 0n, burnShareBps: 2_500n };
