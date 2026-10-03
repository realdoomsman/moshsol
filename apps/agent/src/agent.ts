import { LAMPORTS_PER_SOL, SystemProgram, SYSVAR_CLOCK_PUBKEY, TransactionInstruction, type Commitment, type Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  TransactionExpiredError,
  TransactionFailedError,
  agentExecutorsOf,
  describeError,
  launchToJson,
  platformPda,
  pumpRefOf,
  q64ToSolPerToken,
  type LaunchAccount,
  type LaunchJson,
  type MoshClient,
  type PlatformAccount,
} from "@holdfast/sdk";
import type { ActivityItem, ActivityLog } from "./activity";
import { LookupTable } from "./alt";
import { TradeBackoff } from "./backoff";
import type { AgentConfig } from "./config";
import { Cranks, type CrankLaunch } from "./cranks";
import { FlowWindow, NEUTRAL_FLOW, displayFlow, type FlowFeatures } from "./flow";
import { ExecutorPool, loadExecutors } from "./executors";
import { log } from "./log";
import { Metrics } from "./metrics";
import { StalePlanError, TradeSender, landed, sendIxs } from "./send";
import { PublicVolume } from "./public-volume";
import type { Decision, StatusSnapshot } from "./status";
import {
  displayPrices,
  evaluate,
  marketOf,
  planRejection,
  project,
  type DisplayPrices,
  type Evaluation,
  type MarketState,
  type StrategyParams,
  type TradePlan,
  type Sizing,
} from "./strategy";
import { Stream, type AccountUpdate } from "./stream";
import { decodeVenue, poolKeys, venueKeys } from "./venue";

/** Byte offset of `Launch.status`: discriminator(8) + index u64(8) + creator(32) + mint(32). */
const LAUNCH_STATUS_OFFSET = 80;
/** base58 of the single byte 0x01 = `LaunchStatus::Live`. */
const LIVE_STATUS_BS58 = "2";
/** Upper bound on the whole-loop retry delay after RPC failures. */
const MAX_TICK_BACKOFF_MS = 60_000;
/** Below this the agent cannot keep paying transaction fees for long. */
const LOW_BALANCE_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
/**
 * Agent-key balance agent-wallet top-ups never touch: its fee floor plus the rent and fees of the permissionless
 * cranks only it runs (collect_pump_fees fronts ~0.002 SOL of WSOL rent, a lookup table ~0.005 SOL, wind-down,
 * buy-back and payout each a fee at up to ~0.0004 SOL of priority).
 */
const AGENT_RESERVE_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
/** `getMultipleAccountsInfo` accepts at most this many keys per call. */
const MAX_BATCH_KEYS = 100;
/** Graduation: the pool is re-read and `graduate_pump` retried this often until the launch records the pool. */
const GRADUATE_RETRY_MS = 1_000;
/** Failed `graduate_pump` sends (with the pool there) retried at GRADUATE_RETRY_MS before the retries back off to `crankMs`. */
const GRADUATE_FAST_TRIES = 10;
/**
 * pump.fun migrates within a slot or two; when its pool is still missing this long after completion the reads slow
 * to the heartbeat's pace (the stream still reports the pool's creation at once).
 */
const GRADUATE_FAST_WINDOW_MS = 120_000;
/** After a landed trade, how long the stream gets to deliver the launch with that fill before the next plan re-reads instead. */
const FILL_WAIT_MS = 5_000;
/** Stream commitment: a change is acted on in the slot it is first reported (the program re-checks every rule at execution). */
const STREAM_COMMITMENT: Commitment = "processed";
/** `agent_*_pump` data: the Anchor discriminator (sha256("global:<name>")[..8]), then two u64 (amount in, minimum out). */
const AGENT_BUY_PUMP = createHash("sha256").update("global:agent_buy_pump").digest().subarray(0, 8);
const AGENT_SELL_PUMP = createHash("sha256").update("global:agent_sell_pump").digest().subarray(0, 8);

/**
 * What set a decision off: a stream notification (with the slot the change landed in), the heartbeat poll, or a wake-up
 * the agent scheduled itself (a cooldown or back-off ran out, graduation made the pool tradable).
 */
interface Trigger {
  source: "stream" | "poll" | "wake";
  /** Wall-clock ms the agent first saw the change (notification arrival, the poll's read, the wake-up). */
  seenAt: number;
  slot?: number;
  /** Wall-clock ms the RPC node first reported `slot` (≈ when the change became visible on chain). */
  landAt?: number;
}

interface LaunchRuntime {
  key: string;
  address: PublicKey;
  symbol?: string;
  account: LaunchAccount;
  json: LaunchJson;
  /** Slot the launch account was read at or changed in; older reads never overwrite newer state. */
  launchSlot: number;
  /**
   * Slot of the newest change seen in the launch's state: a streamed update, or a read whose data differed from what
   * was known (a read of unchanged state is no change). A program rejection's back-off ends with a later one.
   */
  changeSlot: number;
  /** Venue accounts of a pump launch (`venueKeys`): what `decodeVenue` reads, in order. */
  venueKeys: PublicKey[];
  /** Once the curve completed (until the launch records the pool): the canonical pool's accounts, watched ahead. */
  poolKeys: PublicKey[];
  /** Data of every watched venue / pool account (null = missing) and the slot it was read at, by base58 address. */
  accounts: Map<string, { data: Buffer | null; slot: number }>;
  /** Stream subscription per watched address (the launch, its venue and pool accounts). */
  subs: Map<string, number>;
  /** Stream epoch whose data a re-read confirmed; another epoch (or new subscriptions) = re-read before sending. */
  verifiedEpoch: number;
  /** Wall-clock ms before which no trade is sent, either side (cooldown after a landed trade). */
  cooldownUntil: number;
  /** Error back-off, per side (a failing buy never holds a sell back). */
  backoff: TradeBackoff;
  /** Kind of the last logged decision; repeated holds/skips of the same kind are not re-logged. */
  loggedKind?: string;
  /** Public flow from the Launch / venue deltas: every stream update and every heartbeat. */
  flow: FlowWindow;
  /** Held by whatever may send for this launch (a decision, the wind-down): one in-flight trade per launch. */
  busy: boolean;
  /** Earliest change not yet decided on, and the debounce timer that will. */
  trigger: Trigger | null;
  timer: NodeJS.Timeout | null;
  /** A wake-up the agent scheduled (a cooldown or back-off running out) and when it fires. */
  wake: { timer: NodeJS.Timeout; at: number } | null;
  /** After a landed trade: `agent_buys + agent_sells` the launch must show before the next plan, and until when to wait. */
  fill: { count: number; until: number } | null;
  /** `agent_buy_pump` built by the SDK at the last heartbeat (accounts incl. the venue's live fee recipients), for agent wallet `executor` (null = the pump authority trades). */
  template: { ix: TransactionInstruction; graduated: boolean; executor: PublicKey | null } | null;
  /** The curve completed: since when, and the running graduation loop's nudge (pool created → retry at once). */
  graduation: { completeAt: number; running: boolean; nudge: (() => void) | null } | null;
}

/** When the final decision was made and the timing facts recorded with it. */
interface Decided {
  at: number;
  detail: Record<string, number | string | boolean>;
}

