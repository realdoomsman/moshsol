import { lamportsToSol, spotPrice, type LaunchJson } from "@holdfast/sdk";
import { PublicKey, type ConfirmedSignatureInfo, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import { activityFromRow } from "./activity";
import { DEFAULT_PUBKEY, type Store } from "./db";
import type { Holders } from "./holders";
import type { Hub } from "./hub";
import type { LogsStream } from "./logs-stream";
import { decodePumpTrades, invokesProgram, type PumpTradeEvent } from "./pump-events";

export interface PumpSyncOptions {
  /** Re-reads the launch (price/market cap snapshot) after its public trades were booked. */
  onTrade(address: string): void;
}

/** The RPC calls the venue scans make. */
export type PumpRpc = Pick<Connection, "getSignaturesForAddress" | "getTransaction">;

/** A live pump launch: its public trades carry the mint (bonding curve) or the pool (PumpSwap). */
interface Launch {
  address: string;
  mint: string;
}

/** A venue account being scanned: the bonding curve, the PumpSwap pool once graduated. */
interface Watch {
  account: string;
  launch: Launch;
  /** A graduated launch's bonding curve: scanned until every pre-migration signature is indexed, then dropped. */
  draining: boolean;
  /** When the last complete reconcile started (this process; -Infinity → due on the next poll). */
  reconciledAt: number;
  /** The cursor when that reconcile started: the next one moves `pump_reconciled:<account>` there. */
  reconciledHead: string | null;
}

export const SIG_PAGE = 1_000;
/** A reconcile scan of every watched account re-lists its signatures since the previous reconcile this often. */
export const RECONCILE_MS = 5 * 60_000;
/** Transactions fetched at once, and at most per account per poll (a long backlog continues on the next poll). */
const FETCH_CONCURRENCY = 4;
const FETCH_BUDGET = 500;
/** Trades older than this when booked (backfills, reconciles) are not pushed to live activity feeds. */
const LIVE_EVENT_S = 120;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/**
 * `getTransaction` refuses transactions newer than the client's `maxSupportedTransactionVersion`; this is a ceiling,
 * not a format we decode (only `slot` and `meta.logMessages` are read). Public pump.fun trades already arrive as
 * version 1 transactions; pinning 0 would stall the cursor on the first one.
 */
export const MAX_TX_VERSION = 255;

const cursorKey = (account: string) => `pump_cursor:${account}`;
const reconciledKey = (account: string) => `pump_reconciled:${account}`;
const drainedKey = (account: string) => `pump_drained:${account}`;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Every signature of `account` newer than `until` (its whole history without one), newest first. Pages with `before`
 * until the RPC returns an empty page: a short page is not proof of the end. Any failed page throws, so a caller never
 * acts on (or moves a cursor over) a partial listing.
 */
export async function listSignatures(rpc: PumpRpc, account: PublicKey, until: string | undefined): Promise<ConfirmedSignatureInfo[]> {
  const found: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc.getSignaturesForAddress(account, { before, until, limit: SIG_PAGE }, "confirmed");
    if (page.length === 0) return found;
    found.push(...page);
    before = page[page.length - 1]!.signature;
  }
}

/**
 * Public pump.fun / PumpSwap trades of live pump launches, which never touch this program. Each live launch's venue
 * accounts are watched on the shared logs websocket (`mentions`) and scanned every poll:
 * - forward scan: every signature newer than `pump_cursor:<account>` (the account's whole history the first time),
 *   booked oldest first; the cursor only moves past a signature once it is booked, so an RPC error, a transaction not
 *   visible yet or a restart resumes exactly there;
 * - reconcile (every `RECONCILE_MS`, and on the first poll after a start): every signature since
 *   `pump_reconciled:<account>` (the whole history the first time) — the cursor as of the start of the reconcile before
 *   the previous one, so each reconcile re-checks two intervals — and any successful one not indexed yet (a dropped
 *   websocket notification, a signature that surfaced behind the cursor, history a cursor never covered) is booked;
 * - a graduated launch keeps its bonding curve watched next to the pool until a complete forward scan and reconcile ran
 *   after graduation (`pump_drained:<curve>`), so the curve's last trades before the migration are never dropped.
 * Transactions that also invoke this program are the vault agent's: the program's `Trade` event books those, so they
 * are skipped here. Any RPC failure (typically a 429) pauses scanning with exponential backoff (5 s → 5 min) instead of
 * failing the program sync; progress made before it is kept.
 */
export class PumpSync {
  /** Watched venue account → its scan. */
  private readonly watches = new Map<string, Watch>();
  /** Every live pump launch by mint and by pool, whether or not that venue is watched (attribution of decoded trades). */
  private readonly byMint = new Map<string, Launch>();
  private readonly byPool = new Map<string, Launch>();
  private backoffUntil = 0;
  private failures = 0;

