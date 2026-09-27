import { TOKEN_2022_PROGRAM_ID, TOTAL_SUPPLY, curvePda, tokenAta, vaultPda } from "@holdfast/sdk";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Store } from "./db";
import type { HolderRow } from "./types";

export interface HolderSet {
  /** Owners sorted by balance desc (curve/vault PDAs labelled). */
  holders: HolderRow[];
  /** Distinct non-program owners with a non-zero balance. */
  count: number;
  at: number;
}

/**
 * Token-2022 holder snapshots, cached per mint for `ttlMs`; concurrent requests share one RPC call.
 *
 * Preferred source is getProgramAccounts (memcmp mint @0, sliced to owner+amount) — exact.
 * Public RPCs exclude the token programs from secondary indexes, so on the first such error we
 * switch permanently to reading the actual token accounts of the curve, the vault and every
 * wallet that ever traded the launch (from the indexed trade ledger).
 */
export class Holders {
  private readonly cache = new Map<string, HolderSet>();
  private readonly inflight = new Map<string, Promise<HolderSet>>();

  private gpaUnavailable = false;

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly ttlMs: number,
    private readonly store: Store,
  ) {}

  cached(mint: string): HolderSet | undefined {
    return this.cache.get(mint);
  }

  /** Drops cached snapshots (chain reset). In-flight loads still resolve for their callers. */
  clear(): void {
    this.cache.clear();
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
    const byOwner = new Map<string, { amount: bigint; label: "curve" | "vault" | null }>();
    const add = (tokenAccount: PublicKey, owner: PublicKey, amount: bigint) => {
      const label = labels.get(tokenAccount.toBase58()) ?? null;
      // Curve/vault rows are keyed (and shown) by their PDA token account so they never merge with users.
      const key = label ? tokenAccount.toBase58() : owner.toBase58();
      byOwner.set(key, { amount: (byOwner.get(key)?.amount ?? 0n) + amount, label });
    };
    if (!this.gpaUnavailable) {
      try {
        const accounts = await this.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
          commitment: "confirmed",
          filters: [{ memcmp: { offset: 0, bytes: mint } }],
          // Token account layout: mint(32) owner(32) amount(u64 LE) …
          dataSlice: { offset: 32, length: 40 },
        });
        for (const { pubkey, account } of accounts) {
          if (account.data.length < 40) continue;
          add(pubkey, new PublicKey(account.data.subarray(0, 32)), account.data.readBigUInt64LE(32));
        }
      } catch (err) {
        if (!/secondary indexes|unavailable for key/i.test(String((err as Error).message))) throw err;
        this.gpaUnavailable = true;
      }
    }
    if (this.gpaUnavailable) {
      // Exact balances for the curve, the vault and every wallet that ever traded this launch
      // (their Token-2022 ATAs), fetched 100 at a time. Only wallets that received tokens by
      // transfer without ever trading are missed.
      const mintKey = new PublicKey(mint);
      const entries: { tokenAccount: PublicKey; owner: PublicKey }[] = [
        { tokenAccount: curvePda(launchKey, this.programId), owner: launchKey },
        { tokenAccount: vaultPda(launchKey, this.programId), owner: launchKey },
        ...this.store.traders(launch).map((t) => {
          const owner = new PublicKey(t);
          return { tokenAccount: tokenAta(owner, mintKey), owner };
        }),
      ];
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100);
        const infos = await this.connection.getMultipleAccountsInfo(
          batch.map((e) => e.tokenAccount),
          "confirmed",
        );
        batch.forEach((e, j) => {
          const data = infos[j]?.data;
          // Token account layout: mint(32) owner(32) amount(u64 LE) …
          if (data && data.length >= 72) add(e.tokenAccount, e.owner, data.readBigUInt64LE(64));
        });
      }
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