function clockUnixTs(data: Buffer): bigint {
  // Clock sysvar: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64.
  return data.readBigInt64LE(32);
}

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * The vault agent's loop. With the stream (`SUBSCRIBE`), every live launch's Launch account and venue accounts
 * (bonding curve, or the PumpSwap pool's token accounts) are subscribed at `processed`: an update is folded into
 * the launch's state and flow window at once and decided on DEBOUNCE_MS later, on the streamed state (no re-read
 * while the stream is healthy and verified). A decision held back by time alone (cooldown, back-off) wakes itself
 * when that time runs out. A curve update that shows the pump.fun curve complete starts graduation at once
 * (`graduate`): the canonical pool is watched ahead and `graduate_pump` is sent as soon as it exists. The poll
 * (`POLL_MS`) is the heartbeat: it finds new and ended launches, decides on every launch as the fallback trigger
 * (first, all launches at once), then runs the cranks and the payout and warms the trade path (instruction
 * template, fee estimate, lookup table).
 */
export class Agent {
  /** Keyed by launch address (pump launches share the default mint until `launch_pump`). */
  private readonly runtime = new Map<string, LaunchRuntime>();
  private readonly decisions = new Map<string, Decision>();
  private readonly startedAt = nowSec();
  private readonly sizing: Sizing;
  private readonly alt: LookupTable;
  private readonly cranks: Cranks;
  private readonly stream: Stream | null;
  private readonly sender: TradeSender;
  private readonly metrics = new Metrics();
  /** The shared agent wallets that execute pump trades once the platform registers them. */
  private readonly executors: ExecutorPool;
  /** Total traded volume of pump launches from the indexer (public trades included). */
  private readonly publicVolume: PublicVolume;
  /** Top-ups sent to agent wallets in the last hour (bounded by `executorTopUpMaxPerHourLamports`). */
  private topUps: { at: number; lamports: number }[] = [];
  private lastTopUpSkip: string | null = null;
  private lastCoverage = "";
  /** Policy in force; replaced by the research loop when a proposal beats it walk-forward (`setStrategy`). */
  private strategy: StrategyParams;
  private lastTickAt: number | null = null;
  private tickCount = 0;
  /** Fee wallet balance as of the last tick; `low_balance` is logged each time it falls under the threshold. */
  private balanceLamports: number | null = null;
  private platform: { account: PlatformAccount; slot: number } | null = null;
  /** Latest chain clock: from the stream (every slot) and from the heartbeat. */
  private clock: { unixTs: bigint; slot: number } | null = null;
  private stopped = false;
  /** Work a decision left running after releasing its launch (a landed trade's log record): awaited on shutdown. */
  private readonly followUps = new Set<Promise<void>>();
  private platformDecodeLogged = false;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly client: MoshClient,
    private readonly signer: Keypair,
    private readonly activity: ActivityLog,
  ) {
    this.sizing = {
      minTradeLamports: cfg.minTradeLamports,
      minSellLamports: cfg.minSellLamports,
      slippageBps: cfg.slippageBps,
    };
    this.strategy = cfg.strategy;
    this.alt = new LookupTable(client.connection, signer, cfg.priorityFee, cfg.altFile, cfg.alt, client.programId);
    this.cranks = new Cranks(cfg, client, signer, this.alt, activity);
    this.stream = cfg.subscribe ? new Stream(cfg.wsUrl, STREAM_COMMITMENT) : null;
    this.sender = new TradeSender(client.connection, signer, cfg.priorityFee, this.alt, this.stream, cfg.sender);
    this.executors = new ExecutorPool(loadExecutors(cfg.executorSource), { minLamports: cfg.executorMinLamports, spacingMs: cfg.cooldownMs });
    this.publicVolume = new PublicVolume(cfg.indexerUrl, cfg.indexerInternalToken, 10_000, (msg, extra) => log("public_volume_failed", { msg, ...extra }));
  }

  currentStrategy(): StrategyParams {
    return this.strategy;
  }

  setStrategy(params: StrategyParams): void {
    this.strategy = params;
    log("strategy_updated", { strategy: params });
  }

  snapshot(): StatusSnapshot {
    return {
      agent: this.signer.publicKey.toBase58(),
      dryRun: this.cfg.dryRun,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      tick: this.tickCount,
      balanceSol: this.balanceLamports === null ? null : this.balanceLamports / LAMPORTS_PER_SOL,
      lookupTable: this.alt.address?.toBase58() ?? null,
      decisions: [...this.decisions.values()],
      cranks: [...this.cranks.attempts],
      stream: this.stream?.stats() ?? null,
      metrics: this.metrics.snapshot(),
      executors: this.executors.snapshot(),
    };
  }

  /** Runs until `signal` aborts; every in-flight send is allowed to finish. */
  async run(signal: AbortSignal): Promise<void> {
    this.start();
    let failures = 0;
    try {
      while (!signal.aborted) {
        const started = Date.now();
        let delay: number;
        try {
          await this.tick(signal);
          failures = 0;
          delay = Math.max(0, this.cfg.pollMs - (Date.now() - started));
        } catch (err) {
          failures += 1;
          delay = Math.min(this.cfg.pollMs * 2 ** failures, MAX_TICK_BACKOFF_MS);
          log("tick_failed", { error: describeError(err), failures, retryInMs: delay });
        }
        await sleep(delay, undefined, { signal }).catch((err: unknown) => {
          if (!signal.aborted) throw err;
        });
      }
    } finally {
      this.stopped = true;
      for (const rt of this.runtime.values()) this.clearTimers(rt);
      while ([...this.runtime.values()].some((rt) => rt.busy)) await sleep(100);
      // Landed-trade records, warm-ups and graduation loops (nudged out of their wait above).
      await Promise.allSettled([...this.followUps]);
      this.stream?.close();
      this.sender.stop();
    }
  }

  private start(): void {
    this.sender.start();
    const stream = this.stream;
    if (!stream) return;
    stream.slots((slot, at) => this.metrics.slot(slot, at));
    stream.account(SYSVAR_CLOCK_PUBKEY.toBase58(), (u) => {
      const slot = Number(u.data.readBigUInt64LE(0));
      if (!this.clock || slot >= this.clock.slot) this.clock = { unixTs: clockUnixTs(u.data), slot };
    });
    stream.account(platformPda(this.client.programId).toBase58(), (u) => {
      const account = this.decodePlatform(u.data);
      if (account) this.applyPlatform(account, u.slot);
    });
  }

  private decodePlatform(data: Buffer): PlatformAccount | null {
    try {
      return this.client.program.coder.accounts.decode<PlatformAccount>("platform", data);
    } catch (err) {
      if (!this.platformDecodeLogged) log("platform_decode_failed", { error: describeError(err), bytes: data.length });
      this.platformDecodeLogged = true;
      return null;
    }
  }

  private applyPlatform(account: PlatformAccount, slot: number): void {
    if (!this.platform || slot >= this.platform.slot) {
      this.platform = { account, slot };
      this.executors.setRegistered(agentExecutorsOf(account));
    }
  }

  /**
   * Heartbeat for the agent wallets: their balances (one batched read), a log line when the registered set and the
   * loaded keys disagree, and a bounded top-up from the agent key for every wallet under `executorMinLamports`.
   */
  private async walletHeartbeat(agentLamports: number): Promise<void> {
    const { active, missing } = this.executors.coverage();
    const coverage = `${active.length}/${missing.map(String).join()}`;
    if (coverage !== this.lastCoverage) {
      this.lastCoverage = coverage;
      if (active.length + missing.length > 0) {
        log("agent_wallets", { active: active.map(String), missing: missing.map(String) });
      }
    }
    if (active.length === 0) return;
    const infos = await this.client.connection.getMultipleAccountsInfo(active, "confirmed");
    this.executors.noteBalances(new Map(active.map((k, i) => [k.toBase58(), infos[i]?.lamports ?? 0])));
    if (this.cfg.dryRun) return;
    const low = this.executors.lowWallets();
    if (low.length === 0) return;
    const hourAgo = Date.now() - 3_600_000;
    this.topUps = this.topUps.filter((t) => t.at > hourAgo);
    let budget = this.cfg.executorTopUpMaxPerHourLamports - this.topUps.reduce((s, t) => s + t.lamports, 0);
    let spendable = agentLamports - AGENT_RESERVE_LAMPORTS;
    const plan: { key: PublicKey; lamports: number }[] = [];
    let skip: string | null = null;
    for (const w of low) {
      const lamports = this.cfg.executorTopUpLamports - w.lamports;
      if (lamports > spendable) {
        skip = `agent key keeps a ${AGENT_RESERVE_LAMPORTS / LAMPORTS_PER_SOL} SOL reserve for its own fees and cranks`;
        break;
      }
      if (lamports > budget) {
        skip = "hourly top-up budget used";
        break;
      }
      plan.push({ key: w.key, lamports });
      budget -= lamports;
      spendable -= lamports;
    }
    if (skip !== null && skip !== this.lastTopUpSkip) {
      log("agent_wallet_topup_skipped", { reason: skip, agentSol: agentLamports / LAMPORTS_PER_SOL, skipped: low.slice(plan.length).map((w) => w.key.toBase58()) });
    }
    this.lastTopUpSkip = skip;
    if (plan.length === 0) return;
    const ixs = plan.map((p) => SystemProgram.transfer({ fromPubkey: this.signer.publicKey, toPubkey: p.key, lamports: p.lamports }));
    const total = plan.reduce((s, p) => s + p.lamports, 0);
    // Debited before sending: a transfer that lands but whose confirmation is lost still counts against the hour.
    const debit = { at: Date.now(), lamports: total };
    this.topUps.push(debit);
    try {
      const sent = await sendIxs(this.client.connection, this.signer, ixs, this.cfg.priorityFee, this.alt);
      this.executors.noteBalances(new Map(plan.map((p) => [p.key.toBase58(), this.cfg.executorTopUpLamports])));
      log("agent_wallet_topup", { wallets: plan.map((p) => ({ key: p.key.toBase58(), sol: p.lamports / LAMPORTS_PER_SOL })), totalSol: total / LAMPORTS_PER_SOL, signature: sent.signature });
    } catch (err) {
      // A failed or expired transaction moved nothing; any other error may have landed, so its debit stays.
      if (err instanceof TransactionFailedError || err instanceof TransactionExpiredError) this.topUps = this.topUps.filter((t) => t !== debit);
      log("agent_wallet_topup_failed", { error: describeError(err), wallets: plan.map((p) => p.key.toBase58()) });
    }
  }

  /** Chain time for a decision: the newest clock seen (the stream's is a slot or two ahead of a confirmed read). */
  private now(): bigint {
    if (!this.clock) throw new Error("no clock yet");
    return this.clock.unixTs;
  }

  private async tick(signal: AbortSignal): Promise<void> {
    const connection = this.client.connection;
    const programId = this.client.programId;
    const [platformInfo, launches, clock, balance] = await Promise.all([
      connection.getAccountInfoAndContext(platformPda(programId), "confirmed"),
      connection.getProgramAccounts(programId, {
        commitment: "confirmed",
        withContext: true,
        filters: [{ memcmp: this.client.program.coder.accounts.memcmp("launch") }, { memcmp: { offset: LAUNCH_STATUS_OFFSET, bytes: LIVE_STATUS_BS58 } }],
      }),
      connection.getAccountInfoAndContext(SYSVAR_CLOCK_PUBKEY, "confirmed"),
      connection.getBalance(this.signer.publicKey, "confirmed"),
    ]);
    const readAt = Date.now();
    if (!platformInfo.value) throw new Error("platform account not found (is the program initialized on this cluster?)");
    if (!clock.value) throw new Error("clock sysvar unavailable");
    const platformAccount = this.decodePlatform(platformInfo.value.data);
    if (platformAccount) this.applyPlatform(platformAccount, platformInfo.context.slot);
    if (!this.platform) throw new Error("platform account could not be decoded (see platform_decode_failed)");
    if (!this.clock || clock.context.slot > this.clock.slot) this.clock = { unixTs: clockUnixTs(clock.value.data), slot: clock.context.slot };
    const wasLow = this.balanceLamports !== null && this.balanceLamports < LOW_BALANCE_LAMPORTS;
    this.balanceLamports = balance;
    if (balance < LOW_BALANCE_LAMPORTS && !wasLow && !this.cfg.dryRun) {
      log("low_balance", { agent: this.signer.publicKey.toBase58(), sol: balance / LAMPORTS_PER_SOL });
    }
    // Agent wallet balances gate which wallet may trade (`ExecutorPool.pick`): read before the first decisions, and
    // after them from then on (a top-up waits for its confirmation).
    const wallets = () => this.walletHeartbeat(balance).catch((err: unknown) => log("agent_wallets_read_failed", { error: describeError(err) }));
    if (this.tickCount === 0) await wallets();

    const rts: LaunchRuntime[] = [];
    for (const { pubkey, account } of launches.value) {
      const decoded = this.client.program.coder.accounts.decode<LaunchAccount>("launch", account.data);
      rts.push(await this.runtimeOf(pubkey, decoded, launches.context.slot));
    }
    await this.readVenues(rts.filter((rt) => rt.json.venue === "pump"));
    // Decisions first, every launch at once: none waits behind another launch's send or behind the cranks below.
    const poll: Trigger = { source: "poll", seenAt: readAt };
    await Promise.all(
      rts.map((rt) =>
        this.exclusive(rt, () => {
          const trigger = rt.trigger ?? poll;
          rt.trigger = null;
          return this.handle(rt, trigger);
        }).catch((err: unknown) => log("decide_failed", { address: rt.key, error: describeError(err) })),
      ),
    );
    // Then what is not latency-critical, launch by launch; one launch failing never stops the others' heartbeat.
    const live = new Set<string>();
    const liveMints = new Set<string>();
    for (const rt of rts) {
      if (signal.aborted) break;
      let woundDown = false;
      try {
        woundDown = await this.heartbeatCranks(rt);
      } catch (err) {
        log("crank_failed", { address: rt.key, error: describeError(err) });
      }
      // Wound down = no longer Live: its decision, runtime and subscriptions are dropped below.
      if (woundDown) continue;
      live.add(rt.key);
      liveMints.add(rt.account.mint.toBase58());
    }
    if (this.tickCount > 0) await wallets();
    if (!signal.aborted) {
      for (const key of [...this.decisions.keys()]) if (!live.has(key)) this.decisions.delete(key);
      for (const [key, rt] of [...this.runtime]) {
        if (live.has(key)) continue;
        this.unsubscribe(rt);
        this.runtime.delete(key);
      }
      this.cranks.retain(live);
      this.executors.retain(live, liveMints);
      this.sender.retain(live);
      this.activity.forget(live);
    }
    this.lastTickAt = nowSec();
    this.tickCount += 1;
  }

  /**
   * A launch's heartbeat work after the decisions: wind-down (true = wound down), the payout, graduation of a completed
   * curve the stream did not report, the paced pump cranks and the trade-path warm-up.
   */
  private async heartbeatCranks(rt: LaunchRuntime): Promise<boolean> {
    // Operator kill switch (AGENT_SKIP_LAUNCHES): no trades and no cranks at all on this launch.
    if (this.skipped(rt)) return false;
    let woundDown = false;
    await this.exclusive(rt, async () => {
      woundDown = await this.cranks.windDown(this.crankLaunch(rt), this.now());
      if (!woundDown) await this.payout(rt);
    });
    if (woundDown || rt.json.venue !== "pump") return woundDown;
    if (decodeVenue(rt.json, this.venueInfos(rt))?.complete) this.graduate(rt);
    await this.cranks.pump(this.crankLaunch(rt), this.platform!.account, this.now());
    if (!this.cfg.dryRun) await this.warmTrades(rt);
    return false;
  }

  /**
   * Backer payouts are signed by the agent and only sent into a strong market (never a dip), judged on the projection
   * and flow a decision would use now. Not latency-critical: heartbeat only.
   */
  private async payout(rt: LaunchRuntime): Promise<void> {
    const market = this.marketOf(rt);
    if (!market || this.skipReason() !== undefined) return;
    const now = this.now();
    const flow = rt.flow.observe(market, now);
    await this.cranks.payout(this.crankLaunch(rt), market, project(market, now), flow, now, this.strategy);
  }

  private skipped(rt: LaunchRuntime): boolean {
    return this.cfg.skipLaunches.has(rt.address.toBase58()) || this.cfg.skipLaunches.has(rt.account.mint.toBase58());
  }

  /** Venue (and graduation pool) accounts of `rts` from one batched read, each applied only where newer than what the stream had. */
  private async readVenues(rts: LaunchRuntime[]): Promise<void> {
    const perLaunch = rts.map((rt) => this.watchedKeys(rt));
    const keys = perLaunch.flat();
    const infos: ({ data: Buffer } | null)[] = [];
    const slots: number[] = [];
    for (let i = 0; i < keys.length; i += MAX_BATCH_KEYS) {
      const { context, value } = await this.client.connection.getMultipleAccountsInfoAndContext(keys.slice(i, i + MAX_BATCH_KEYS), "confirmed");
      infos.push(...value);
      slots.push(...value.map(() => context.slot));
    }
    let at = 0;
    rts.forEach((rt, r) => {
      for (const k of perLaunch[r]!) {
        this.applyAccount(rt, k.toBase58(), infos[at] ?? null, slots[at]!);
        at++;
      }
    });
  }

  private async runtimeOf(address: PublicKey, account: LaunchAccount, slot: number): Promise<LaunchRuntime> {
    const key = address.toBase58();
    let rt = this.runtime.get(key);
    if (!rt) {
      const json = launchToJson(address, account);
      rt = {
        key,
        address,
        account,
        json,
        launchSlot: slot,
        changeSlot: slot,
        venueKeys: json.venue === "pump" ? venueKeys(json) : [],
        poolKeys: [],
        accounts: new Map(),
        subs: new Map(),
        verifiedEpoch: -1,
        cooldownUntil: 0,
        backoff: new TradeBackoff(),
        flow: new FlowWindow(),
        busy: false,
        trigger: null,
        timer: null,
        wake: null,
        fill: null,
        template: null,
        graduation: null,
      };
      this.runtime.set(key, rt);
      this.subscribe(rt);
    } else {
      this.applyLaunch(rt, account, slot);
    }
    if (rt.symbol === undefined) {
      // Pump launches store their symbol (pump.fun's metadata is Metaplex, not Token-2022 metadata).
      rt.symbol =
        "pump" in account.venue
          ? account.symbol
          : await this.client
              .fetchTokenMeta(account.mint)
              .then((m) => m?.symbol)
              .catch(() => undefined);
    }
    return rt;
  }

  /**
   * Takes `account` read at `slot` unless newer state is already known. A changed venue re-syncs the watched accounts;
   * at graduation the pool's accounts were watched since the curve completed, so their data carries over and the
   * update that records the pool is decided on the pool at once.
   */
  private applyLaunch(rt: LaunchRuntime, account: LaunchAccount, slot: number): boolean {
    if (slot < rt.launchSlot) return false;
    const wasGraduated = rt.json.venue === "pump" && rt.json.pump.graduated;
    const json = launchToJson(rt.address, account);
    if (JSON.stringify(json) !== JSON.stringify(rt.json)) rt.changeSlot = Math.max(rt.changeSlot, slot);
    rt.account = account;
    rt.json = json;
    rt.launchSlot = slot;
    const keys = rt.json.venue === "pump" ? venueKeys(rt.json) : [];
    if (keys.map(String).join() !== rt.venueKeys.map(String).join()) {
      rt.venueKeys = keys;
      rt.template = null;
      const graduated = rt.json.venue === "pump" && rt.json.pump.graduated;
      if (graduated) rt.poolKeys = [];
      this.subscribe(rt);
      if (graduated && !wasGraduated) this.graduated(rt);
    }
    return true;
  }

  /** Data of a watched venue / pool account read or streamed at `slot`; false when older than what is known or not watched. */
  private applyAccount(rt: LaunchRuntime, key: string, info: { data: Buffer } | null, slot: number): boolean {
    if (!this.watchedKeys(rt).some((k) => k.toBase58() === key)) return false;
    const known = rt.accounts.get(key);
    if (known && slot < known.slot) return false;
    if (!known || (known.data === null) !== (info === null) || (info && known.data && !info.data.equals(known.data))) {
      rt.changeSlot = Math.max(rt.changeSlot, slot);
    }
    rt.accounts.set(key, { data: info ? info.data : null, slot });
    return true;
  }

  /** The venue accounts' data in `venueKeys` order (null = missing or not read yet), as `decodeVenue` takes them. */
  private venueInfos(rt: LaunchRuntime): ({ data: Buffer } | null)[] {
    return rt.venueKeys.map((k) => {
      const data = rt.accounts.get(k.toBase58())?.data;
      return data ? { data } : null;
    });
  }

  /** Venue accounts and, while graduating, the canonical pool's: everything subscribed and read besides the Launch. */
  private watchedKeys(rt: LaunchRuntime): PublicKey[] {
    return [...rt.venueKeys, ...rt.poolKeys];
  }

  /** Syncs the stream subscriptions and the account data kept with what the launch watches now. */
  private subscribe(rt: LaunchRuntime): void {
    const want = new Map<string, (u: AccountUpdate) => void>([[rt.key, (u) => this.onLaunch(rt, u)]]);
    for (const k of this.watchedKeys(rt)) {
      const key = k.toBase58();
      want.set(key, (u) => this.onVenue(rt, key, u));
    }
    for (const key of [...rt.accounts.keys()]) if (!want.has(key)) rt.accounts.delete(key);
    const stream = this.stream;
    if (!stream) return;
    for (const [key, id] of [...rt.subs]) {
      if (want.has(key)) continue;
      stream.remove(id);
      rt.subs.delete(key);
    }
    let added = false;
    for (const [key, onAccount] of want) {
      if (rt.subs.has(key)) continue;
      rt.subs.set(key, stream.account(key, onAccount));
      added = true;
    }
    // A new subscription misses what changed before the server confirmed it: the next trade re-reads first.
    if (added) rt.verifiedEpoch = -1;
  }

  private unsubscribe(rt: LaunchRuntime): void {
    this.clearTimers(rt);
    for (const id of rt.subs.values()) this.stream?.remove(id);
    rt.subs.clear();
  }

  /** Drops the launch's pending debounce and wake-up, and cuts a graduation loop's wait short (it then sees why). */
  private clearTimers(rt: LaunchRuntime): void {
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = null;
    if (rt.wake) clearTimeout(rt.wake.timer);
    rt.wake = null;
    rt.graduation?.nudge?.();
  }

  private onLaunch(rt: LaunchRuntime, u: AccountUpdate): void {
    if (this.runtime.get(rt.key) !== rt) return;
    let account: LaunchAccount;
    try {
      account = this.client.program.coder.accounts.decode<LaunchAccount>("launch", u.data);
    } catch (err) {
      log("launch_decode_failed", { address: rt.key, error: describeError(err) });
      return;
    }
    if (this.applyLaunch(rt, account, u.slot)) this.changed(rt, u);
  }

  private onVenue(rt: LaunchRuntime, key: string, u: AccountUpdate): void {
    if (this.runtime.get(rt.key) !== rt || !this.applyAccount(rt, key, u, u.slot)) return;
    if (!rt.venueKeys.some((k) => k.toBase58() === key)) {
      // A graduation pool account appeared or changed: the graduation loop re-reads now instead of on its next tick.
      rt.graduation?.nudge?.();
      return;
    }
    // The curve shows completion in the update of the trade that completed it: graduation starts right here.
    if (decodeVenue(rt.json, this.venueInfos(rt))?.complete) this.graduate(rt);
    this.changed(rt, u);
  }

  /** A streamed change: into the flow window now (so the gates see every trade), decided on after the debounce. */
  private changed(rt: LaunchRuntime, u: AccountUpdate): void {
    if (this.stopped) return;
    const landAt = this.metrics.slotAt(u.slot);
    if (landAt !== undefined) this.metrics.add("notify", u.at - landAt);
    const market = this.marketOf(rt);
    if (market && this.clock) rt.flow.observe(market, this.now());
    rt.trigger ??= { source: "stream", seenAt: u.at, slot: u.slot, landAt: landAt ?? u.at };
    this.schedule(rt);
  }

  /** Decides on the pending trigger: a streamed change after the debounce (updates arriving meanwhile ride along), a wake-up at once. */
  private schedule(rt: LaunchRuntime): void {
    if (rt.timer || rt.busy || !rt.trigger || this.stopped) return;
    rt.timer = setTimeout(
      () => {
        rt.timer = null;
        if (this.runtime.get(rt.key) !== rt || !rt.trigger) return;
        void this.exclusive(rt, () => {
          const trigger = rt.trigger!;
          rt.trigger = null;
          return this.handle(rt, trigger);
        }).catch((err: unknown) => log("decide_failed", { address: rt.key, error: describeError(err) }));
      },
      rt.trigger.source === "stream" ? this.cfg.debounceMs : 0,
    );
  }

  /**
   * Decides again at wall-clock `at`, when a cooldown or back-off runs out: a decision held back by time alone gets no
   * stream update to retry on when the market is quiet. An earlier wake-up already set stays (it re-arms if needed).
   */
  private wakeAt(rt: LaunchRuntime, at: number): void {
    if (this.stopped || (rt.wake && rt.wake.at <= at)) return;
    if (rt.wake) clearTimeout(rt.wake.timer);
    const timer = setTimeout(() => {
      rt.wake = null;
      if (this.runtime.get(rt.key) !== rt) return;
      rt.trigger ??= { source: "wake", seenAt: Date.now() };
      this.schedule(rt);
    }, Math.max(0, at - Date.now()));
    rt.wake = { timer, at };
  }

  /** Runs `fn` holding the launch (skipped when something else holds it); a change that arrived meanwhile is scheduled after. */
  private async exclusive(rt: LaunchRuntime, fn: () => Promise<void>): Promise<void> {
    if (rt.busy) return;
    rt.busy = true;
    try {
      await fn();
    } finally {
      rt.busy = false;
      this.schedule(rt);
    }
  }

  /** Keeps `work` (started after a decision let go of its launch) for the shutdown to wait on. */
  private follow(work: Promise<void>): void {
    const tracked = work.catch((err: unknown) => log("follow_up_failed", { error: describeError(err) })).finally(() => this.followUps.delete(tracked));
    this.followUps.add(tracked);
  }

  /**
   * The pump.fun curve completed. pump.fun migrates it into its canonical PumpSwap pool (`poolPda(mint)`, the only pool
   * `graduate_pump` accepts) within a slot or two, so the pool and its token accounts are watched from now on and a
   * loop reads them every GRADUATE_RETRY_MS (at once when the stream shows a pool account change) and sends
   * `graduate_pump` as soon as the pool exists, until the launch records it. Idempotent: the stream, the heartbeat and
   * the decisions all call it.
   */
  private graduate(rt: LaunchRuntime): void {
    if (rt.json.venue !== "pump" || rt.json.pump.graduated || this.stopped || this.skipped(rt)) return;
    if (!rt.graduation) {
      rt.graduation = { completeAt: Date.now(), running: false, nudge: null };
      rt.poolKeys = poolKeys(rt.account.mint);
      this.subscribe(rt);
      log("curve_complete", { address: rt.key, mint: rt.json.mint, symbol: rt.symbol, pool: rt.poolKeys[2]!.toBase58() });
    }
    const g = rt.graduation;
    if (g.running) return;
    g.running = true;
    this.follow(
      this.graduation(rt, g)
        .catch((err: unknown) => log("graduate_failed", { address: rt.key, error: describeError(err) }))
        .finally(() => {
          g.running = false;
          g.nudge = null;
        }),
    );
  }

  private async graduation(rt: LaunchRuntime, g: NonNullable<LaunchRuntime["graduation"]>): Promise<void> {
    let failures = 0;
    while (!this.stopped && this.runtime.get(rt.key) === rt && rt.graduation === g) {
      let delay = GRADUATE_RETRY_MS;
      try {
        const keys = rt.poolKeys;
        const { context, value } = await this.client.connection.getMultipleAccountsInfoAndContext([rt.address, ...keys], STREAM_COMMITMENT);
        const [launchInfo, ...pool] = value;
        if (launchInfo) this.applyLaunch(rt, this.client.program.coder.accounts.decode<LaunchAccount>("launch", launchInfo.data), context.slot);
        if (rt.graduation !== g) break;
        keys.forEach((k, i) => this.applyAccount(rt, k.toBase58(), pool[i] ?? null, context.slot));
        // The pool account (last of `poolKeys`) exists: pump.fun migrated, `graduate_pump` can record it.
        if (pool[keys.length - 1]) {
          if (await this.cranks.graduate(this.crankLaunch(rt))) delay = 0;
          else if (++failures > GRADUATE_FAST_TRIES) delay = Math.min(GRADUATE_RETRY_MS * 2 ** (failures - GRADUATE_FAST_TRIES), this.cfg.crankMs);
        } else if (Date.now() - g.completeAt > GRADUATE_FAST_WINDOW_MS) {
          delay = this.cfg.pollMs;
        }
      } catch (err) {
        log("graduate_read_failed", { address: rt.key, error: describeError(err) });
      }
      if (delay > 0 && rt.graduation === g && !this.stopped) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          g.nudge = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        g.nudge = null;
      }
    }
  }

  /** The launch now records its pool: the downtime since the curve completed is logged and the trade path warmed for the pool. */
  private graduated(rt: LaunchRuntime): void {
    const g = rt.graduation;
    rt.graduation = null;
    g?.nudge?.();
    log("graduated", { address: rt.key, mint: rt.json.mint, symbol: rt.symbol, pool: rt.json.pump.pool, completeToRecordedMs: g ? Date.now() - g.completeAt : null });
    if (!this.cfg.dryRun) this.follow(this.warmTrades(rt));
  }

  private crankLaunch(rt: LaunchRuntime): CrankLaunch {
    return { address: rt.address, account: rt.account, json: rt.json, symbol: rt.symbol };
  }

  /** The launch as the program will price it; null for a pump launch whose venue accounts are missing or whose curve completed. */
  private marketOf(rt: LaunchRuntime): MarketState | null {
    if (rt.json.venue !== "pump") return marketOf(rt.account);
    const venue = decodeVenue(rt.json, this.venueInfos(rt));
    // A completed curve trades no more; once pump.fun migrated it, its reserves read zero.
    if (!venue || venue.complete) return null;
    const market = marketOf(rt.account, venue.curve);
    const buyback = this.platform?.account.params.buybackMint;
    market.official = !!buyback && !buyback.equals(PublicKey.default) && buyback.equals(rt.account.mint);
    // Pump launches: the program only counts its own trades; the guardrail needs the chart's real volume.
    const indexed = this.publicVolume.get(rt.address.toBase58());
    if (indexed !== null && indexed > market.volumeSol) market.volumeSol = indexed;
    return market;
  }

  private skipReason(): string | undefined {
    const platform = this.platform!.account;
    if (platform.params.agentsPaused) return "agents paused by platform";
    if (!platform.agentAuthority.equals(this.signer.publicKey)) {
      return `this key is not the platform agent authority (${platform.agentAuthority.toBase58()})`;
    }
    return undefined;
  }

  /** The decision is final now: its timing facts, also fed to the metrics. */
  private decided(trigger: Trigger, reread: boolean): Decided {
    const at = Date.now();
    const detail: Decided["detail"] = { trigger: trigger.source, reactMs: at - trigger.seenAt, reread };
    this.metrics.add("react", at - trigger.seenAt);
    if (trigger.slot !== undefined) detail.triggerSlot = trigger.slot;
    if (trigger.landAt !== undefined) {
      detail.landToDecisionMs = at - trigger.landAt;
      this.metrics.add("landToDecision", at - trigger.landAt);
    }
    return { at, detail };
  }

  /** Whether the streamed state can be traded on without a re-read (healthy stream, verified since its last gap). */
  private trusted(rt: LaunchRuntime): boolean {
    return this.stream !== null && this.stream.healthy && rt.verifiedEpoch === this.stream.epoch;
  }

  private async handle(rt: LaunchRuntime, trigger: Trigger): Promise<void> {
    const l = this.crankLaunch(rt);
    const { json } = l;
    const pump = json.venue === "pump";
    // A stream change before the first heartbeat finished waits for it; a launch that just stopped being Live is the heartbeat's.
    if (!this.platform || !this.clock || !("live" in rt.account.status)) return;
    const market = this.marketOf(rt);
    if (!market) {
      const prices = { priceSol: 0, emaSol: q64ToSolPerToken(BigInt(json.emaPriceQ64)), bandLowSol: 0, bandHighSol: 0 };
      if (pump && decodeVenue(json, this.venueInfos(rt))?.complete) {
        this.graduate(rt);
        const reason = "bonding curve complete: graduating to PumpSwap (graduate_pump as soon as pump.fun's pool exists)";
        this.record(rt, l, prices, NEUTRAL_FLOW, { action: "skip", reason }, "complete", this.decided(trigger, false).detail);
        return;
      }
      const where = json.pump.graduated ? "PumpSwap pool or its token accounts" : "pump.fun bonding curve";
      this.record(rt, l, prices, NEUTRAL_FLOW, { action: "skip", reason: `venue account missing (${where} not found)` }, "no_venue", this.decided(trigger, false).detail);
      return;
    }
    const now = this.now();
    const flow = rt.flow.observe(market, now);
    let ev = evaluate(market, this.sizing, now, this.strategy, flow);
    const skipReason = this.skipped(rt) ? "everything disabled for this launch by the operator (AGENT_SKIP_LAUNCHES)" : this.skipReason();
    if (skipReason) {
      this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason: skipReason }, "paused", this.decided(trigger, false).detail);
      return;
    }
    if (ev.plan.action === "hold") {
      rt.backoff.calm();
      this.record(rt, l, displayPrices(ev.projection), flow, { action: "hold", reason: ev.plan.reason }, ev.plan.kind, this.decided(trigger, false).detail);
      return;
    }
    if (this.cfg.dryRun) {
      const plan = ev.plan;
      const reason = `dry run, not sent: ${plan.reason}`;
      this.record(rt, l, displayPrices(ev.projection), flow, { action: plan.action, reason, amount: plan.amount.toString() }, plan.kind, {
        expectedOut: plan.expectedOut,
        minOut: plan.minOut,
        impactBps: plan.impactBps,
        support: plan.support ?? false,
        dryRun: true,
        ...this.decided(trigger, false).detail,
      });
      return;
    }
    if (this.heldBack(rt, l, ev.projection, ev.plan, flow, trigger, false)) return;
    if (rt.fill) {
      if (rt.account.agentBuys + rt.account.agentSells >= rt.fill.count) rt.fill = null;
      else if (Date.now() < rt.fill.until && this.trusted(rt)) {
        // The streamed state predates the agent's own last fill: planning on it would trade twice. The fill's
        // notification triggers the next decision (or the wake-up when the wait runs out, which re-reads).
        const reason = `waiting for the last fill to show in the stream; wants ${ev.plan.reason}`;
        this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason }, "settling", this.decided(trigger, false).detail);
        this.wakeAt(rt, rt.fill.until);
        return;
      } else {
        rt.fill = null;
        rt.verifiedEpoch = -1;
      }
    }

    let reread = false;
    if (!this.trusted(rt)) {
      // Re-read the launch, the clock and the venue in one slot right before sending so the plan matches what the
      // program will see (heartbeat data can be seconds old; the stream may have missed changes in a gap).
      reread = true;
      const epoch = this.stream?.epoch ?? -1;
      const keys = rt.venueKeys;
      const { context, value } = await this.client.connection.getMultipleAccountsInfoAndContext(
        [l.address, SYSVAR_CLOCK_PUBKEY, ...keys],
        this.stream ? STREAM_COMMITMENT : "confirmed",
      );
      const [launchInfo, clockInfo, ...venueInfos] = value;
      if (!launchInfo || !clockInfo) throw new Error(`launch ${json.address} or clock vanished during refresh`);
      const graduated = json.pump.graduated;
      this.applyLaunch(rt, this.client.program.coder.accounts.decode<LaunchAccount>("launch", launchInfo.data), context.slot);
      if (pump && rt.json.pump.graduated !== graduated) {
        const reason = "venue changed during refresh (graduation), re-planning on the next update";
        this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason }, "venue_changed", this.decided(trigger, true).detail);
        return;
      }
      venueInfos.forEach((info, i) => this.applyAccount(rt, keys[i]!.toBase58(), info, context.slot));
      if (!this.clock || context.slot > this.clock.slot) this.clock = { unixTs: clockUnixTs(clockInfo.data), slot: context.slot };
      rt.verifiedEpoch = epoch;
      const fresh = this.marketOf(rt);
      if (!fresh) {
        const completed = pump && decodeVenue(rt.json, this.venueInfos(rt))?.complete;
        if (completed) this.graduate(rt);
        const reason = completed ? "bonding curve completed during refresh" : "venue account missing after refresh, re-planning on the next update";
        this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason }, "venue_changed", this.decided(trigger, true).detail);
        return;
      }
      ev = evaluate(fresh, this.sizing, this.now(), this.strategy, flow);
      // The fresh plan may want the other side, which has its own back-off.
      if (ev.plan.action !== "hold" && this.heldBack(rt, this.crankLaunch(rt), ev.projection, ev.plan, flow, trigger, true)) return;
    }
    const plan = ev.plan;
    const decided = this.decided(trigger, reread);
    const current = this.crankLaunch(rt);
    if (plan.action === "hold") {
      rt.backoff.calm();
      this.record(rt, current, displayPrices(ev.projection), flow, { action: "hold", reason: plan.reason }, plan.kind, decided.detail);
      return;
    }
    await this.execute(rt, current, ev, flow, plan, decided);
  }

  /**
   * Whether a wanted trade waits on time alone: the cooldown after the last fill (either side) or the plan's side's
   * error back-off. If so the skip is recorded and the launch wakes itself when the wait runs out (a program
   * rejection's back-off also ends with the next state change, which triggers on its own).
   */
  private heldBack(rt: LaunchRuntime, l: CrankLaunch, proj: Evaluation["projection"], plan: TradePlan, flow: FlowFeatures, trigger: Trigger, reread: boolean): boolean {
    const now = Date.now();
    if (rt.cooldownUntil > now) {
      const reason = `cooldown after last trade, ${Math.ceil((rt.cooldownUntil - now) / 1000)}s left; wants ${plan.reason}`;
      this.record(rt, l, displayPrices(proj), flow, { action: "skip", reason }, "cooldown", this.decided(trigger, reread).detail);
      this.wakeAt(rt, rt.cooldownUntil);
      return true;
    }
    const wait = rt.backoff.wait(plan.action, rt.changeSlot, now);
    if (wait.ms === 0) return false;
    const secs = Math.ceil(wait.ms / 1000);
    const why = wait.kind === "program" ? `${plan.action} rejected, re-planning on the next update or in ${secs}s` : `${plan.action} send failed, retry in ${secs}s`;
    const d = { action: "skip" as const, reason: `backing off: ${why}; wants ${plan.reason}`, ...(wait.error ? { error: wait.error } : {}) };
    this.record(rt, l, displayPrices(proj), flow, d, "backoff", this.decided(trigger, reread).detail);
    this.wakeAt(rt, now + wait.ms);
    return true;
  }

  /**
   * Why `plan` would now fail on the launch's current state — the stream's at send time, not the decision's snapshot —
   * or null; `graduated` = the pump venue stage it was planned (and its instruction built) on.
   */
  private staleReason(rt: LaunchRuntime, plan: TradePlan, graduated: boolean): string | null {
    if (rt.json.venue === "pump" && rt.json.pump.graduated !== graduated) return "the venue changed (graduation)";
    const market = this.marketOf(rt);
    if (!market) return "the venue state is unavailable";
    return planRejection(market, this.now(), plan);
  }

  private async execute(rt: LaunchRuntime, l: CrankLaunch, ev: Evaluation, flow: FlowFeatures, plan: TradePlan, decided: Decided): Promise<void> {
    const amount = plan.amount.toString();
    const prices = displayPrices(ev.projection);
    const graduated = l.json.venue === "pump" && l.json.pump.graduated;
    const unitsKey = `${rt.key}:${plan.action}:${graduated ? "pool" : "curve"}`;
    let extra: Record<string, unknown> = {
      expectedOut: plan.expectedOut,
      minOut: plan.minOut,
      impactBps: plan.impactBps,
      support: plan.support ?? false,
      ...decided.detail,
    };
    // Once the platform registers agent wallets every pump trade goes through one (the program requires it).
    let wallet: Keypair | null = null;
    if (l.json.venue === "pump" && this.executors.required) {
      const picked = this.executors.pick(rt.key, plan.action, Date.now());
      if ("reason" in picked) {
        this.record(rt, l, prices, flow, { action: "skip", reason: `${picked.reason}; wants ${plan.reason}` }, "agent_wallet", decided.detail);
        // The spacing between a buy and a sell runs out by itself; busy or low wallets free up with a fill or a top-up.
        if (picked.retryAt !== undefined) this.wakeAt(rt, picked.retryAt);
        return;
      }
      wallet = picked.wallet;
      extra.executor = wallet.publicKey.toBase58();
    }
    let walletCost = 0;
    try {
      const ix = await this.tradeIx(rt, plan, wallet);
      const sent = await this.sender.send([ix], { fee: rt.key, units: unitsKey }, {
        onSent: () => this.metrics.sent(),
        ...(wallet ? { payer: wallet } : {}),
        stale: () => this.staleReason(rt, plan, graduated),
      });
      // The wallet paid both signatures, the priority fee and the Sender tip.
      walletCost = 2 * 5_000 + sent.cost.priorityFeeLamports + sent.cost.tipLamports;
      const t = sent.timing;
      this.metrics.add("decisionToSent", t.sentAt - decided.at);
      if (t.landedAt !== null) this.metrics.add("sentToLanded", t.landedAt - t.sentAt);
      this.metrics.add("sentToConfirmed", t.confirmedAt - t.sentAt);
      this.metrics.landed();
      extra = {
        ...extra,
        ...sent.cost,
        decisionToSentMs: t.sentAt - decided.at,
        sentToLandedMs: t.landedAt === null ? undefined : t.landedAt - t.sentAt,
        sentToConfirmedMs: t.confirmedAt - t.sentAt,
        landedSlot: t.slot ?? undefined,
      };
      rt.backoff.landed(plan.action);
      rt.cooldownUntil = t.confirmedAt + this.cfg.cooldownMs;
      rt.fill = { count: l.account.agentBuys + l.account.agentSells + 1, until: Date.now() + FILL_WAIT_MS };
      // The launch is free again once this returns (the cooldown and the fill check guard the next trade); the
      // landed transaction's units and events are fetched for the log without holding it.
      this.follow(this.recordLanded(rt, l, prices, flow, plan, sent.signature, unitsKey, extra));
    } catch (err) {
      if (err instanceof StalePlanError) {
        // Nothing was sent: the update that moved the state triggers the next plan. No back-off, no fee.
        this.record(rt, l, prices, flow, { action: "skip", reason: `state moved before sending (${err.reason}), re-planning; wanted ${plan.reason}` }, "stale", decided.detail);
        return;
      }
      // The next attempt simulates again, so a persistent program error is caught before it costs another fee.
      this.sender.forgetUnits(unitsKey);
      this.metrics.failed(err);
      const failure = rt.backoff.failed(plan.action, err, rt.changeSlot, Date.now());
      // Whatever landed or not, the next plan starts from a fresh read.
      rt.verifiedEpoch = -1;
      this.record(rt, l, prices, flow, { action: plan.action, reason: plan.reason, amount, error: failure.error }, "error", {
        ...extra,
        failure: failure.kind,
        retryInMs: failure.retryInMs,
      });
      // A same-slot collision retries on the next update (the colliding trade's own); the rest also wake when the wait ends.
      if (failure.retryInMs > 0) this.wakeAt(rt, Date.now() + failure.retryInMs);
    } finally {
      if (wallet) this.executors.release(wallet.publicKey, rt.key, walletCost);
    }
  }

  /** A landed trade's log record, with the compute units and events of its transaction (the launch is not held meanwhile). */
  private async recordLanded(
    rt: LaunchRuntime,
    l: CrankLaunch,
    prices: DisplayPrices,
    flow: FlowFeatures,
    plan: TradePlan,
    signature: string,
    unitsKey: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const result = await landed(this.client, signature);
    const units = result?.cost.unitsConsumed;
    if (typeof units === "number") this.sender.noteUnits(unitsKey, units);
    const trade = (result?.events ?? []).find((e) => e.name === "trade");
    const fill =
      trade?.name === "trade"
        ? {
            filledSol: trade.data.solAmount.toString(),
            filledTokens: trade.data.tokenAmount.toString(),
            vaultSol: trade.data.vaultSol.toString(),
            vaultTokens: trade.data.vaultTokens.toString(),
          }
        : {};
    this.record(rt, l, prices, flow, { action: plan.action, reason: plan.reason, amount: plan.amount.toString(), signature }, plan.kind, {
      ...extra,
      ...result?.cost,
      ...fill,
    });
  }

  /**
   * `agent_buy` / `agent_sell` on the launch's venue, through agent wallet `wallet` when one is given. On pump launches
   * the heartbeat's SDK-built template supplies the accounts (pump.fun's fee recipients are read live there), re-aimed
   * at `wallet` when it was built for another one, so the hot path needs no round trip.
   */
  private async tradeIx(rt: LaunchRuntime, plan: TradePlan, wallet: Keypair | null): Promise<TransactionInstruction> {
    const agent = this.signer.publicKey;
    const l = rt.json;
    if (l.venue !== "pump") {
      return plan.action === "buy"
        ? this.client.agentBuyIx(agent, rt.account.mint, plan.amount, plan.minOut)
        : this.client.agentSellIx(agent, rt.account.mint, plan.amount, plan.minOut);
    }
    const executor = wallet?.publicKey ?? null;
    const t = rt.template;
    if (t && t.graduated === l.pump.graduated && (t.executor === null) === (executor === null)) {
      const keys = t.executor && executor ? this.executors.retarget(t.ix, t.executor, executor, rt.account.mint).keys : t.ix.keys;
      const data = Buffer.alloc(24);
      (plan.action === "buy" ? AGENT_BUY_PUMP : AGENT_SELL_PUMP).copy(data, 0);
      data.writeBigUInt64LE(plan.amount, 8);
      data.writeBigUInt64LE(plan.minOut, 16);
      return new TransactionInstruction({ programId: t.ix.programId, keys, data });
    }
    const ref = pumpRefOf(l);
    return plan.action === "buy"
      ? this.client.agentBuyPumpIx(agent, ref, plan.amount, plan.minOut, executor)
      : this.client.agentSellPumpIx(agent, ref, plan.amount, plan.minOut, executor);
  }

  /** Heartbeat work that keeps round trips out of a pump launch's next trade: instruction template, fee estimate, lookup table. */
  private async warmTrades(rt: LaunchRuntime): Promise<void> {
    try {
      const graduated = rt.json.pump.graduated;
      // Built for the first held wallet; `tradeIx` re-aims it at whichever wallet a trade gets.
      const executor = this.executors.required ? (this.executors.coverage().active[0] ?? null) : null;
      const ix = await this.client.agentBuyPumpIx(this.signer.publicKey, pumpRefOf(rt.json), 0n, 0n, executor);
      rt.template = { ix, graduated, executor };
      await this.sender.warm(rt.key, [ix]);
      if (graduated) await this.alt.get();
    } catch (err) {
      log("warm_failed", { address: rt.key, error: describeError(err) });
    }
  }

  private record(
    rt: LaunchRuntime,
    l: CrankLaunch,
    prices: DisplayPrices,
    flow: FlowFeatures,
    d: Pick<Decision, "action" | "reason" | "amount" | "signature" | "error">,
    kind: string,
    extra: Record<string, unknown> = {},
  ): void {
    const decision: Decision = {
      address: l.json.address,
      mint: l.json.mint,
      venue: l.json.venue,
      symbol: rt.symbol,
      at: nowSec(),
      ...d,
      ...prices,
      flow: displayFlow(flow),
    };
    this.decisions.set(l.json.address, decision);
    const trade = d.action === "buy" || d.action === "sell";
    if (trade || rt.loggedKind !== kind) {
      rt.loggedKind = kind;
      log("decision", { ...decision, ...extra });
    }
    // Activity feed: every do-nothing reason too (the log collapses repeats of the same hold kind).
    const item: Omit<ActivityItem, "narrative"> = {
      ts: decision.at,
      kind: d.action === "sell" ? "sell" : d.action === "buy" ? (kind === "buyback" ? "buyback" : "buy") : "hold",
      reason: d.reason,
      detail: trade ? activityDetail(decision, d, extra) : { holdKind: kind, ...activityDetail(decision, d, extra) },
    };
    if (d.signature) item.sig = d.signature;
    this.activity.record(
      { address: l.json.address, mint: l.json.mint, symbol: rt.symbol, venue: l.json.venue },
      item,
      trade ? { plan: kind, vaultSol: l.json.vaultSol, vaultTokens: l.json.vaultTokens } : undefined,
    );
  }
}

/** Flat JSON facts of a decision for the activity feed: prices in SOL per token, amounts in UI units, flow rounded. */
function activityDetail(decision: Decision, d: Pick<Decision, "action" | "amount" | "error">, extra: Record<string, unknown>): ActivityItem["detail"] {
  const detail: ActivityItem["detail"] = {
    priceSol: decision.priceSol,
    emaSol: decision.emaSol,
    bandLowSol: decision.bandLowSol,
    bandHighSol: decision.bandHighSol,
    imbalance: decision.flow.imbalance,
    volumeRatio: decision.flow.volumeRatio,
    volume24hSol: decision.flow.volume24hSol,
    drawdown24h: decision.flow.drawdown24h,
  };
  if (d.amount !== undefined) {
    // Lamports for buys, token base units for sells.
    detail[d.action === "buy" ? "amountSol" : "amountTokens"] = d.action === "buy" ? Number(d.amount) / LAMPORTS_PER_SOL : Number(d.amount) / 1e6;
  }
  if (d.error) detail.error = d.error;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") detail[k] = v;
    else if (typeof v === "bigint") detail[k] = v.toString();
  }
  return detail;
}
