import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOTAL_SUPPLY,
  bondingCurvePda,
  curvePda,
  poolBaseAta,
  poolPda,
  pumpAuthorityPda,
  splAta,
  tokenAta,
  vaultPda,
  type LaunchVenue,
} from "@holdfast/sdk";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Store } from "./db";
import type { HolderRow } from "./types";

/** The launch whose holders to load; pump launches need their venue (curve vs PumpSwap pool) and SPL Token mint. */
export interface HolderTarget {
  address: string;
  mint: string;
  venue: LaunchVenue;
  graduated: boolean;
}

type Label = NonNullable<HolderRow["label"]>;

export interface HolderSet {
  /** Owners sorted by balance desc (curve/vault PDAs labelled). */
  holders: HolderRow[];
  /** Distinct non-program owners with a non-zero balance. */
  count: number;
  /** Largest non-program owner's % of total supply (0 when nobody else holds). */
  topPct: number;
  at: number;
  /** A trade moved balances since `at`: served until the reload lands. */
  stale?: boolean;
}

/** Fewest milliseconds between two holder reloads of one mint, however often its trades invalidate it. */
const MIN_RELOAD_MS = 10_000;

/**
 * Holder snapshots, cached per mint for `ttlMs`; concurrent requests share one RPC call. Holdfast launches
 * are Token-2022 mints whose curve and vault are program PDAs; pump launches are SPL Token mints whose
 * venue account is the bonding curve's ATA (the PumpSwap pool's base account once graduated) and whose
 * vault is the pump authority's ATA. Those accounts are labelled and never counted as holders.
 *
 * Preferred source is getProgramAccounts (memcmp mint @0, sliced to owner+amount) — exact. Helius refuses it on
 * the token programs ("Too many accounts requested") and offers paginated getProgramAccountsV2 instead, which we
 * use on that error. Other public RPCs exclude the token programs from secondary indexes; on the first such error
 * we switch permanently to reading the actual token accounts of the venue, the vault and every wallet that ever
 * traded the launch (from the indexed trade ledger).
 */
export class Holders {
  private readonly cache = new Map<string, HolderSet>();
  private readonly inflight = new Map<string, Promise<HolderSet>>();

  private gpaUnavailable = false;
  /** Token programs whose getProgramAccounts the RPC refused with "use getProgramAccountsV2" (Helius: SPL Token). */
  private readonly gpaV2 = new Set<string>();

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

  /** Marks one mint's snapshot stale (a trade moved balances); the next read reloads it, at most every `MIN_RELOAD_MS`. */
  invalidate(mint: string): void {
    const hit = this.cache.get(mint);
    if (hit) this.cache.set(mint, { ...hit, stale: true });
  }

  async get(target: HolderTarget): Promise<HolderSet> {
    const hit = this.cache.get(target.mint);
    const age = hit ? Date.now() - hit.at : Infinity;
    // A hot launch invalidates on every trade: without a floor, every page view became a getProgramAccounts call
    // and the RPC rate-limited the whole indexer (launch day: 429s on holders, portfolio and the rpc proxy).
    if (hit && (age < MIN_RELOAD_MS || (!hit.stale && age < this.ttlMs))) return hit;
    const running = this.inflight.get(target.mint);
    if (running) return hit ?? running;
    const p = this.load(target).finally(() => this.inflight.delete(target.mint));
    this.inflight.set(target.mint, p);
    if (!hit) return p;
    // A stale snapshot answers now; the reload refreshes the cache (and keeps the old one if the RPC fails).
    p.catch(() => {});
    return hit;
  }

  /** The venue's and the vault's token accounts (with their owner) for a launch. */
  private programAccounts(t: HolderTarget): { tokenAccount: PublicKey; owner: PublicKey; label: Label }[] {
    const launch = new PublicKey(t.address);
    if (t.venue === "holdfast") {
      return [
        { tokenAccount: curvePda(launch, this.programId), owner: launch, label: "curve" },
        { tokenAccount: vaultPda(launch, this.programId), owner: launch, label: "vault" },
      ];
    }
    const mint = new PublicKey(t.mint);
    const curve = bondingCurvePda(mint);
    const pool = poolPda(mint);
    const authority = pumpAuthorityPda(launch, this.programId);
    return [
      { tokenAccount: splAta(curve, mint), owner: curve, label: "curve" },
      { tokenAccount: poolBaseAta(pool, mint), owner: pool, label: "pool" },
      { tokenAccount: splAta(authority, mint), owner: authority, label: "vault" },
    ];
  }

