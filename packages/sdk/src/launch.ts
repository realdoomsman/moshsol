import type { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { WIND_DOWN_IDLE_SECS, WIND_DOWN_MIN_AGE_SECS } from "./constants";
import { marketCapSol, q64ToSolPerToken, spotPrice } from "./math";
import type { LaunchAccount, LaunchTermsAccount } from "./program";

/** Launch snapshots (`LaunchJson`) and the pure rules read from them; no Anchor runtime. */
export type LaunchStatus = "raising" | "live" | "refunding" | "woundDown";
export type LaunchVenue = "holdfast" | "pump";

export function statusOf(l: { status: LaunchAccount["status"] }): LaunchStatus {
  if ("live" in l.status) return "live";
  if ("refunding" in l.status) return "refunding";
  if ("woundDown" in l.status) return "woundDown";
  return "raising";
}

export function venueOf(l: { venue: LaunchAccount["venue"] }): LaunchVenue {
  return "pump" in l.venue ? "pump" : "holdfast";
}

/**
 * A raise whose deadline passed below its minimum: it reads `raising` on chain until the first `refund`
 * moves it to `refunding`, but it can never launch and every backer can refund.
 */
export function raiseFailed(l: Pick<LaunchJson, "status" | "raised" | "raiseMin" | "raiseDeadline">, nowSec: number): boolean {
  return l.status === "raising" && nowSec >= l.raiseDeadline && BigInt(l.raised) < BigInt(l.raiseMin);
}

/**
 * Second seed of a launch's PDA: its mint for Holdfast launches, its create key for pump launches
 * (whose mint doesn't exist until `launch_pump`). What the shared builders (`depositIx`, `refundIx`,
 * claims…) take as `seedKey`.
 */
export function seedKeyOf(l: Pick<LaunchJson, "createKey">): PublicKey {
  return new PublicKey(l.createKey);
}

/** What a pump launch's venue builders need, from its JSON snapshot. */
export interface PumpLaunchRef {
  address: PublicKey;
  mint: PublicKey;
  graduated: boolean;
}

export function pumpRefOf(l: Pick<LaunchJson, "address" | "mint" | "pump">): PumpLaunchRef {
  return { address: new PublicKey(l.address), mint: new PublicKey(l.mint), graduated: l.pump.graduated };
}

/** Why `wind_down` would fail right now; null = it would succeed. */
export type WindDownBlocker = "notLive" | "tooYoung" | "recentTrade" | "outsideHolders";

/** Backer payback state of a launch at `nowSec` (lamports as bigint), mirroring `payout_backers`. */
export interface PayoutStatus {
  /** Liquid vault SOL the payback needs: `initialVaultSol × payoutMultBps / 10000`. */
  target: bigint;
  /** Liquid vault SOL now (tokens don't count). */
  liquid: bigint;
  /** Vault floor a payout (or an agent buy) may never go below. */
  minVaultSol: bigint;
  /** `backersRepaid ≥ initialVaultSol`: the next payout is a dividend, not the principal. */
  principalRepaid: boolean;
  /** Earliest time the interval allows the next payout (`lastPayoutTs + payoutIntervalSecs`). */
  nextCheckAt: number;
  /** What the next payout would credit to backers if cranked now (0 when not due). */
  amount: bigint;
  /** Whether `payout_backers` would succeed right now (live, interval elapsed, liquid ≥ target, floor kept). */
  due: boolean;
}

type PayoutInput = Pick<
  LaunchJson,
  "status" | "initialVaultSol" | "backersRepaid" | "vaultSol" | "lastPayoutTs" | "terms"
> | LaunchAccount;

export function payoutStatus(l: PayoutInput, nowSec: number): PayoutStatus {
  const live = typeof l.status === "string" ? l.status === "live" : "live" in l.status;
  const initial = BigInt(l.initialVaultSol.toString());
  const liquid = BigInt(l.vaultSol.toString());
  const minVaultSol = BigInt(l.terms.minVaultSol.toString());
  const target = (initial * BigInt(l.terms.payoutMultBps)) / 10_000n;
  const repaid = BigInt(l.backersRepaid.toString());
  const principalRepaid = repaid >= initial;
  const nextCheckAt = Number(l.lastPayoutTs.toString()) + l.terms.payoutIntervalSecs;
  const amount = principalRepaid ? (liquid * BigInt(l.terms.payoutShareBps)) / 10_000n : initial - repaid;
  const due = live && nowSec >= nextCheckAt && liquid >= target && amount > 0n && liquid - amount >= minVaultSol;
  return { target, liquid, minVaultSol, principalRepaid, nextCheckAt, amount: due ? amount : 0n, due };
}

/** Unix time from which the program's age and idle rules allow `wind_down`. */
export function windDownOpensAt(l: Pick<LaunchJson, "launchedAt" | "lastTradeTs">): number {
  return Math.max(l.launchedAt + WIND_DOWN_MIN_AGE_SECS, l.lastTradeTs + WIND_DOWN_IDLE_SECS);
}

/** The status, age and idle rules of `wind_down` (the holder rule needs balances: `MoshClient.windDownBlocker`). */
export function windDownTimingBlocker(
  l: Pick<LaunchJson, "status" | "launchedAt" | "lastTradeTs">,
  nowSec: number,
): WindDownBlocker | null {
  if (l.status !== "live") return "notLive";
  if (nowSec < l.launchedAt + WIND_DOWN_MIN_AGE_SECS) return "tooYoung";
  if (nowSec < l.lastTradeTs + WIND_DOWN_IDLE_SECS) return "recentTrade";
  return null;
}

const big = (v: BN | number | bigint): bigint => BigInt(v.toString());

/** JSON snapshot of the terms: `minVaultSol` as a decimal lamport string. */
export type LaunchTermsJson = Omit<LaunchTermsAccount, "minVaultSol"> & { minVaultSol: string };
/** Either form (what the builders and `payoutStatus` accept). */
export type TermsLike = Omit<LaunchTermsAccount, "minVaultSol"> & { minVaultSol: { toString(): string } };

/** SOL per whole token for a (lamports, base units) pair. */
function perToken(sol: BN, tokens: BN): number {
  return tokens.isZero() ? 0 : Number(sol.toString()) / 1e9 / (Number(tokens.toString()) / 1e6);
}

/** JSON-safe launch snapshot (u64/u128 as decimal strings) shared by indexer, agent and web. */
export interface LaunchJson {
  address: string;
  mint: string;
  creator: string;
  index: number;
  status: LaunchStatus;
  createdAt: number;
  launchedAt: number;
  /** Economic terms frozen at creation — use these (not platform params) for quotes. */
  terms: LaunchTermsJson;
  raiseMin: string;
  raiseMax: string;
  maxPerWallet: string;
  raiseDeadline: number;
  raised: string;
  refunded: string;
  backerCount: number;
  whitelisted: boolean;
  whitelistRoot: string;
  bundleSupplyBps: number;
  reserveBps: number;
  virtualSol: string;
  realSol: string;
  tokenReserve: string;
  vaultSol: string;
  vaultTokens: string;
  bundleSol: string;
  bundleTokens: string;
  /** SOL cost basis of the tokens currently in the vault (average-cost method). */
  vaultCostSol: string;
  accFeePerShare: string;
  backerFeesAccrued: string;
  backerFeesClaimed: string;
  creatorFeesUnclaimed: string;
  creatorFeesClaimed: string;
  platformFeesUnclaimed: string;
  windowStart: number;
  windowBuyCap: string;
  windowSolSpent: string;
  windowSellCap: string;
  windowTokensSold: string;
  emaPriceQ64: string;
  lastTradeTs: number;
  agentBuys: number;
  agentSells: number;
  agentSolSpent: string;
  agentSolReceived: string;
  agentTokensSold: string;
  volumeSol: string;
  tradeCount: number;
  venue: LaunchVenue;
  /** Second PDA seed: the mint (Holdfast) or the one-time create key (pump). */
  createKey: string;
  pump: {
    /** pump.fun bonding curve; the default pubkey until `launch_pump`. */
    bondingCurve: string;
    /** PumpSwap pool once `graduate_pump` recorded it; the default pubkey before. */
    pool: string;
    graduated: boolean;
  };
  /** SOL waiting for `buyback_burn`. */
  buybackPoolSol: string;
  creatorFeesCollected: string;
  burnedSol: string;
  burnedTokens: string;
  lastBuybackTs: number;
  /** Token metadata of pump launches (empty on Holdfast launches, whose mint carries it). */
  name: string;
  symbol: string;
  uri: string;
  /** SOL the vault started with at launch (bundle + reserve); the payback target is a multiple of it. */
  initialVaultSol: string;
  /** Principal repaid to backers by `payout_backers` so far. */
  backersRepaid: string;
  /** Dividends paid to backers by `payout_backers` so far. */
  backerPayouts: string;
  /** Last payout (or launch) time; the next payout waits `terms.payoutIntervalSecs` after it. */
  lastPayoutTs: number;
  /** Derived: SOL per whole token (Holdfast curve; 0 on pump launches, whose venue prices them). */
  priceSol: number;
  /** Derived: EMA in SOL per whole token. */
  emaSol: number;
  /** Derived: fully diluted market cap in SOL (Holdfast curve; 0 on pump launches). */
  marketCapSol: number;
  /** Derived: vault average cost in SOL per whole token (bundle entry if the vault is empty). */
  vaultAvgCostSol: number;
  /** Derived: average agent sell price in SOL per whole token, null before the first sell. */
  agentAvgSellSol: number | null;
}

export function launchToJson(address: PublicKey, l: LaunchAccount): LaunchJson {
  const curve = { virtualSol: big(l.virtualSol), realSol: big(l.realSol), tokenReserve: big(l.tokenReserve) };
  const s = (v: BN) => v.toString();
  const n = (v: BN | number) => Number(v.toString());
  const root = Buffer.from(l.whitelistRoot as number[]);
  return {
    address: address.toBase58(),
    mint: l.mint.toBase58(),
    creator: l.creator.toBase58(),
    index: n(l.index),
    status: statusOf(l),
    createdAt: n(l.createdAt),
    launchedAt: n(l.launchedAt),
    terms: { ...l.terms, minVaultSol: s(l.terms.minVaultSol) },
    raiseMin: s(l.raiseMin),
    raiseMax: s(l.raiseMax),
    maxPerWallet: s(l.maxPerWallet),
    raiseDeadline: n(l.raiseDeadline),
    raised: s(l.raised),
    refunded: s(l.refunded),
    backerCount: l.backerCount,
    whitelisted: root.some((b) => b !== 0),
    whitelistRoot: root.toString("hex"),
    bundleSupplyBps: l.bundleSupplyBps,
    reserveBps: l.reserveBps,
    virtualSol: s(l.virtualSol),
    realSol: s(l.realSol),
    tokenReserve: s(l.tokenReserve),
    vaultSol: s(l.vaultSol),
    vaultTokens: s(l.vaultTokens),
    bundleSol: s(l.bundleSol),
    bundleTokens: s(l.bundleTokens),
    vaultCostSol: s(l.vaultCostSol),
    accFeePerShare: s(l.accFeePerShare),
    backerFeesAccrued: s(l.backerFeesAccrued),
    backerFeesClaimed: s(l.backerFeesClaimed),
    creatorFeesUnclaimed: s(l.creatorFeesUnclaimed),
    creatorFeesClaimed: s(l.creatorFeesClaimed),
    platformFeesUnclaimed: s(l.platformFeesUnclaimed),
    windowStart: n(l.windowStart),
    windowBuyCap: s(l.windowBuyCap),
    windowSolSpent: s(l.windowSolSpent),
    windowSellCap: s(l.windowSellCap),
    windowTokensSold: s(l.windowTokensSold),
    emaPriceQ64: s(l.emaPrice),
    lastTradeTs: n(l.lastTradeTs),
    agentBuys: l.agentBuys,
    agentSells: l.agentSells,
    agentSolSpent: s(l.agentSolSpent),
    agentSolReceived: s(l.agentSolReceived),
    agentTokensSold: s(l.agentTokensSold),
    volumeSol: s(l.volumeSol),
    tradeCount: n(l.tradeCount),
    venue: venueOf(l),
    createKey: l.createKey.toBase58(),
    pump: {
      bondingCurve: l.pump.bondingCurve.toBase58(),
      pool: l.pump.pool.toBase58(),
      graduated: l.pump.graduated,
    },
    buybackPoolSol: s(l.buybackPoolSol),
    creatorFeesCollected: s(l.creatorFeesCollected),
    burnedSol: s(l.burnedSol),
    burnedTokens: s(l.burnedTokens),
    lastBuybackTs: n(l.lastBuybackTs),
    name: l.name,
    symbol: l.symbol,
    uri: l.uri,
    initialVaultSol: s(l.initialVaultSol),
    backersRepaid: s(l.backersRepaid),
    backerPayouts: s(l.backerPayouts),
    lastPayoutTs: n(l.lastPayoutTs),
    priceSol: "pump" in l.venue ? 0 : spotPrice(curve),
    emaSol: q64ToSolPerToken(big(l.emaPrice)),
    marketCapSol: "pump" in l.venue ? 0 : marketCapSol(curve),
    vaultAvgCostSol: perToken(
      l.vaultTokens.isZero() ? l.bundleSol : l.vaultCostSol,
      l.vaultTokens.isZero() ? l.bundleTokens : l.vaultTokens,
    ),
    agentAvgSellSol: l.agentTokensSold.isZero() ? null : perToken(l.agentSolReceived, l.agentTokensSold),
  };
}

/** bigint curve state from either the raw account or its JSON snapshot. */
export function curveOf(l: Pick<LaunchJson, "virtualSol" | "realSol" | "tokenReserve"> | LaunchAccount) {
  return {
    virtualSol: BigInt(l.virtualSol.toString()),
    realSol: BigInt(l.realSol.toString()),
    tokenReserve: BigInt(l.tokenReserve.toString()),
  };
}
