import {
  BPS,
  PUMP_BUNDLE_BUY_RENT_LAMPORTS,
  PUMP_CREATE_COST_LAMPORTS,
  PUMP_CURVE_CREATOR_FEE_BPS,
  PUMP_CURVE_PROTOCOL_FEE_BPS,
  PUMP_VENUE_FEE_BPS,
  TOKEN_UNIT,
  TOTAL_SUPPLY,
  bps,
  bpsCeil,
  moveBps,
  priceQ64,
  solInForTokens,
  solOut,
  tokensOut,
  type LaunchVenue,
} from "@holdfast/sdk";
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
 * `tokenReserve` = virtual token reserves, as `curveStateOf`) until a buy takes its last real token; pump.fun
 * then migrates it into a PumpSwap pool (`graduated`: the curve's real SOL and the supply it never sold, the
 * same spot, so `virtualSol` = 0), modelled as instant, with no migration fee and no virtual quote. The venue
 * keeps a 1.25% fee on every trade including the agent's, and public trades never touch the launch (no EMA
 * sample, no volume). On both venues every lamport an agent sell receives stays in the vault as liquid SOL (no
 * profit share), and no agent buy may take the vault below `minVaultSol` (`VaultFloor`).
 */

export interface SimTerms extends AgentTerms {
  venue: LaunchVenue;
  /** Holdfast curve trade fee; 0 on pump launches (`LaunchTerms::pump`), whose venue fee never reaches the launch. */
  tradeFeeBps: bigint;
  launchFeeBps: bigint;
}

export interface Chain extends MarketState {
  terms: SimTerms;
  /** All trade fees charged so far (Holdfast: backers + creator + platform; pump: kept by the venue). */
  feesSol: bigint;
  lastPublicTradeSlot: number;
  lastAgentTradeSlot: number;
  /** Pump launches: the curve completed and its reserves are now the PumpSwap pool's. */
  graduated: boolean;
}

export type ProgramError =
  | "SameSlotTrade"
  | "ZeroAmount"
  | "InsufficientVault"
  | "VaultFloor"
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
/** constants.rs `PUMP_BUY_FEE_HEADROOM_BPS`. */
const PUMP_BUY_FEE_HEADROOM_BPS = 300n;

const curveSol = (l: Chain) => l.virtualSol + l.realSol;
const spot = (l: Chain) => priceQ64(curveSol(l), l.tokenReserve);

/** Fee the venue charges the public: the launch's trade fee on the Holdfast curve, pump.fun's on a pump launch. */
export function publicFeeBps(l: Pick<Chain, "venue" | "terms">): bigint {
  return l.venue === "pump" ? BigInt(PUMP_VENUE_FEE_BPS) : l.terms.tradeFeeBps;
}

/** Supply pump.fun moves into the PumpSwap pool when the curve completes: everything the curve never sold. */
const PUMP_POOL_TOKENS = TOTAL_SUPPLY - PUMP_CURVE.realTokens;

/**
 * Tokens `net` lamports buy from the venue, reserves moved (`InsufficientLiquidity` when the venue can't fill it).
 * pump.fun sells only its real tokens: a buy that reaches the last one completes the curve, which is migrated into
 * the pool (x/y is continuous: 85 SOL over 206.9M tokens is the curve's final 115 SOL over 279.9M), and the rest of
 * the buy fills there.
 */
function venueBuy(l: Chain, net: bigint): bigint {
  if (l.venue === "pump" && !l.graduated) {
    const left = l.tokenReserve - (PUMP_CURVE.virtualTokens - PUMP_CURVE.realTokens);
    const tokens = tokensOut(curveSol(l), l.tokenReserve, net);
    if (tokens < left) {
      l.realSol += net;
      l.tokenReserve -= tokens;
      return tokens;
    }
    const cost = solInForTokens(curveSol(l), l.tokenReserve, left);
    const paid = cost < net ? cost : net;
    l.realSol += paid;
    l.virtualSol = 0n;
    l.tokenReserve = PUMP_POOL_TOKENS;
    l.graduated = true;
    return left + (net > paid ? venueBuy(l, net - paid) : 0n);
  }
  const tokens = tokensOut(curveSol(l), l.tokenReserve, net);
  require(tokens < l.tokenReserve, "InsufficientLiquidity");
  l.realSol += net;
  l.tokenReserve -= tokens;
  return tokens;
}

