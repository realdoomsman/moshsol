import {
  TOTAL_SUPPLY,
  lamportsToSol,
  launchToJson,
  q64ToSolPerToken,
  spotPrice,
  statusOf,
  type LaunchAccount,
  type MoshClient,
  type MoshEvent,
  type PlatformAccount,
} from "@moshsol/sdk";
import { PublicKey, type ConfirmedSignatureInfo, type Connection } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import type { ActivityDbRow, EventDbRow, MetaUpdate, Store } from "./db";
import type { HolderSet, Holders } from "./holders";
import type { Hub } from "./hub";
import { UnfetchableUriError, loadMetadata } from "./metadata";
import { summaryOf } from "./summaries";
import type { ActivityEvent } from "./types";

export interface SyncOptions {
  pollMs: number;
  fullRefreshMs: number;
  holdersTtlMs: number;
  publicUrl: string;
  filesDir: string;
}

const SIG_PAGE = 1_000;
const META_MAX_ATTEMPTS = 5;
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

export function activityFromRow(r: ActivityDbRow): ActivityEvent {
  const ev: ActivityEvent = {
    id: `${r.signature}:${r.event_index}`,
    type: r.type,
    signature: r.signature,
    timestamp: r.timestamp,
    mint: r.mint,
    symbol: r.symbol,
    name: r.name,
    image: r.image,
    actor: r.actor,
  };
  if (r.is_agent !== null) ev.isAgent = r.is_agent === 1;
  if (r.is_buy !== null) ev.isBuy = r.is_buy === 1;
  if (r.sol_amount !== null) ev.solAmount = r.sol_amount;
  if (r.token_amount !== null) ev.tokenAmount = r.token_amount;
  return ev;
}

