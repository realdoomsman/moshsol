import { BPS, TOTAL_SUPPLY, bps, bpsCeil, moveBps, priceQ64, solInForTokens, solOut, tokensOut } from "@holdfast/sdk";
import type { AgentTerms, MarketState } from "../src/strategy";

/**
 * The launch account and every instruction that changes it after `launch`, ported statement by
 * statement from programs/moshsol (launch_token.rs, trade.rs, agent.rs, state.rs) on top of the SDK's
 * bigint mirror of math.rs. Written independently of the agent's planner so the backtest (and the
 * property test) can catch a planner that emits trades the program would reject. Instructions run
 * on a copy and commit only on success, like a transaction that reverts on error.
 */

export interface SimTerms extends AgentTerms {
  tradeFeeBps: bigint;
  launchFeeBps: bigint;
}

export interface Chain extends MarketState {
  terms: SimTerms;
  /** All trade fees charged so far (backers + creator + platform). */
  feesSol: bigint;
  /** Realized agent-sell profit credited to backers so far (`VaultProfitShared` amounts). */
  profitShared: bigint;
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

const curveSol = (l: Chain) => l.virtualSol + l.realSol;
const spot = (l: Chain) => priceQ64(curveSol(l), l.tokenReserve);

/** state.rs `update_ema`. */
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
  virtualSol: bigint;
  raised: bigint;
  reserveBps: bigint;
  bundleSupplyBps: bigint;
}

/** launch_token.rs `launch`: the bundle buy at `now`, EMA seeded at the post-bundle spot, a fresh window. */
export function launch(s: LaunchSetup, now: bigint): Chain {
  const launchFee = bps(s.raised, s.terms.launchFeeBps);
  const net = s.raised - launchFee;
  const budget = net - bps(net, s.reserveBps);
  const cap = bps(TOTAL_SUPPLY, s.bundleSupplyBps);
  let tokens = tokensOut(s.virtualSol, TOTAL_SUPPLY, budget);
  let spent = budget;
  if (tokens > cap) {
    tokens = cap;
    const need = solInForTokens(s.virtualSol, TOTAL_SUPPLY, cap);
    spent = need < budget ? need : budget;
  }
  if (tokens <= 0n) throw new Error("launch: bundle buys nothing");
  const l: Chain = {
    terms: s.terms,
    virtualSol: s.virtualSol,
    realSol: spent,
    tokenReserve: TOTAL_SUPPLY - tokens,
    vaultSol: net - spent,
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
    // The simulated slot clock starts at 0; -1 = no trade yet (the program starts at 0 on a chain far past slot 0).
    lastPublicTradeSlot: -1,
    lastAgentTradeSlot: -1,
  };
  l.emaPrice = spot(l);
  l.windowStart = now - s.terms.windowSecs; // i64::MIN / 2 in the program: forces the roll below
  rollWindow(l, now);
  return l;
}

/** trade.rs `buy`: returns tokens out. */
export function publicBuy(chain: Chain, solIn: bigint, minTokensOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    require(solIn > 0n, "ZeroAmount");
    require(slot > l.lastAgentTradeSlot, "SameSlotTrade");
    l.lastPublicTradeSlot = slot;
    updateEma(l, now);
    const fee = bpsCeil(solIn, l.terms.tradeFeeBps);
    const net = solIn - fee;
    const tokens = tokensOut(curveSol(l), l.tokenReserve, net);
    require(tokens > 0n, "ZeroAmount");
    require(tokens < l.tokenReserve, "InsufficientLiquidity");
    require(tokens >= minTokensOut, "Slippage");
    l.realSol += net;
    l.tokenReserve -= tokens;
    l.feesSol += fee;
    l.volumeSol += solIn;
    l.tradeCount += 1;
    return tokens;
  });
}

