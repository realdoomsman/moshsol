import { lamportsToSol, spotPrice, type LaunchJson } from "@holdfast/sdk";
import { PublicKey, type ConfirmedSignatureInfo, type Connection } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import { activityFromRow } from "./activity";
import { DEFAULT_PUBKEY, type Store } from "./db";
import type { Holders } from "./holders";
import type { Hub } from "./hub";
import type { LogsStream } from "./logs-stream";
import { decodePumpTrades, invokesProgram, type PumpTradeEvent } from "./pump-events";

export interface PumpSyncOptions {
  /** Newest signatures of a venue account to index when it is first watched (no cursor yet). */
  backfill: number;
  /** Re-reads the launch (price/market cap snapshot) after its public trades were booked. */
  onTrade(address: string): void;
}

/** A live pump launch and the venue account its public trades mention: the bonding curve, the PumpSwap pool once graduated. */
interface Target {
  address: string;
  mint: string;
  watch: string;
}

const SIG_PAGE = 1_000;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/**
 * `getTransaction` refuses transactions newer than the client's `maxSupportedTransactionVersion`; this is a ceiling,
 * not a format we decode (only `slot` and `meta.logMessages` are read). Public pump.fun trades already arrive as
 * version 1 transactions; pinning 0 would stall the cursor on the first one.
 */
export const MAX_TX_VERSION = 255;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Public pump.fun / PumpSwap trades of live pump launches, which never touch this program. Every live launch's venue
 * account is watched on the shared logs websocket (`mentions`) and its signatures are polled every poll tick with the
 * same cursor scheme as the program (`pump_cursor:<account>` in `sync_state`); a new account is backfilled from its
 * newest `backfill` signatures only. Transactions that also invoke this program are the vault agent's: the program's
 * `Trade` event books those, so they are skipped here. Any RPC failure (typically a 429) pauses polling with
 * exponential backoff (5 s → 5 min) instead of failing the program sync.
 */
export class PumpSync {
  /** Watched venue account → launch. */
  private readonly targets = new Map<string, Target>();
  private readonly byMint = new Map<string, Target>();
  private backoffUntil = 0;
  private failures = 0;

  constructor(
    private readonly store: Store,
    private readonly connection: Connection,
    private readonly hub: Hub,
    private readonly holders: Holders,
    private readonly stream: LogsStream,
    private readonly programId: string,
    private readonly log: FastifyBaseLogger,
    private readonly opts: PumpSyncOptions,
  ) {}

  /** Watches the venue account of every live pump launch and drops the others (ended, wound down, wiped). */
  syncTargets(): void {
    const next = new Map<string, Target>();
    for (const row of this.store.launches()) {
      if (row.venue !== "pump" || row.status !== "live" || row.mint === DEFAULT_PUBKEY) continue;
      const pump = (JSON.parse(row.snapshot) as LaunchJson).pump;
      const watch = pump.graduated ? pump.pool : pump.bondingCurve;
      next.set(watch, { address: row.address, mint: row.mint, watch });
    }
    for (const [watch, t] of this.targets) {
      if (next.has(watch)) continue;
      this.targets.delete(watch);
      this.byMint.delete(t.mint);
      this.stream.unwatch(watch);
      this.log.info({ launch: t.address, account: watch }, "stopped watching pump venue");
    }
    for (const [watch, t] of next) {
      if (this.targets.has(watch)) continue;
      this.targets.set(watch, t);
      this.byMint.set(t.mint, t);
      this.stream.watch(watch);
      this.log.info({ launch: t.address, mint: t.mint, account: watch }, "watching pump venue for public trades");
    }
  }

  /** One signature poll of every watched account (the first one of an account is its bounded backfill). */
  async poll(): Promise<void> {
    if (Date.now() < this.backoffUntil) return;
    for (const t of this.targets.values()) {
      try {
        await this.syncTarget(t);
      } catch (err) {
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.failures);
        this.failures += 1;
        this.backoffUntil = Date.now() + delay;
        this.log.warn({ launch: t.address, error: errorText(err), retryInMs: delay }, "pump trade poll failed; backing off");
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

  private async signaturesSince(account: PublicKey, until: string | undefined): Promise<ConfirmedSignatureInfo[]> {
    // No cursor yet: the bounded backfill (one page; the RPC caps a page at SIG_PAGE).
    if (!until) return this.connection.getSignaturesForAddress(account, { limit: Math.min(this.opts.backfill, SIG_PAGE) }, "confirmed");
    const found: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.connection.getSignaturesForAddress(account, { before, until, limit: SIG_PAGE }, "confirmed");
      found.push(...page);
      if (page.length < SIG_PAGE) return found;
      before = page[page.length - 1]!.signature;
    }
  }

  private async syncTarget(t: Target): Promise<void> {
    const key = `pump_cursor:${t.watch}`;
    const account = new PublicKey(t.watch);
    const cursor = this.store.getState(key) ?? undefined;
    let found: ConfirmedSignatureInfo[];
    try {
      found = await this.signaturesSince(account, cursor);
    } catch (err) {
      // The node no longer knows the cursor (pruned history): start over from the newest signatures.
      if (!cursor || !errorText(err).includes(cursor)) throw err;
      this.store.deleteState(key);
      found = await this.signaturesSince(account, undefined);
    }
    if (!cursor && found.length > 0) {
      this.log.info({ launch: t.address, account: t.watch, signatures: found.length }, "backfilling public pump trades");
    }
    for (const info of found.reverse()) {
      if (!info.err && !this.store.hasTx(info.signature)) {
        const tx = await this.connection.getTransaction(info.signature, { commitment: "confirmed", maxSupportedTransactionVersion: MAX_TX_VERSION });
        // Not visible yet: keep the cursor here and retry on the next poll.
        if (!tx) return;
        if (!tx.meta?.err) await this.apply(info.signature, tx.slot, tx.meta?.logMessages ?? []);
      }
      this.store.setState(key, info.signature);
    }
  }

  private targetOf(ev: PumpTradeEvent): Target | undefined {
    return ev.mint !== null ? this.byMint.get(ev.mint) : this.targets.get(ev.pool!);
  }

  private async apply(signature: string, slot: number, logs: string[]): Promise<void> {
    // The vault agent's pump trades go through this program, whose `Trade` event the program sync books.
    if (invokesProgram(logs, this.programId)) return;
    const events = decodePumpTrades(logs);
    const touched = new Map<string, Target>();
    const fresh: number[] = [];
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
        fresh.push(i);
      });
      this.store.markTx(signature, slot, false, fresh.length);
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