  constructor(
    private readonly store: Store,
    private readonly rpc: PumpRpc,
    private readonly hub: Hub,
    private readonly holders: Holders,
    private readonly stream: LogsStream,
    private readonly programId: string,
    private readonly log: FastifyBaseLogger,
    private readonly opts: PumpSyncOptions,
    private readonly now: () => number = Date.now,
  ) {}

  /** Watches the venue accounts of every live pump launch and drops the others (ended, wound down, wiped, drained). */
  syncTargets(): void {
    const next = new Map<string, Watch>();
    this.byMint.clear();
    this.byPool.clear();
    for (const row of this.store.launches()) {
      if (row.venue !== "pump" || row.status !== "live" || row.mint === DEFAULT_PUBKEY) continue;
      const pump = (JSON.parse(row.snapshot) as LaunchJson).pump;
      const launch = { address: row.address, mint: row.mint };
      this.byMint.set(row.mint, launch);
      this.byPool.set(pump.pool, launch);
      const watch = (account: string, draining: boolean) => next.set(account, { account, launch, draining, reconciledAt: -Infinity, reconciledHead: null });
      if (pump.graduated) {
        watch(pump.pool, false);
        if (this.store.getState(drainedKey(pump.bondingCurve)) === null) watch(pump.bondingCurve, true);
      } else {
        watch(pump.bondingCurve, false);
      }
    }
    for (const [account, w] of this.watches) {
      if (next.has(account)) continue;
      this.watches.delete(account);
      this.stream.unwatch(account);
      this.log.info({ launch: w.launch.address, account }, "stopped watching pump venue");
    }
    for (const [account, w] of next) {
      const known = this.watches.get(account);
      if (known) {
        known.draining = w.draining;
        continue;
      }
      this.watches.set(account, w);
      this.stream.watch(account);
      this.log.info({ launch: w.launch.address, mint: w.launch.mint, account, draining: w.draining }, "watching pump venue for public trades");
    }
  }