/** trade.rs `sell`: returns net lamports out. */
export function publicSell(chain: Chain, tokensIn: bigint, minSolOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    require(tokensIn > 0n, "ZeroAmount");
    require(slot > l.lastAgentTradeSlot, "SameSlotTrade");
    l.lastPublicTradeSlot = slot;
    updateEma(l, now);
    const gross = solOut(curveSol(l), l.tokenReserve, tokensIn);
    require(gross <= l.realSol, "InsufficientLiquidity");
    const fee = bpsCeil(gross, l.terms.tradeFeeBps);
    const net = gross - fee;
    require(net > 0n, "ZeroAmount");
    require(net >= minSolOut, "Slippage");
    l.realSol -= gross;
    l.tokenReserve += tokensIn;
    l.feesSol += fee;
    l.volumeSol += gross;
    l.tradeCount += 1;
    return net;
  });
}

/** agent.rs `prelude`. */
function agentPrelude(l: Chain, now: bigint, slot: number): void {
  require(slot > l.lastPublicTradeSlot, "SameSlotTrade");
  l.lastAgentTradeSlot = slot;
  rollWindow(l, now);
  updateEma(l, now);
}

/** agent.rs `agent_buy`: returns tokens bought into the vault. */
export function agentBuy(chain: Chain, solIn: bigint, minTokensOut: bigint, now: bigint, slot: number): TxResult {
  return transact(chain, (l) => {
    agentPrelude(l, now, slot);
    const t = l.terms;
    require(solIn > 0n, "ZeroAmount");
    require(solIn <= l.vaultSol, "InsufficientVault");
    require(l.windowSolSpent + solIn <= l.windowBuyCap, "AgentWindowLimit");
    const before = spot(l);
    require(before <= (l.emaPrice / BPS) * (BPS - t.bandBps), "AgentBuyNotDip");
    const tokens = tokensOut(curveSol(l), l.tokenReserve, solIn);
    require(tokens > 0n, "ZeroAmount");
    require(tokens < l.tokenReserve, "InsufficientLiquidity");
    require(tokens >= minTokensOut, "Slippage");
    const [costSol, costTokens] = l.vaultTokens > 0n ? [l.vaultCostSol, l.vaultTokens] : [l.bundleSol, l.bundleTokens];
    if (!(solIn * costTokens <= tokens * costSol)) {
      const belowAvgSell =
        l.agentTokensSold > 0n && solIn * l.agentTokensSold * BPS <= tokens * l.agentSolReceived * (BPS - t.bandBps);
      require(belowAvgSell && solIn <= l.buybackSol, "AgentAboveCostBasis");
      l.buybackSol -= solIn;
    }
    l.realSol += solIn;
    l.tokenReserve -= tokens;
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
 * agent.rs `agent_sell`: returns the fill in lamports. The sold tokens' average cost (removed from
 * the basis rounded down, charged against the fill rounded up) returns to the vault and the
 * buy-back budget; the realized profit above it is credited to backers.
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
    const sol = solOut(curveSol(l), l.tokenReserve, tokensIn);
    require(sol > 0n, "ZeroAmount");
    require(sol <= l.realSol, "InsufficientLiquidity");
    require(sol >= minSolOut, "Slippage");
    require(sol * l.vaultTokens * BPS >= tokensIn * l.vaultCostSol * (BPS + t.bandBps), "AgentBelowCostBasis");
    // state.rs `vault_cost_of`: the sold tokens' share of the basis, rounded up.
    const cost = (l.vaultCostSol * tokensIn + l.vaultTokens - 1n) / l.vaultTokens;
    const profit = sol > cost ? sol - cost : 0n;
    const kept = sol - profit;
    l.vaultCostSol -= cost;
    l.realSol -= sol;
    l.tokenReserve += tokensIn;
    l.vaultTokens -= tokensIn;
    l.vaultSol += kept;
    l.profitShared += profit;
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

/** Tokens held by the public: everything outside the curve and the vault. */
export function publicTokens(l: Chain): bigint {
  return TOTAL_SUPPLY - l.tokenReserve - l.vaultTokens;
}

/** Production terms (scripts/src/setup.ts, PROFILE=production). */
export const PRODUCTION_TERMS: SimTerms = {
  tradeFeeBps: 100n,
  launchFeeBps: 100n,
  bandBps: 200n,
  maxImpactBps: 300n,
  buyBpsPerWindow: 1_000n,
  sellBpsPerWindow: 500n,
  windowSecs: 3_600n,
  emaPeriodSecs: 1_800n,
};