  /**
   * Helius-only paginated gPA (owner+amount slice); same rows as getProgramAccounts. Without a `dataSize` filter
   * Helius walks the whole program 10 000 accounts a page (empty pages for minutes); SPL Token accounts are always
   * 165 bytes so that filter makes it one indexed page. Token-2022 accounts vary (extensions) and need no filter.
   */
  private async programAccountsV2(tokenProgram: PublicKey, mint: string): Promise<{ pubkey: string; data: Buffer }[]> {
    const filters = tokenProgram.equals(TOKEN_PROGRAM_ID)
      ? [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }]
      : [{ memcmp: { offset: 0, bytes: mint } }];
    const rows: { pubkey: string; data: Buffer }[] = [];
    let paginationKey: string | null = null;
    do {
      const res = await fetch(this.connection.rpcEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getProgramAccountsV2",
          params: [
            tokenProgram.toBase58(),
            {
              encoding: "base64",
              commitment: "confirmed",
              filters,
              dataSlice: { offset: 32, length: 40 },
              limit: 10_000,
              ...(paginationKey ? { paginationKey } : {}),
            },
          ],
        }),
      });
      const json = (await res.json()) as {
        error?: { message: string };
        result?: { accounts: { pubkey: string; account: { data: [string, string] } }[]; paginationKey?: string | null };
      };
      if (json.error || !json.result) throw new Error(`getProgramAccountsV2 failed: ${json.error?.message ?? res.status}`);
      for (const a of json.result.accounts) rows.push({ pubkey: a.pubkey, data: Buffer.from(a.account.data[0], "base64") });
      paginationKey = json.result.paginationKey ?? null;
    } while (paginationKey);
    return rows;
  }

  private async load(t: HolderTarget): Promise<HolderSet> {
    const tokenProgram = t.venue === "holdfast" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const program = this.programAccounts(t);
    const labels = new Map<string, Label>(program.map((p) => [p.tokenAccount.toBase58(), p.label]));
    const byOwner = new Map<string, { amount: bigint; label: Label | null }>();
    const add = (tokenAccount: PublicKey, owner: PublicKey, amount: bigint) => {
      const label = labels.get(tokenAccount.toBase58()) ?? null;
      // Venue/vault rows are keyed (and shown) by their token account so they never merge with users.
      const key = label ? tokenAccount.toBase58() : owner.toBase58();
      byOwner.set(key, { amount: (byOwner.get(key)?.amount ?? 0n) + amount, label });
    };
    // Token account layout: mint(32) owner(32) amount(u64 LE) …; rows are sliced to owner+amount.
    const addSliced = (pubkey: string, data: Buffer) => {
      if (data.length < 40) return;
      add(new PublicKey(pubkey), new PublicKey(data.subarray(0, 32)), data.readBigUInt64LE(32));
    };
    if (this.gpaV2.has(tokenProgram.toBase58())) {
      for (const row of await this.programAccountsV2(tokenProgram, t.mint)) addSliced(row.pubkey, row.data);
    } else if (!this.gpaUnavailable) {
      try {
        const accounts = await this.connection.getProgramAccounts(tokenProgram, {
          commitment: "confirmed",
          filters: [{ memcmp: { offset: 0, bytes: t.mint } }],
          dataSlice: { offset: 32, length: 40 },
        });
        for (const { pubkey, account } of accounts) addSliced(pubkey.toBase58(), account.data);
      } catch (err) {
        const message = String((err as Error).message);
        if (/getProgramAccountsV2/i.test(message)) {
          this.gpaV2.add(tokenProgram.toBase58());
          for (const row of await this.programAccountsV2(tokenProgram, t.mint)) addSliced(row.pubkey, row.data);
        } else if (/secondary indexes|unavailable for key/i.test(message)) {
          this.gpaUnavailable = true;
        } else {
          throw err;
        }
      }
    }
    if (this.gpaUnavailable) {
      // Exact balances for the venue, the vault and every wallet that ever traded this launch
      // (their ATAs; public pump.fun trades are in the ledger too), fetched 100 at a time. Only wallets
      // that received tokens by transfer without ever trading are missed.
      const mintKey = new PublicKey(t.mint);
      const entries: { tokenAccount: PublicKey; owner: PublicKey }[] = [
        ...program,
        ...this.store.traders(t.address).map((w) => {
          const owner = new PublicKey(w);
          return { tokenAccount: t.venue === "holdfast" ? tokenAta(owner, mintKey) : splAta(owner, mintKey), owner };
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
    const topPct = holders.find((h) => h.label === null)?.pct ?? 0;
    const set: HolderSet = { holders, count, topPct, at: Date.now() };
    this.cache.set(t.mint, set);
    return set;
  }
}
