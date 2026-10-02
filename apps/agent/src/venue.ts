import { PublicKey } from "@solana/web3.js";
import { bondingCurvePda, curveStateOf, decodeBondingCurve, poolBaseAta, poolQuoteAta, poolStateOf, type LaunchJson, type VenueState } from "@holdfast/sdk";

/**
 * A pump launch's venue state from accounts read in a batch or delivered by the stream (`fetchVenueState` for
 * one launch at a time): the bonding curve before graduation, the pool's base and quote token accounts after.
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
  const pool = new PublicKey(l.pump.pool);
  return [poolBaseAta(pool, mint), poolQuoteAta(pool)];
}

/** `fetchVenueState`'s decoding of the `venueKeys(l)` accounts; null when any is missing. */
export function decodeVenue(l: Pick<LaunchJson, "mint" | "pump">, infos: ({ data: Buffer } | null)[]): VenueState | null {
  if (!l.pump.graduated) {
    const [curve] = infos;
    if (!curve) return null;
    const c = decodeBondingCurve(curve.data);
    return { curve: curveStateOf(c), complete: c.complete };
  }
  const [base, quote] = infos;
  if (!base || !quote) return null;
  return { curve: poolStateOf(tokenAmount(quote), tokenAmount(base)), complete: false };
}
