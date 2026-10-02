import {
  TOTAL_SUPPLY,
  lamportsToSol,
  launchToJson,
  marketCapSol,
  q64ToSolPerToken,
  spotPrice,
  statusOf,
  venueOf,
  type LaunchAccount,
  type LaunchJson,
  type MoshClient,
  type MoshEvent,
  type PlatformAccount,
  type VenueState,
} from "@holdfast/sdk";
import { PublicKey, type ConfirmedSignatureInfo, type Connection } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import { activityFromRow } from "./activity";
import { DEFAULT_PUBKEY, type EventDbRow, type LaunchDbRow, type MetaUpdate, type Store } from "./db";
import type { HolderSet, HolderTarget, Holders } from "./holders";
import type { Hub } from "./hub";
import { LogsStream } from "./logs-stream";
import { UnfetchableUriError, loadMetadata } from "./metadata";
import type { SolPrice } from "./price";
import { MAX_TX_VERSION, PumpSync } from "./pump-sync";
import { summaryOf } from "./summaries";
import { loadVenueStates, type VenueTarget } from "./venue";

export interface SyncOptions {
  pollMs: number;
  fullRefreshMs: number;
  chainCheckMs: number;
  holdersTtlMs: number;
  publicUrl: string;
  filesDir: string;
  wsUrl: string;
  /** Newest venue signatures indexed when a live pump launch is first watched for public trades. */
  pumpBackfill: number;
}

export interface SyncHealth {
  ok: boolean;
  slot: number | null;
  lastIndexedSlot: number;
  lagSlots: number | null;
  wsConnected: boolean;
  genesisHash: string | null;
  error?: string;
}

const SIG_PAGE = 1_000;
const HEALTH_RPC_TIMEOUT_MS = 3_000;
/**
 * Metadata fetch retries: 5 s·2^n backoff capped at 30 min, 48 attempts ≈ 21 h. Fresh Arweave items can
 * take minutes (sometimes longer) before gateways serve them, and a gateway 404 must never be final.
 */