  /** One scan of every watched account (see the class doc). */
  async poll(): Promise<void> {
    if (this.now() < this.backoffUntil) return;
    for (const w of [...this.watches.values()]) {
      try {
        await this.scan(w);
      } catch (err) {
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.failures);
        this.failures += 1;
        this.backoffUntil = this.now() + delay;
        this.log.warn({ launch: w.launch.address, account: w.account, error: errorText(err), retryInMs: delay }, "pump trade poll failed; backing off");
        return;
      }
    }
    this.failures = 0;
  }

  /** Live logs of a transaction mentioning a watched venue account. */
  async onLogs(signature: string, slot: number, logs: string[]): Promise<void> {
    if (this.store.hasTx(signature)) return;
    await this.apply(signature, slot, logs);
  }

  private async scan(w: Watch): Promise<void> {
    const budget = { left: FETCH_BUDGET };
    const forwardDone = await this.forward(w, budget);
    const due = w.draining || this.now() - w.reconciledAt >= RECONCILE_MS;
    if (!forwardDone || !due) return;
    if (!(await this.reconcile(w, budget)) || !w.draining) return;
    // Graduated, and both scans saw the curve's complete history since then: nothing can trade on it any more.
    this.store.setState(drainedKey(w.account), "1");
    this.watches.delete(w.account);
    this.stream.unwatch(w.account);
    this.log.info({ launch: w.launch.address, account: w.account }, "bonding curve fully indexed after graduation; stopped watching it");
  }

  /** Lists signatures newer than the signature stored at `key`; a signature the node no longer knows restarts from the whole history. */
  private async listSince(account: string, key: string): Promise<{ sigs: ConfirmedSignatureInfo[]; since: string | null }> {
    const since = this.store.getState(key);
    try {
      return { sigs: await listSignatures(this.rpc, new PublicKey(account), since ?? undefined), since };
    } catch (err) {
      if (since === null || !errorText(err).includes(since)) throw err;
      this.log.warn({ account, key, since }, "pump scan cursor unknown to the node; rescanning the account's whole history");
      this.store.deleteState(key);
      return { sigs: await listSignatures(this.rpc, new PublicKey(account), undefined), since: null };
    }
  }

  /** Books every signature newer than the cursor, oldest first; true when it reached the newest one. */
  private async forward(w: Watch, budget: { left: number }): Promise<boolean> {
    const key = cursorKey(w.account);
    const { sigs, since } = await this.listSince(w.account, key);
    if (since === null && sigs.length > 0) {
      this.log.info({ launch: w.launch.address, account: w.account, signatures: sigs.length }, "indexing pump venue history");
    }
    return this.book(sigs.reverse(), budget, (sig) => this.store.setState(key, sig));
  }

  /** Books every successful signature since the previous reconcile that is not indexed yet; true when complete. */
  private async reconcile(w: Watch, budget: { left: number }): Promise<boolean> {
    const key = reconciledKey(w.account);
    const startedAt = this.now();
    const head = this.store.getState(cursorKey(w.account));
    const { sigs } = await this.listSince(w.account, key);
    const missing = sigs.filter((s) => !s.err && !this.store.hasTx(s.signature)).reverse();
    if (missing.length > 0) {
      this.log.warn({ launch: w.launch.address, account: w.account, missing: missing.length, scanned: sigs.length }, "pump reconcile found unindexed signatures");
    }
    if (!(await this.book(missing, budget, () => {}))) return false;
    const through = w.reconciledHead ?? head;
    if (through !== null) this.store.setState(key, through);
    w.reconciledAt = startedAt;
    w.reconciledHead = head;
    return true;
  }

  /**
   * Books `sigs` (oldest first) in order, calling `booked` after each one. Stops early — false — when a transaction is
   * not visible yet or the fetch budget is spent; a failed fetch throws. Nothing after the first unbooked signature is
   * marked booked, so a caller's cursor never skips one.
   */
  private async book(sigs: ConfirmedSignatureInfo[], budget: { left: number }, booked: (signature: string) => void): Promise<boolean> {
    const fetched = new Map<string, VersionedTransactionResponse | null>();
    for (let i = 0; i < sigs.length; i++) {
      const info = sigs[i]!;
      if (!info.err && !this.store.hasTx(info.signature)) {
        if (!fetched.has(info.signature)) {
          if (budget.left <= 0) return false;
          // This one and the next few unindexed ones, fetched together.
          const batch: string[] = [];
          for (let j = i; j < sigs.length && batch.length < Math.min(FETCH_CONCURRENCY, budget.left); j++) {
            if (!sigs[j]!.err && !this.store.hasTx(sigs[j]!.signature)) batch.push(sigs[j]!.signature);
          }
          budget.left -= batch.length;
          const txs = await Promise.all(
            batch.map((sig) => this.rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: MAX_TX_VERSION })),
          );
          batch.forEach((sig, j) => fetched.set(sig, txs[j]!));
        }
        const tx = fetched.get(info.signature);
        // Not visible yet: stop here and retry on the next poll.
        if (!tx) return false;
        if (!tx.meta?.err && !this.store.hasTx(info.signature)) await this.apply(info.signature, tx.slot, tx.meta?.logMessages ?? []);
      }
      booked(info.signature);
    }
    return true;
  }

  private targetOf(ev: PumpTradeEvent): Launch | undefined {
    return ev.mint !== null ? this.byMint.get(ev.mint) : this.byPool.get(ev.pool!);
  }

  private async apply(signature: string, slot: number, logs: string[]): Promise<void> {
    // The vault agent's pump trades go through this program, whose `Trade` event the program sync books.
    if (invokesProgram(logs, this.programId)) return;
    const events = decodePumpTrades(logs);
    const touched = new Map<string, Launch>();
    const fresh: number[] = [];
    let booked = 0;
    const liveSince = Math.floor(this.now() / 1000) - LIVE_EVENT_S;
    this.store.tx(() => {
      events.forEach((ev, i) => {
        const t = this.targetOf(ev);
        if (!t) return;
        const base = {
          signature,
          event_index: i,
          slot,
          timestamp: ev.timestamp,
          launch: t.address,
          is_buy: ev.isBuy ? 1 : 0,
          is_agent: 0,
          sol_amount: ev.solAmount.toString(),
          token_amount: ev.tokenAmount.toString(),
        };
        this.store.insertTrade({
          ...base,
          trader: ev.user,
          source: "pump",
          fee: ev.fee.toString(),
          price_sol: spotPrice(ev.reserves),
          ema_sol: null,
          vault_sol: null,
          vault_tokens: null,
          real_sol: ev.reserves.realSol.toString(),
          token_reserve: ev.reserves.tokenReserve.toString(),
          sol: lamportsToSol(ev.solAmount),
        });
        this.store.insertEvent({ ...base, type: "trade", actor: ev.user, ref: null });
        touched.set(t.address, t);
        booked += 1;
        // Backfilled history stays out of the live feeds (it would land on top of them as if it just happened).
        if (ev.timestamp >= liveSince) fresh.push(i);
      });
      this.store.markTx(signature, slot, false, booked);
    });
    for (const i of fresh) {
      const row = this.store.activityEvent(signature, i);
      if (row) this.hub.broadcast({ type: "event", event: activityFromRow(row) });
    }
    for (const t of touched.values()) {
      // Balances moved: the next holder read must hit the chain, not the cache.
      this.holders.invalidate(t.mint);
      this.opts.onTrade(t.address);
    }
  }
}
