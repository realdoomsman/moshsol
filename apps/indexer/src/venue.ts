import {
  bondingCurvePda,
  curveStateOf,
  decodeBondingCurve,
  poolBaseAta,
  poolPda,
  poolQuoteAta,
  poolStateOf,
  type VenueState,
} from "@holdfast/sdk";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

/** A launched pump launch whose venue reserves price it. */
export interface VenueTarget {
  address: string;
  mint: PublicKey;
  graduated: boolean;
}

const BATCH = 100;

/** SPL token account layout: mint(32) owner(32) amount(u64 LE) … */
function tokenAmount(info: AccountInfo<Buffer> | null): bigint | null {
  return info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : null;
}

/**
 * The reserves each launch currently trades against — PumpSwap pool base/quote balances once graduated,
 * the bonding curve before — read with one `getMultipleAccountsInfo` per 100 accounts instead of one RPC
 * call per launch (`fetchVenueState` in the SDK does one launch). Launches whose venue account doesn't
 * exist (yet) map to null.
 */
export async function loadVenueStates(
  connection: Connection,
  targets: VenueTarget[],
): Promise<Map<string, VenueState | null>> {
  const keys: PublicKey[] = [];
  const reads: { target: VenueTarget; at: number }[] = [];
  for (const target of targets) {
    reads.push({ target, at: keys.length });
    if (target.graduated) {
      const pool = poolPda(target.mint);
      keys.push(poolBaseAta(pool, target.mint), poolQuoteAta(pool));
    } else {
      keys.push(bondingCurvePda(target.mint));
    }
  }
  const infos: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    infos.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + BATCH), "confirmed")));
  }
  const out = new Map<string, VenueState | null>();
  for (const { target, at } of reads) {
    if (target.graduated) {
      const base = tokenAmount(infos[at]);
      const quote = tokenAmount(infos[at + 1]);
      out.set(target.address, base !== null && quote !== null ? { curve: poolStateOf(quote, base), complete: false } : null);
    } else {
      const info = infos[at];
      if (!info) {
        out.set(target.address, null);
        continue;
      }
      const c = decodeBondingCurve(info.data);
      out.set(target.address, { curve: curveStateOf(c), complete: c.complete });
    }
  }
  return out;
}