/** state.rs `update_ema` (`update_ema_with` the venue spot on pump launches, `dt` clamped to the period there). */
function updateEma(l: Chain, now: bigint): void {
  const p = spot(l);
  if (l.emaPrice === 0n) {
    l.emaPrice = p;
  } else {
    const idle = now > l.lastTradeTs ? now - l.lastTradeTs : 0n;
    const dt = l.venue === "pump" && idle > l.terms.emaPeriodSecs ? l.terms.emaPeriodSecs : idle;
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
    // pump_launch.rs: create rent (mint, curve, its ATA, metadata), then `buy(amount, budget)` sized from the fee-free quote with headroom.
    const remaining = net - PUMP_CREATE_COST_LAMPORTS;
    const budget = remaining - bps(remaining, s.reserveBps);
    const sized = budget - bps(budget, PUMP_BUY_FEE_HEADROOM_BPS);
    const quoted = tokensOut(PUMP_CURVE.virtualSol, PUMP_CURVE.virtualTokens, sized);
    const tokens = [cap, PUMP_CURVE.realTokens - 1n].reduce((a, b) => (b < a ? b : a), quoted);
    if (tokens <= 0n) throw new Error("launch_pump: bundle buys nothing");
    const cost = solInForTokens(PUMP_CURVE.virtualSol, PUMP_CURVE.virtualTokens, tokens);
    // pump.fun rounds its protocol and creator fees up separately and charges the buyer two one-time rents on top.
    const spent = cost + bpsCeil(cost, PUMP_CURVE_PROTOCOL_FEE_BPS) + bpsCeil(cost, PUMP_CURVE_CREATOR_FEE_BPS) + PUMP_BUNDLE_BUY_RENT_LAMPORTS;
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
    // The simulated slot clock starts at 0; -1 = no trade yet (the program starts at 0 on a chain far past slot 0).
    lastPublicTradeSlot: -1,
    lastAgentTradeSlot: -1,
    graduated: false,
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
    const tokens = venueBuy(l, net);
    require(tokens > 0n, "ZeroAmount");
    require(tokens >= minTokensOut, "Slippage");
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
    require(l.vaultSol - solIn >= t.minVaultSol, "VaultFloor");
    require(l.windowSolSpent + solIn <= l.windowBuyCap, "AgentWindowLimit");
    const before = spot(l);
    require(before <= (l.emaPrice / BPS) * (BPS - t.bandBps), "AgentBuyNotDip");
    // The venue's fee comes off the spend; the launch measures `spent` = solIn and the net fill.
    const fee = bpsCeil(solIn, venueFeeBps(l));
    const net = solIn - fee;
    const tokens = venueBuy(l, net);
    require(tokens > 0n, "ZeroAmount");
    require(tokens >= minTokensOut, "Slippage");
    const [costSol, costTokens] = l.vaultTokens > 0n ? [l.vaultCostSol, l.vaultTokens] : [l.bundleSol, l.bundleTokens];
    if (!(solIn * costTokens <= tokens * costSol)) {
      // Buy-back path: below the average agent sell price by the band, paid from vault SOL like any buy.
      const belowAvgSell =
        l.agentTokensSold > 0n && solIn * l.agentTokensSold * BPS <= tokens * l.agentSolReceived * (BPS - t.bandBps);
      require(belowAvgSell, "AgentAboveCostBasis");
    }
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
 * fee). The sold tokens' average cost leaves the basis (rounded down) and the whole fill returns to
 * vault SOL: proceeds are the vault's capital for buying the next dip, not a profit to distribute.
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
    l.vaultCostSol -= cost;
    l.realSol -= gross;
    l.tokenReserve += tokensIn;
    l.feesSol += fee;
    l.vaultTokens -= tokensIn;
    l.vaultSol += sol;
    require(moveBps(before, spot(l)) <= t.maxImpactBps, "AgentPriceImpact");
    l.windowTokensSold += tokensIn;
    l.agentSells += 1;
    l.agentSolReceived += sol;
    l.agentTokensSold += tokensIn;
    l.volumeSol += sol;
    l.tradeCount += 1;
    return sol;
  });
}

/** Tokens held by the public: everything outside the venue and the vault (the curve's reserve is virtual by its offset, the pool's is real). */
export function publicTokens(l: Chain): bigint {
  return (l.venue === "pump" && !l.graduated ? PUMP_CURVE.virtualTokens : TOTAL_SUPPLY) - l.tokenReserve - l.vaultTokens;
}

/** Production terms (scripts/src/setup.ts, PROFILE=production): the Holdfast-curve launches. */
export const PRODUCTION_TERMS: SimTerms = {
  venue: "holdfast",
  tradeFeeBps: 100n,
  launchFeeBps: 100n,
  bandBps: 200n,
  maxImpactBps: 300n,
  buyBpsPerWindow: 1_000n,
  sellBpsPerWindow: 500n,
  windowSecs: 3_600n,
  emaPeriodSecs: 1_800n,
  minVaultSol: 100_000_000n,
};

/** The same agent terms frozen by `create_launch_pump` (`LaunchTerms::pump`: no trade fee). */
export const PUMP_TERMS: SimTerms = { ...PRODUCTION_TERMS, venue: "pump", tradeFeeBps: 0n };