const META_MAX_ATTEMPTS = 48;
const META_BACKOFF_CAP_MS = 30 * 60_000;
const NO_META: MetaUpdate = {
  status: "none",
  name: null,
  symbol: null,
  description: null,
  image: null,
  twitter: null,
  telegram: null,
  website: null,
  whitelist: null,
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What the holder loader needs to know about a launch: pump launches hold SPL Token accounts and their
 * venue's own account is the bonding curve's ATA (the pool's base account once graduated).
 */
export function holderTarget(row: LaunchDbRow & { snapshot: string }): HolderTarget {
  const snap = JSON.parse(row.snapshot) as LaunchJson;
  return { address: row.address, mint: row.mint, venue: row.venue, graduated: snap.pump.graduated };
}

/** The venue read a launched pump launch needs for its price; null for Holdfast launches and unlaunched pump launches. */
function venueTargetOf(address: string, account: LaunchAccount): VenueTarget | null {
  if (venueOf(account) !== "pump" || account.mint.equals(PublicKey.default)) return null;
  return { address, mint: account.mint, graduated: account.pump.graduated };
}

/**
 * Chain → SQLite sync:
 * - signature backfill/poller (`getSignaturesForAddress` down to the persisted cursor, oldest→newest),
 * - live `logsSubscribe` over a reconnecting websocket, parsed straight from the logs,
 * - chain identity checks (genesis hash, program id, cursor still on chain) that wipe and re-index
 *   after a cluster reset,
 * - launch account snapshots after every touching event plus a periodic full refresh,
 * - metadata fetches and holder counts.
 * All transaction processing runs on one serial queue, so event rows are written in chain order
 * and (signature, eventIndex) idempotency makes replays harmless.
 */
export class ChainSync {
  platform: PlatformAccount | null = null;

  private queue: Promise<void> = Promise.resolve();
  private pollQueued = false;
  private timers: NodeJS.Timeout[] = [];
  private readonly stream: LogsStream;
  private readonly pump: PumpSync;
  private stopped = false;
  /** Chain identity confirmed since the last RPC failure / websocket reconnect; live logs wait for it. */
  private verified = false;
  private verifiedAt = 0;
  private genesisHash: string | null;
  private backfilled = false;
  private announceReset = false;
  /** Bumped by every wipe so in-flight account refreshes from before it are discarded. */
  private epoch = 0;
  /** Current sync outage: logged when it starts and when it ends, not on every retry. */
  private outage: { since: number; error: string } | null = null;
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly refreshAgain = new Set<string>();
  private readonly metaInflight = new Set<string>();
  private readonly connection: Connection;
  private readonly launchDisc: { offset: number; bytes: string };

  constructor(
    private readonly store: Store,
    private readonly client: MoshClient,
    private readonly hub: Hub,
    private readonly holders: Holders,
    private readonly price: SolPrice,
    private readonly log: FastifyBaseLogger,
    private readonly opts: SyncOptions,
  ) {
    this.connection = client.connection;
    this.launchDisc = client.program.coder.accounts.memcmp("launch") as { offset: number; bytes: string };
    this.genesisHash = store.getState("genesis");
    const programId = client.programId.toBase58();
    this.stream = new LogsStream(
      opts.wsUrl,
      {
        onLogs: (address, n) => {
          void this.enqueue(async () => {
            // Unverified: the DB may still belong to a previous chain; the pollers pick these up after the check.
            if (!this.verified || this.store.hasTx(n.signature)) return;
            if (address !== programId) {
              if (!n.err) await this.pump.onLogs(n.signature, n.slot, n.logs);
              return;
            }
            if (n.err) {
              this.store.markTx(n.signature, n.slot, true, 0);
              return;
            }
            await this.processTx(n.signature, n.slot, n.logs);
          });
        },
        onSubscribed: (address) => {
          // A program (re)subscription usually follows a validator restart: re-verify the chain and fill the gap now.
          if (address !== programId) return;
          this.verified = false;
          this.poll();
        },
      },
      log,
    );
    this.stream.watch(programId);
    this.pump = new PumpSync(store, this.connection, hub, holders, this.stream, programId, log, {
      backfill: opts.pumpBackfill,
      onTrade: (address) => void this.refreshLaunch(address),
    });
  }

  /** Highest slot through which every program transaction is indexed. */
  get lastIndexedSlot(): number {
    return Number(this.store.getState("last_slot") ?? 0);
  }

  /** Starts the logs stream, the poller (its first run is the backfill) and periodic account refreshes. */
  start(): void {
    this.log.info(
      { ...this.store.counts(), cursor: this.store.getState("cursor"), lastIndexedSlot: this.lastIndexedSlot },
      "resuming sync",
    );
    this.stream.start();
    this.poll();
    this.timers.push(
      setInterval(() => this.poll(), this.opts.pollMs),
      setInterval(() => void this.refreshAll(), this.opts.fullRefreshMs),
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.stream.close();
    await this.queue;
  }

  async health(): Promise<SyncHealth> {
    const lastIndexedSlot = this.lastIndexedSlot;
    const base = { lastIndexedSlot, wsConnected: this.stream.isSubscribed(this.client.programId.toBase58()), genesisHash: this.genesisHash };
    const { promise: timeout, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(() => reject(new Error(`no answer within ${HEALTH_RPC_TIMEOUT_MS}ms`)), HEALTH_RPC_TIMEOUT_MS);
    try {
      const slot = await Promise.race([this.connection.getSlot("confirmed"), timeout]);
      const ok = this.verified && this.backfilled;
      const error = ok ? undefined : this.outage ? `sync failing: ${this.outage.error}` : "initial sync in progress";
      return { ok, slot, lagSlots: Math.max(0, slot - lastIndexedSlot), ...base, ...(error ? { error } : {}) };
    } catch (err) {
      return { ok: false, slot: null, lagSlots: null, ...base, error: `rpc unreachable: ${errorText(err)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Serializes chain processing; a failing job is logged and never blocks later jobs. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.stopped) return;
      try {
        await job();
      } catch (err) {
        this.log.error({ err }, "sync job failed");
      }
    });
    this.queue = run;
    return run;
  }

  private poll(): void {
    if (this.pollQueued) return;
    this.pollQueued = true;
    void this.enqueue(async () => {
      this.pollQueued = false;
      try {
        if (!this.verified || Date.now() - this.verifiedAt >= this.opts.chainCheckMs) await this.verifyChain();
        // Everything confirmed up to `through` is returned by the scan below.
        const through = await this.connection.getSlot("confirmed");
        if (await this.syncSignatures()) {
          if (through > this.lastIndexedSlot) this.store.setState("last_slot", String(through));
        }
        if (!this.backfilled && !this.stopped) {
          await this.fullRefresh();
          this.backfilled = true;
          this.log.info({ ...this.store.counts(), lastIndexedSlot: this.lastIndexedSlot }, "backfill complete");
          if (this.announceReset) {
            this.announceReset = false;
            this.hub.broadcast({ type: "reset", genesisHash: this.genesisHash ?? "" });
          }
        }
        if (!this.stopped) {
          // Public pump.fun trades: the launch set may have changed (launched, graduated, wound down) since the last tick.
          this.pump.syncTargets();
          await this.pump.poll();
        }
        this.recovered();
      } catch (err) {
        this.failed(err);
      }
    });
  }

  private async refreshAll(): Promise<void> {
    if (!this.verified || !this.backfilled) return;
    try {
      await this.fullRefresh();
    } catch (err) {
      this.failed(err);
    }
  }

  /** Logs the first failure of an outage (and later changes of error at debug), then stays quiet until recovery. */
  private failed(err: unknown): void {
    this.verified = false;
    const error = errorText(err);
    if (!this.outage) {
      this.outage = { since: Date.now(), error };
      this.log.warn({ error }, "sync failing; retrying every poll");
    } else if (this.outage.error !== error) {
      this.outage.error = error;
      this.log.debug({ error }, "sync still failing");
    }
  }

  private recovered(): void {
    if (!this.outage) return;
    this.log.info({ downMs: Date.now() - this.outage.since, lastIndexedSlot: this.lastIndexedSlot }, "sync recovered");
    this.outage = null;
  }

  // ---------------- chain identity ----------------

  /**
   * Wipes and re-indexes when the DB belongs to another chain: genesis hash or program id changed
   * (e.g. `solana-test-validator --reset`), or the stored cursor is unknown to the node although it is
   * inside the node's retained history.
   */
  private async verifyChain(): Promise<void> {
    const genesis = await this.connection.getGenesisHash();
    const programId = this.client.programId.toBase58();
    const prevGenesis = this.store.getState("genesis");
    const prevProgram = this.store.getState("program_id");
    if (prevGenesis && prevGenesis !== genesis) this.reset("genesis hash changed", { prevGenesis, genesis });
    else if (prevProgram && prevProgram !== programId) this.reset("program id changed", { prevProgram, programId });
    else await this.reconcileCursor();
    this.store.setState("genesis", genesis);
    this.store.setState("program_id", programId);
    this.genesisHash = genesis;
    this.verified = true;
    this.verifiedAt = Date.now();
  }

  /**
   * The cursor must still exist on chain. Below the node's first available block it was merely pruned
   * (short localnet ledgers): drop it and rescan the retained history (deduped by signature). Inside
   * retained history but unknown means a different chain or a dropped fork: rebuild the index.
   */
  private async reconcileCursor(): Promise<void> {
    const cursor = this.store.getState("cursor");
    if (!cursor) return;
    const { value } = await this.connection.getSignatureStatuses([cursor], { searchTransactionHistory: true });
    if (value[0]) return;
    const cursorSlot = this.store.txSlot(cursor) ?? 0;
    const firstAvailable = await this.connection.getFirstAvailableBlock();
    if (cursorSlot < firstAvailable) {
      this.log.info({ cursorSlot, firstAvailable }, "cursor pruned from node history; rescanning retained history");
      this.store.deleteState("cursor");
    } else {
      this.reset("cursor signature not found on chain", { cursor, cursorSlot, firstAvailable });
    }
  }

  private reset(reason: string, details: Record<string, unknown>): void {
    this.log.warn({ reason, ...details, dropped: this.store.counts() }, "chain reset detected; wiping index and re-indexing");
    this.store.wipe();
    this.holders.clear();
    this.platform = null;
    this.epoch += 1;
    this.backfilled = false;
    this.announceReset = true;
  }

  // ---------------- signature backfill / poller ----------------

  private async signaturesSince(until: string | undefined): Promise<ConfirmedSignatureInfo[]> {
    const found: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.connection.getSignaturesForAddress(
        this.client.programId,
        { before, until, limit: SIG_PAGE },
        "confirmed",
      );
      found.push(...page);
      if (page.length < SIG_PAGE) return found;
      before = page[page.length - 1]!.signature;
    }
  }

  /** Indexes every program signature newer than the cursor; false if it stopped early (retry next poll). */
  private async syncSignatures(): Promise<boolean> {
    const cursor = this.store.getState("cursor") ?? undefined;
    let found: ConfirmedSignatureInfo[];
    try {
      found = await this.signaturesSince(cursor);
    } catch (err) {
      // The node rejects an `until` it no longer knows (pruned or different chain).
      if (!cursor || !errorText(err).includes(cursor)) throw err;
      await this.reconcileCursor();
      found = await this.signaturesSince(this.store.getState("cursor") ?? undefined);
    }
    if (found.length === 0) return true;

    let fetched = 0;
    for (const info of found.reverse()) {
      if (this.stopped) return false;
      if (!this.store.hasTx(info.signature)) {
        if (info.err) {
          this.store.markTx(info.signature, info.slot, true, 0);
        } else {
          const tx = await this.connection.getTransaction(info.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: MAX_TX_VERSION,
          });
          // Not visible yet: keep the cursor here and retry on the next poll.
          if (!tx) return false;
          fetched++;
          if (tx.meta?.err) this.store.markTx(info.signature, tx.slot, true, 0);
          else await this.processTx(info.signature, tx.slot, tx.meta?.logMessages ?? []);
        }
      }
      this.store.setState("cursor", info.signature);
    }
    // Small catch-ups are routine while the websocket is down; only real backfills are worth an info line.
    if (fetched >= 20) this.log.info({ fetched, scanned: found.length }, "signature sync caught up");
    else if (fetched > 0) this.log.debug({ fetched, scanned: found.length }, "signature sync caught up");
    return true;
  }

  // ---------------- transaction / event processing ----------------

  private async processTx(signature: string, slot: number, logs: string[]): Promise<void> {
    if (this.store.hasTx(signature)) return;
    let events: MoshEvent[];
    try {
      events = this.client.parseEvents(logs);
    } catch (err) {
      this.log.warn({ err, signature }, "failed to parse program logs");
      events = [];
    }

    const touched = new Set<string>();
    const fresh: number[] = [];
    const created: string[] = [];
    this.store.tx(() => {
      events.forEach((ev, i) => {
        const { launch, inserted } = this.applyEvent(signature, slot, i, ev);
        touched.add(launch);
        if (inserted) fresh.push(i);
        if (ev.name === "launchCreated") created.push(launch);
      });
      this.store.markTx(signature, slot, false, events.length);
      if (slot > this.lastIndexedSlot) this.store.setState("last_slot", String(slot));
    });

    // Launches unknown to the DB (e.g. history pruned) are discovered from their account first,
    // so activity events can carry mint/name/symbol.
    for (const address of touched) {
      if (!this.store.launch(address)) await this.refreshLaunch(address);
    }
    for (const i of fresh) {
      const row = this.store.activityEvent(signature, i);
      if (row) this.hub.broadcast({ type: "event", event: activityFromRow(row) });
    }
    for (const address of touched) void this.refreshLaunch(address);
    for (const address of created) void this.fetchMetadata(address);
  }

  /** Writes one decoded event; returns the launch it touched and whether an activity row was new. */
  private applyEvent(signature: string, slot: number, index: number, ev: MoshEvent): { launch: string; inserted: boolean } {
    const d = ev.data;
    const launch = d.launch.toBase58();
    const base = {
      signature,
      event_index: index,
      slot,
      timestamp: Number(d.timestamp.toString()),
      launch,
      is_agent: null,
      is_buy: null,
      token_amount: null,
      ref: null,
    };
    const activity = (row: Pick<EventDbRow, "type" | "actor" | "sol_amount"> & Partial<EventDbRow>) =>
      this.store.insertEvent({ ...base, ...row });

    switch (ev.name) {
      case "launchCreated": {
        const e = ev.data;
        // A pump launch has no mint until `launch_pump`: its event carries the default pubkey.
        const mint = e.mint.toBase58();
        this.store.upsertCreatedLaunch({
          address: launch,
          mint,
          venue: mint === DEFAULT_PUBKEY ? "pump" : "holdfast",
          creator: e.creator.toBase58(),
          idx: Number(e.index.toString()),
          status: "raising",
          created_at: base.timestamp,
          name: e.name,
          symbol: e.symbol,
          uri: e.uri,
          meta_status: "pending",
        });
        return { launch, inserted: activity({ type: "launch_created", actor: e.creator.toBase58(), sol_amount: null }) };
      }
      case "deposited": {
        const e = ev.data;
        this.store.insertDeposit({
          signature,
          event_index: index,
          slot,
          timestamp: base.timestamp,
          launch,
          backer: e.backer.toBase58(),
          amount: e.amount.toString(),
          raised: e.raised.toString(),
        });
        return {
          launch,
          inserted: activity({ type: "deposit", actor: e.backer.toBase58(), sol_amount: e.amount.toString() }),
        };
      }
      case "launched": {
        const e = ev.data;
        // Holdfast: the curve price after the bundle buy. Pump: the bonding curve's price after it.
        const price = q64ToSolPerToken(BigInt(e.priceQ64.toString()));
        this.store.setLaunched(launch, e.mint.toBase58(), price, base.timestamp, lamportsToSol(e.bundleSol.toString()));
        return {
          launch,
          inserted: activity({
            type: "launched",
            actor: null,
            sol_amount: e.raised.toString(),
            token_amount: e.bundleTokens.toString(),
          }),
        };
      }
      case "trade": {
        const e = ev.data;
        this.store.insertTrade({
          signature,
          event_index: index,
          slot,
          timestamp: base.timestamp,
          launch,
          trader: e.trader.toBase58(),
          is_buy: e.isBuy ? 1 : 0,
          is_agent: e.isAgent ? 1 : 0,
          source: "holdfast",
          sol_amount: e.solAmount.toString(),
          token_amount: e.tokenAmount.toString(),
          fee: e.fee.toString(),
          price_sol: q64ToSolPerToken(BigInt(e.priceQ64.toString())),
          ema_sol: q64ToSolPerToken(BigInt(e.emaQ64.toString())),
          vault_sol: e.vaultSol.toString(),
          vault_tokens: e.vaultTokens.toString(),
          real_sol: e.realSol.toString(),
          token_reserve: e.tokenReserve.toString(),
          sol: lamportsToSol(e.solAmount.toString()),
        });
        return {
          launch,
          inserted: activity({
            type: "trade",
            actor: e.trader.toBase58(),
            is_agent: e.isAgent ? 1 : 0,
            is_buy: e.isBuy ? 1 : 0,
            sol_amount: e.solAmount.toString(),
            token_amount: e.tokenAmount.toString(),
          }),
        };
      }
      case "refunded":
        return {
          launch,
          inserted: activity({ type: "refund", actor: ev.data.backer.toBase58(), sol_amount: ev.data.amount.toString() }),
        };
      case "launchCancelled":
        return { launch, inserted: activity({ type: "cancelled", actor: null, sol_amount: null }) };
      case "backerFeesClaimed":
        return {
          launch,
          inserted: activity({
            type: "backer_claim",
            actor: ev.data.backer.toBase58(),
            sol_amount: ev.data.amount.toString(),
          }),
        };
      case "creatorFeesClaimed":
        return {
          launch,
          inserted: activity({
            type: "creator_claim",
            actor: ev.data.creator.toBase58(),
            sol_amount: ev.data.amount.toString(),
          }),
        };
      case "platformFeesSwept":
        // Not part of the public activity feed; the launch snapshot refresh reflects it.
        return { launch, inserted: false };
      case "backersPaid":
        // `payout_backers` (agent authority): the principal (`kind` 0) or a dividend (`kind` 1) credited to backers.
        return {
          launch,
          inserted: activity({
            type: "backers_paid",
            actor: null,
            sol_amount: ev.data.amount.toString(),
            ref: ev.data.kind === 0 ? "principal" : "dividend",
          }),
        };
      case "woundDown":
        return {
          launch,
          inserted: activity({
            type: "wound_down",
            actor: null,
            sol_amount: ev.data.solToBackers.toString(),
            token_amount: ev.data.tokensReturned.toString(),
          }),
        };
      case "vaultWithdrawn":
        return {
          launch,
          inserted: activity({
            type: "vault_withdrawn",
            actor: ev.data.recipient.toBase58(),
            sol_amount: ev.data.sol.toString(),
            token_amount: ev.data.tokens.toString(),
          }),
        };
      case "vaultWithdrawnByDev":
        // `dev_withdraw_vault`: the platform's dev key withdrew to its own wallet. Same row as the admin's
        // withdrawal (so the vault sums include it), `actor` = the dev key, tagged `ref` "dev".
        return {
          launch,
          inserted: activity({
            type: "vault_withdrawn",
            actor: ev.data.by.toBase58(),
            sol_amount: ev.data.sol.toString(),
            token_amount: ev.data.tokens.toString(),
            ref: "dev",
          }),
        };
      case "creatorFeesCollected":
        // `collect_pump_fees`: pump.fun / PumpSwap creator fees swept into the launch and split by the frozen terms
        // (vault SOL / buyback pool / backers).
        return {
          launch,
          inserted: activity({ type: "creator_fees_collected", actor: null, sol_amount: ev.data.amount.toString() }),
        };
      case "buybackBurned":
        return {
          launch,
          inserted: activity({
            type: "buyback_burned",
            actor: null,
            sol_amount: ev.data.sol.toString(),
            token_amount: ev.data.tokens.toString(),
            ref: ev.data.buybackMint.toBase58(),
          }),
        };
      case "pumpGraduated":
        return { launch, inserted: activity({ type: "graduated", actor: null, sol_amount: null, ref: ev.data.pool.toBase58() }) };
      case "launchMigrated":
        // The admin's one-time layout migration after the program upgrade.
        return { launch, inserted: activity({ type: "migrated", actor: null, sol_amount: null }) };
    }
  }

  // ---------------- launch snapshots ----------------

  /**
   * Refetches one launch account. Coalesced per launch: while a fetch is in flight, further requests
   * schedule exactly one re-fetch, so bursts of trades cost at most two RPC calls.
   */
  refreshLaunch(address: string): Promise<void> {
    const running = this.refreshing.get(address);
    if (running) {
      this.refreshAgain.add(address);
      return running;
    }
    const p = (async () => {
      try {
        do {
          this.refreshAgain.delete(address);
          const key = new PublicKey(address);
          const epoch = this.epoch;
          const res = await this.client.program.account.launch.fetchNullableAndContext(key, "confirmed");
          if (!res.data) continue;
          const target = venueTargetOf(address, res.data);
          const venue = target ? (await loadVenueStates(this.connection, [target])).get(address) : undefined;
          await this.applySnapshot(key, res.data, res.context.slot, epoch, venue);
        } while (this.refreshAgain.has(address) && !this.stopped);
      } catch (err) {
        this.log.warn({ address, error: errorText(err) }, "launch refresh failed");
      } finally {
        this.refreshing.delete(address);
      }
    })();
    this.refreshing.set(address, p);
    return p;
  }

  /**
   * Upserts a snapshot if it is at least as new as the stored one; broadcasts on change. Dropped when
   * the index was wiped (`epoch` moved) after the account was fetched. `venue` is a launched pump
   * launch's current reserves (null when its venue account is missing): they replace the snapshot's
   * `priceSol` / `marketCapSol`, which the account itself can't know.
   */
  private async applySnapshot(
    key: PublicKey,
    account: LaunchAccount,
    slot: number,
    epoch: number,
    venue: VenueState | null | undefined,
  ): Promise<void> {
    if (epoch !== this.epoch) return;
    const address = key.toBase58();
    const pump = venueOf(account) === "pump";
    if (!this.store.launch(address)) {
      // Discovered from the account (its `launchCreated` is not in our history). Pump launches carry their
      // name/symbol/uri; Holdfast launches keep them on the mint's Token-2022 metadata.
      const meta = pump
        ? { name: account.name, symbol: account.symbol, uri: account.uri }
        : await this.client.fetchTokenMeta(account.mint).catch((err: unknown) => {
            this.log.warn({ err, address }, "token metadata fetch failed");
            return null;
          });
      if (epoch !== this.epoch) return;
      this.store.insertLaunch({
        address,
        mint: account.mint.toBase58(),
        venue: pump ? "pump" : "holdfast",
        creator: account.creator.toBase58(),
        idx: Number(account.index.toString()),
        status: statusOf(account),
        created_at: Number(account.createdAt.toString()),
        name: meta?.name ?? "",
        symbol: meta?.symbol ?? "",
        uri: meta?.uri ?? "",
        meta_status: meta?.uri ? "pending" : "none",
      });
      this.log.info({ address, mint: account.mint.toBase58() }, "discovered launch from account");
      if (meta?.uri) void this.fetchMetadata(address);
    }
    const row = this.store.launch(address)!;
    if (slot < row.snapshot_slot) return;

    const json = launchToJson(key, account);
    if (pump) {
      // Live reserves price the venue. A completed curve (pump.fun withdrew it, `graduate_pump` not run yet)
      // or a missing account has nothing to quote: keep the last price we saw rather than dropping to 0.
      if (venue && venue.curve.tokenReserve > 0n) {
        json.priceSol = spotPrice(venue.curve);
        json.marketCapSol = marketCapSol(venue.curve);
      } else if (row.snapshot) {
        const prev = JSON.parse(row.snapshot) as LaunchJson;
        json.priceSol = prev.priceSol;
        json.marketCapSol = prev.marketCapSol;
      }
    }
    if ((json.status === "live" || json.status === "woundDown") && row.launch_price === null) {
      // Missed the `launched` event. Holdfast: the bundle is the curve's first buy, so its post-trade price is
      // exact. Pump: the venue has traded since; its current price is the best reference left.
      const price = pump
        ? json.priceSol
        : spotPrice({
            virtualSol: BigInt(json.virtualSol),
            realSol: BigInt(json.bundleSol),
            tokenReserve: TOTAL_SUPPLY - BigInt(json.bundleTokens),
          });
      if (price > 0) this.store.setLaunched(address, json.mint, price, json.launchedAt, Number(json.bundleSol) / 1e9);
    }
    const snapshot = JSON.stringify(json);
    if (snapshot === row.snapshot) {
      this.store.setSnapshotSlot(address, slot);
      return;
    }
    this.store.setSnapshot({
      address,
      snapshot,
      slot,
      status: json.status,
      mint: json.mint,
      venue: json.venue,
      pumpMeta: pump ? { name: json.name, symbol: json.symbol, uri: json.uri } : null,
    });
    this.broadcastLaunch(address);
  }

  broadcastLaunch(address: string): void {
    const launch = summaryOf(this.store, this.price, this.store.launch(address));
    if (launch) this.hub.broadcast({ type: "launch", launch });
  }

  /**
   * All launch accounts in one getProgramAccounts call, the venue reserves of every launched pump launch in
   * getMultipleAccountsInfo batches, then platform, metadata retries and holder counts.
   */
  private async fullRefresh(): Promise<void> {
    const epoch = this.epoch;
    const res = await this.connection.getProgramAccounts(this.client.programId, {
      commitment: "confirmed",
      withContext: true,
      filters: [{ memcmp: this.launchDisc }],
    });
    const decoded = res.value.map(({ pubkey, account }) => ({
      pubkey,
      account: this.client.program.coder.accounts.decode<LaunchAccount>("launch", account.data),
    }));
    const targets = decoded.flatMap(({ pubkey, account }) => venueTargetOf(pubkey.toBase58(), account) ?? []);
    const venues = await loadVenueStates(this.connection, targets);
    for (const { pubkey, account } of decoded) {
      await this.applySnapshot(pubkey, account, res.context.slot, epoch, venues.get(pubkey.toBase58()));
    }
    this.platform = await this.client.fetchPlatform();
    for (const row of this.store.launchesWithMetaDue(Date.now(), META_MAX_ATTEMPTS)) void this.fetchMetadata(row.address);
    await this.refreshHolderCounts();
  }

  private async refreshHolderCounts(): Promise<void> {
    const now = Date.now();
    const aggs = this.store.tradeAggregates(Math.floor(now / 1000));
    for (const row of this.store.launches()) {
      // Only live launches have outside holders (a raising pump launch has no mint at all).
      if (row.status !== "live") continue;
      const lastTradeMs = (aggs.get(row.address)?.last_ts ?? row.launch_ts ?? 0) * 1000;
      const fresh = now - row.holders_at < this.opts.holdersTtlMs || lastTradeMs < row.holders_at;
      // top_holder_pct is null on rows loaded before that column existed: refresh them once.
      if (row.holders_at !== 0 && row.top_holder_pct !== null && fresh) continue;
      // Holder counts are best-effort decoration; an RPC hiccup here must never fail the sync loop.
      await this.updateHolders(holderTarget(row)).catch((err: unknown) => {
        this.log.warn({ mint: row.mint, error: String((err as Error)?.message ?? err) }, "holders refresh failed");
      });
    }
  }

  /** Loads holders for a launch (30s cache) and persists count + top holder share; broadcasts when either changed. */
  async updateHolders(target: HolderTarget): Promise<HolderSet> {
    const set = await this.holders.get(target);
    const row = this.store.launch(target.address);
    if (!row || row.holders_at >= set.at) return set;
    this.store.setHolders(target.address, set.count, set.topPct, set.at);
    if (row.holders !== set.count || row.top_holder_pct !== set.topPct) this.broadcastLaunch(target.address);
    return set;
  }

  // ---------------- metadata ----------------

  private async fetchMetadata(address: string): Promise<void> {
    if (this.metaInflight.has(address)) return;
    const row = this.store.launch(address);
    if (!row) return;
    this.metaInflight.add(address);
    try {
      if (!row.uri) {
        this.store.setMeta(address, NO_META);
        return;
      }
      const meta = await loadMetadata(row.uri, this.opts.publicUrl, this.opts.filesDir);
      this.store.setMeta(address, meta);
      this.broadcastLaunch(address);
    } catch (err) {
      if (err instanceof UnfetchableUriError) {
        this.log.warn({ address, uri: row.uri, reason: err.message }, "metadata not fetchable; using on-chain name");
        this.store.setMeta(address, NO_META);
      } else {
        const attempt = row.meta_attempts + 1;
        this.log.warn({ address, uri: row.uri, attempt, err: String(err) }, "metadata fetch failed");
        this.store.setMetaError(address, Date.now() + Math.min(META_BACKOFF_CAP_MS, 5_000 * 2 ** attempt));
        if (attempt >= META_MAX_ATTEMPTS) this.log.warn({ address }, "giving up on metadata");
      }
    } finally {
      this.metaInflight.delete(address);
    }
  }
}
