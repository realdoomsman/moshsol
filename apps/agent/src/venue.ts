import { PublicKey } from "@solana/web3.js";
import {
  bondingCurvePda,
  curveStateOf,
  decodeBondingCurve,
  decodePool,
  poolBaseAta,
  poolPda,
  poolQuoteAta,
  poolStateOf,
  type LaunchJson,
  type VenueState,
} from "@holdfast/sdk";

/**
 * A pump launch's venue state from accounts read in a batch or delivered by the stream (`fetchVenueState` for
 * one launch at a time): the bonding curve before graduation; after it the pool's base and quote token accounts
 * and the pool itself, whose signed `virtual_quote_reserves` PumpSwap adds to the quote balance to price trades.
 */

/** SPL token account layout: mint(32) owner(32) amount(u64). */
const TOKEN_AMOUNT_OFFSET = 64;

export function tokenAmount(info: { data: Buffer }): bigint {
  return info.data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
}

/** The accounts `decodeVenue` needs for `l`, in order. */
export function venueKeys(l: Pick<LaunchJson, "mint" | "pump">): PublicKey[] {
  const mint = new PublicKey(l.mint);
  if (!l.pump.graduated) return [bondingCurvePda(mint)];
  return poolKeys(mint, new PublicKey(l.pump.pool));
}

/**
 * A graduated launch's venue accounts: the pool's base and quote token accounts and the pool. `pool` defaults to the
 * canonical pool pump.fun migrates a completed curve into, the only one `graduate_pump` accepts, so the agent can
 * watch it from the moment the curve completes, before the launch records it.
 */
export function poolKeys(mint: PublicKey, pool = poolPda(mint)): PublicKey[] {
  return [poolBaseAta(pool, mint), poolQuoteAta(pool), pool];
}

/** `fetchVenueState`'s decoding of the `venueKeys(l)` accounts; null when any is missing. */
export function decodeVenue(l: Pick<LaunchJson, "mint" | "pump">, infos: ({ data: Buffer } | null)[]): VenueState | null {
  if (!l.pump.graduated) {
    const [curve] = infos;
    if (!curve) return null;
    const c = decodeBondingCurve(curve.data);
    return { curve: curveStateOf(c), complete: c.complete };
  }
  const [base, quote, pool] = infos;
  if (!base || !quote || !pool) return null;
  return { curve: poolStateOf(tokenAmount(quote), tokenAmount(base), decodePool(pool.data).virtualQuoteReserves), complete: false };
}
