import { TOKEN_2022_PROGRAM_ID, TOTAL_SUPPLY, curvePda, vaultPda } from "@moshsol/sdk";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { HolderRow } from "./types";

export interface HolderSet {
  /** Owners sorted by balance desc (curve/vault PDAs labelled). */
  holders: HolderRow[];
  /** Distinct non-program owners with a non-zero balance. */
  count: number;
  at: number;
}

/**
 * Token-2022 holder snapshots via getProgramAccounts (memcmp mint @0, sliced to owner+amount),
 * cached per mint for `ttlMs`; concurrent requests share one RPC call.
 */
export class Holders {
  private readonly cache = new Map<string, HolderSet>();
  private readonly inflight = new Map<string, Promise<HolderSet>>();

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly ttlMs: number,
  ) {}

  cached(mint: string): HolderSet | undefined {
    return this.cache.get(mint);
  }

  async get(mint: string, launch: string): Promise<HolderSet> {
    const hit = this.cache.get(mint);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit;
    const running = this.inflight.get(mint);
    if (running) return running;
    const p = this.load(mint, launch).finally(() => this.inflight.delete(mint));
    this.inflight.set(mint, p);
    return p;
  }

  private async load(mint: string, launch: string): Promise<HolderSet> {
    const launchKey = new PublicKey(launch);
    const labels = new Map<string, "curve" | "vault">([
      [curvePda(launchKey, this.programId).toBase58(), "curve"],
      [vaultPda(launchKey, this.programId).toBase58(), "vault"],
    ]);
    const accounts = await this.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: mint } }],
      // Token account layout: mint(32) owner(32) amount(u64 LE) …
      dataSlice: { offset: 32, length: 40 },
    });
    const byOwner = new Map<string, { amount: bigint; label: "curve" | "vault" | null }>();
    for (const { pubkey, account } of accounts) {
      if (account.data.length < 40) continue;
      const amount = account.data.readBigUInt64LE(32);
      const label = labels.get(pubkey.toBase58()) ?? null;
      // Curve/vault rows are keyed (and shown) by their PDA token account so they never merge with users.
      const key = label ? pubkey.toBase58() : new PublicKey(account.data.subarray(0, 32)).toBase58();
      byOwner.set(key, { amount: (byOwner.get(key)?.amount ?? 0n) + amount, label });
    }
    const holders: HolderRow[] = [];
    let count = 0;
    for (const [owner, { amount, label }] of byOwner) {
      if (amount === 0n) continue;
      if (!label) count++;
      holders.push({
        owner,
        amount: amount.toString(),
        pct: Number((amount * 1_000_000n) / TOTAL_SUPPLY) / 10_000,
        label,
      });
    }
    holders.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0));
    const set: HolderSet = { holders, count, at: Date.now() };
    this.cache.set(mint, set);
    return set;
  }
}