/**
 * Chain → SQLite sync:
 * - signature backfill/poller (`getSignaturesForAddress` down to the persisted cursor, oldest→newest),
 * - live `onLogs` at `confirmed`, parsed straight from the logs,
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
  private logsSub: number | null = null;
  private stopped = false;
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
    private readonly log: FastifyBaseLogger,
    private readonly opts: SyncOptions,
  ) {
    this.connection = client.connection;
    this.launchDisc = client.program.coder.accounts.memcmp("launch") as { offset: number; bytes: string };
  }

  get lastIndexedSlot(): number {
    return Number(this.store.getState("last_slot") ?? 0);
  }

  async start(): Promise<void> {
    const genesis = await this.connection.getGenesisHash();
    const programId = this.client.programId.toBase58();
    const prevGenesis = this.store.getState("genesis");
    const prevProgram = this.store.getState("program_id");
    if ((prevGenesis && prevGenesis !== genesis) || (prevProgram && prevProgram !== programId)) {
      this.log.warn({ prevGenesis, genesis, prevProgram, programId }, "cluster or program changed; wiping index");
      this.store.wipe();
    }
    this.store.setState("genesis", genesis);
    this.store.setState("program_id", programId);

    const counts = this.store.counts();
    this.log.info({ ...counts, cursor: this.store.getState("cursor") }, "resuming sync");

    // Backfill first; live notifications queue behind it and dedupe by signature.
    const backfill = this.enqueue(() => this.syncSignatures());
    this.logsSub = this.connection.onLogs(
      this.client.programId,
      (logs, ctx) => {
        void this.enqueue(async () => {
          if (this.store.hasTx(logs.signature)) return;
          if (logs.err) {
            this.store.markTx(logs.signature, ctx.slot, true, 0);
            return;
          }
          await this.processTx(logs.signature, ctx.slot, logs.logs);
        });
      },
      "confirmed",
    );
    await backfill;
    await this.fullRefresh().catch((err: unknown) => this.log.error({ err }, "initial full refresh failed"));
    this.log.info(this.store.counts(), "backfill complete");

    this.timers.push(
      setInterval(() => this.poll(), this.opts.pollMs),
      setInterval(() => {
        this.fullRefresh().catch((err: unknown) => this.log.error({ err }, "full refresh failed"));
      }, this.opts.fullRefreshMs),
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.logsSub !== null) {
      await this.connection.removeOnLogsListener(this.logsSub).catch(() => undefined);
      this.logsSub = null;
    }
    await this.queue;
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
      await this.syncSignatures();
    });
  }

  // ---------------- signature backfill / poller ----------------

  private async syncSignatures(): Promise<void> {
    const cursor = this.store.getState("cursor") ?? undefined;
    const found: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.connection.getSignaturesForAddress(
        this.client.programId,
        { before, until: cursor, limit: SIG_PAGE },
        "confirmed",
      );
      found.push(...page);
      if (page.length < SIG_PAGE) break;
      before = page[page.length - 1]!.signature;
    }
    if (found.length === 0) return;

    let fetched = 0;
    for (const info of found.reverse()) {
      if (!this.store.hasTx(info.signature)) {
        if (info.err) {
          this.store.markTx(info.signature, info.slot, true, 0);
        } else {
          const tx = await this.connection.getTransaction(info.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          // Not visible yet: keep the cursor here and retry on the next poll.
          if (!tx) return;
          fetched++;
          if (tx.meta?.err) this.store.markTx(info.signature, tx.slot, true, 0);
          else await this.processTx(info.signature, tx.slot, tx.meta?.logMessages ?? []);
        }
      }
      this.store.setState("cursor", info.signature);
    }
    if (fetched > 0) this.log.info({ fetched, scanned: found.length }, "signature sync caught up");
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
    };
    const activity = (row: Pick<EventDbRow, "type" | "actor" | "sol_amount"> & Partial<EventDbRow>) =>
      this.store.insertEvent({ ...base, ...row });

    switch (ev.name) {
      case "launchCreated": {
        const e = ev.data;
        this.store.upsertCreatedLaunch({
          address: launch,
          mint: e.mint.toBase58(),
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
        const price = q64ToSolPerToken(BigInt(e.priceQ64.toString()));
        this.store.setLaunched(launch, price, base.timestamp, lamportsToSol(e.bundleSol.toString()));
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
          const res = await this.client.program.account.launch.fetchNullableAndContext(key, "confirmed");
          if (res.data) await this.applySnapshot(key, res.data, res.context.slot);
        } while (this.refreshAgain.has(address) && !this.stopped);
      } catch (err) {
        this.log.error({ err, address }, "launch refresh failed");
      } finally {
        this.refreshing.delete(address);
      }
    })();
    this.refreshing.set(address, p);
    return p;
  }

  /** Upserts a snapshot if it is at least as new as the stored one; broadcasts on change. */
  private async applySnapshot(key: PublicKey, account: LaunchAccount, slot: number): Promise<void> {
    const address = key.toBase58();
    if (!this.store.launch(address)) {
      // Discovered from the account (its `launchCreated` is not in our history): use on-mint metadata.
      const meta = await this.client.fetchTokenMeta(account.mint).catch((err: unknown) => {
        this.log.warn({ err, address }, "token metadata fetch failed");
        return null;
      });
      this.store.insertLaunch({
        address,
        mint: account.mint.toBase58(),
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
    if (json.status === "live" && row.launch_price === null) {
      // Missed the `launched` event: the bundle is the curve's first buy, so its post-trade price is exact.
      const price = spotPrice({
        virtualSol: BigInt(json.virtualSol),
        realSol: BigInt(json.bundleSol),
        tokenReserve: TOTAL_SUPPLY - BigInt(json.bundleTokens),
      });
      this.store.setLaunched(address, price, json.launchedAt, Number(json.bundleSol) / 1e9);
    }
    const snapshot = JSON.stringify(json);
    if (snapshot === row.snapshot) {
      this.store.setSnapshotSlot(address, slot);
      return;
    }
    this.store.setSnapshot(address, snapshot, slot, json.status);
    this.broadcastLaunch(address);
  }

  broadcastLaunch(address: string): void {
    const launch = summaryOf(this.store, this.store.launch(address));
    if (launch) this.hub.broadcast({ type: "launch", launch });
  }

  /** All launch accounts in one getProgramAccounts call, plus platform, metadata retries and holder counts. */
  private async fullRefresh(): Promise<void> {
    const res = await this.connection.getProgramAccounts(this.client.programId, {
      commitment: "confirmed",
      withContext: true,
      filters: [{ memcmp: this.launchDisc }],
    });
    for (const { pubkey, account } of res.value) {
      const decoded = this.client.program.coder.accounts.decode<LaunchAccount>("launch", account.data);
      await this.applySnapshot(pubkey, decoded, res.context.slot);
    }
    this.platform = await this.client.fetchPlatform();
    for (const row of this.store.launchesWithMetaDue(Date.now(), META_MAX_ATTEMPTS)) void this.fetchMetadata(row.address);
    await this.refreshHolderCounts();
  }

  private async refreshHolderCounts(): Promise<void> {
    const now = Date.now();
    const aggs = this.store.tradeAggregates(Math.floor(now / 1000));
    for (const row of this.store.launches()) {
      if (row.status !== "live") continue;
      const lastTradeMs = (aggs.get(row.address)?.last_ts ?? row.launch_ts ?? 0) * 1000;
      const fresh = now - row.holders_at < this.opts.holdersTtlMs || lastTradeMs < row.holders_at;
      if (row.holders_at !== 0 && fresh) continue;
      await this.updateHolders(row.mint, row.address);
    }
  }

  /** Loads holders for a launch (30s cache) and persists the count; broadcasts when it changed. */
  async updateHolders(mint: string, address: string): Promise<HolderSet> {
    const set = await this.holders.get(mint, address);
    const row = this.store.launch(address);
    if (!row || row.holders_at >= set.at) return set;
    this.store.setHolders(address, set.count, set.at);
    if (row.holders !== set.count) this.broadcastLaunch(address);
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
        this.store.setMetaError(address, Date.now() + Math.min(300_000, 5_000 * 2 ** attempt));
        if (attempt >= META_MAX_ATTEMPTS) this.log.warn({ address }, "giving up on metadata");
      }
    } finally {
      this.metaInflight.delete(address);
    }
  }
}
