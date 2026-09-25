import { ACC_PRECISION, BPS, LAMPORTS_PER_SOL_BIG, Q64, TOKEN_UNIT, TOTAL_SUPPLY } from "./constants";

/** Exact mirrors of programs/moshsol/src/math.rs (all bigint, floor semantics). */

export function bps(amount: bigint, b: number | bigint): bigint {
  return (amount * BigInt(b)) / BPS;
}

export function tokensOut(x: bigint, y: bigint, solIn: bigint): bigint {
  return (y * solIn) / (x + solIn);
}

export function solOut(x: bigint, y: bigint, tokensIn: bigint): bigint {
  return (x * tokensIn) / (y + tokensIn);
}

export function solInForTokens(x: bigint, y: bigint, tokens: bigint): bigint {
  if (tokens >= y) throw new Error("insufficient curve liquidity");
  const num = x * tokens;
  const den = y - tokens;
  return (num + den - 1n) / den;
}

export function priceQ64(x: bigint, y: bigint): bigint {
  return (x << 64n) / y;
}

export function moveBps(before: bigint, after: bigint): bigint {
  const diff = before > after ? before - after : after - before;
  return (diff * BPS + before - 1n) / before;
}

/** SOL per whole token for a Q64.64 lamports-per-base-unit price. */
export function q64ToSolPerToken(q: bigint): number {
  // lamports/base * 1e6 base/token / 1e9 lamports/SOL
  const scaled = (q * TOKEN_UNIT * 1_000_000_000_000n) / (Q64 * LAMPORTS_PER_SOL_BIG);
  return Number(scaled) / 1e12;
}

export interface CurveState {
  virtualSol: bigint;
  realSol: bigint;
  tokenReserve: bigint;
}

export function curveX(c: CurveState): bigint {
  return c.virtualSol + c.realSol;
}

/** SOL per whole token at the current reserves. */
export function spotPrice(c: CurveState): number {
  return q64ToSolPerToken(priceQ64(curveX(c), c.tokenReserve));
}

/** Fully diluted market cap in SOL. */
export function marketCapSol(c: CurveState): number {
  return spotPrice(c) * Number(TOTAL_SUPPLY / TOKEN_UNIT);
}

export interface BuyQuote {
  solIn: bigint;
  fee: bigint;
  tokensOut: bigint;
  priceBefore: number;
  priceAfter: number;
  /** Average fill price in SOL per token. */
  avgPrice: number;
  impactBps: number;
}

export function quoteBuy(c: CurveState, solIn: bigint, tradeFeeBps: number): BuyQuote {
  const fee = bps(solIn, tradeFeeBps);
  const net = solIn - fee;
  const x = curveX(c);
  const out = net > 0n ? tokensOut(x, c.tokenReserve, net) : 0n;
  const before = priceQ64(x, c.tokenReserve);
  const after = out > 0n && out < c.tokenReserve ? priceQ64(x + net, c.tokenReserve - out) : before;
  return {
    solIn,
    fee,
    tokensOut: out,
    priceBefore: q64ToSolPerToken(before),
    priceAfter: q64ToSolPerToken(after),
    avgPrice: out > 0n ? Number(solIn) / 1e9 / (Number(out) / 1e6) : 0,
    impactBps: out > 0n ? Number(moveBps(before, after)) : 0,
  };
}

export interface SellQuote {
  tokensIn: bigint;
  gross: bigint;
  fee: bigint;
  solOut: bigint;
  priceBefore: number;
  priceAfter: number;
  avgPrice: number;
  impactBps: number;
}

export function quoteSell(c: CurveState, tokensIn: bigint, tradeFeeBps: number): SellQuote {
  const x = curveX(c);
  const gross = tokensIn > 0n ? solOut(x, c.tokenReserve, tokensIn) : 0n;
  const capped = gross > c.realSol ? c.realSol : gross;
  const fee = bps(capped, tradeFeeBps);
  const before = priceQ64(x, c.tokenReserve);
  const after = tokensIn > 0n ? priceQ64(x - capped, c.tokenReserve + tokensIn) : before;
  return {
    tokensIn,
    gross: capped,
    fee,
    solOut: capped - fee,
    priceBefore: q64ToSolPerToken(before),
    priceAfter: q64ToSolPerToken(after),
    avgPrice: tokensIn > 0n ? Number(capped - fee) / 1e9 / (Number(tokensIn) / 1e6) : 0,
    impactBps: tokensIn > 0n ? Number(moveBps(before, after)) : 0,
  };
}

/** Applies slippage tolerance to an expected output. */
export function minOut(expected: bigint, slippageBps: number): bigint {
  return (expected * (BPS - BigInt(slippageBps))) / BPS;
}

/** Backer fee entitlement not yet claimed. */
export function backerClaimable(deposited: bigint, accFeePerShare: bigint, feesClaimed: bigint): bigint {
  const entitled = (deposited * accFeePerShare) / ACC_PRECISION;
  return entitled > feesClaimed ? entitled - feesClaimed : 0n;
}

export interface BundlePreview {
  launchFee: bigint;
  bundleSol: bigint;
  bundleTokens: bigint;
  vaultSol: bigint;
  supplyPct: number;
  priceAfter: number;
  marketCapAfter: number;
}

/** Mirrors the bundle buy executed by the `launch` instruction. */
export function previewBundle(p: {
  raised: bigint;
  virtualSol: bigint;
  launchFeeBps: number;
  reserveBps: number;
  bundleSupplyBps: number;
}): BundlePreview {
  const launchFee = bps(p.raised, p.launchFeeBps);
  const net = p.raised - launchFee;
  const budget = net - bps(net, p.reserveBps);
  const cap = bps(TOTAL_SUPPLY, p.bundleSupplyBps);
  let tokens = tokensOut(p.virtualSol, TOTAL_SUPPLY, budget);
  let spent = budget;
  if (tokens > cap) {
    tokens = cap;
    const need = solInForTokens(p.virtualSol, TOTAL_SUPPLY, cap);
    spent = need < budget ? need : budget;
  }
  const curve = { virtualSol: p.virtualSol, realSol: spent, tokenReserve: TOTAL_SUPPLY - tokens };
  return {
    launchFee,
    bundleSol: spent,
    bundleTokens: tokens,
    vaultSol: net - spent,
    supplyPct: Number((tokens * 10_000n) / TOTAL_SUPPLY) / 100,
    priceAfter: spotPrice(curve),
    marketCapAfter: marketCapSol(curve),
  };
}
