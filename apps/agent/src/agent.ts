import { LAMPORTS_PER_SOL, SYSVAR_CLOCK_PUBKEY, type AccountInfo, type Keypair, type PublicKey } from "@solana/web3.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SAME_SLOT_TRADE_MESSAGE,
  describeError,
  launchToJson,
  pumpRefOf,
  q64ToSolPerToken,
  type LaunchAccount,
  type LaunchJson,
  type MoshClient,
  type VenueState,
} from "@holdfast/sdk";
import type { ActivityItem, ActivityLog } from "./activity";
import { LookupTable } from "./alt";
import type { AgentConfig } from "./config";
import { Cranks, type CrankLaunch } from "./cranks";
import { FlowWindow, NEUTRAL_FLOW, displayFlow, type FlowFeatures } from "./flow";
import { log } from "./log";
import { landed, sendIxs } from "./send";
import type { Decision, StatusSnapshot } from "./status";
import {
  displayPrices,
  evaluate,
  marketOf,
  type DisplayPrices,
  type Evaluation,
  type StrategyParams,
  type TradePlan,
  type Sizing,
} from "./strategy";
import { decodeVenue, venueKeys } from "./venue";

/** Byte offset of `Launch.status`: discriminator(8) + index u64(8) + creator(32) + mint(32). */
const LAUNCH_STATUS_OFFSET = 80;
/** base58 of the single byte 0x01 = `LaunchStatus::Live`. */
const LIVE_STATUS_BS58 = "2";
/** Upper bound on the whole-loop retry delay after RPC failures. */
const MAX_TICK_BACKOFF_MS = 60_000;
/** Below this the agent cannot keep paying transaction fees for long. */
const LOW_BALANCE_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
/** `getMultipleAccountsInfo` accepts at most this many keys per call. */
const MAX_BATCH_KEYS = 100;

interface LaunchRuntime {
  symbol?: string;
  /** Wall-clock ms before which no trade is sent (cooldown after a trade, or error backoff). */
  nextTradeAt: number;
  /** Consecutive failed sends (sizes the backoff); reset by a success or when the market no longer wants a trade. */
  failures: number;
  /** Last send error; cleared only by a successful trade, so a pending wait is known to be an error backoff. */
  lastError?: string;
  /** Kind of the last logged decision; repeated holds/skips of the same kind are not re-logged. */
  loggedKind?: string;
  /** Public flow between polls, from Launch account deltas (one observation per tick). */
  flow: FlowWindow;
}

function clockUnixTs(data: Buffer): bigint {
  // Clock sysvar: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64.
  return data.readBigInt64LE(32);
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class Agent {
  /** Keyed by launch address (pump launches share the default mint until `launch_pump`). */
  private readonly runtime = new Map<string, LaunchRuntime>();
  private readonly decisions = new Map<string, Decision>();
  private readonly startedAt = nowSec();
  private readonly sizing: Sizing;
  private readonly alt: LookupTable;
  private readonly cranks: Cranks;
  /** Policy in force; replaced by the research loop when a proposal beats it walk-forward (`setStrategy`). */
  private strategy: StrategyParams;
  private lastTickAt: number | null = null;
  private tickCount = 0;
  /** Fee wallet balance as of the last tick; `low_balance` is logged each time it falls under the threshold. */
  private balanceLamports: number | null = null;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly client: MoshClient,
    private readonly signer: Keypair,
    private readonly activity: ActivityLog,
  ) {
    this.sizing = {
      minTradeLamports: cfg.minTradeLamports,
      slippageBps: cfg.slippageBps,
    };
    this.strategy = cfg.strategy;
    this.alt = new LookupTable(client.connection, signer, cfg.priorityFee, cfg.altFile, cfg.alt, client.programId);
    this.cranks = new Cranks(cfg, client, signer, this.alt, activity);
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
    };
  }

  /** Polls until `signal` aborts; an in-flight send is always allowed to finish. */
  async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
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
  }

  private async tick(signal: AbortSignal): Promise<void> {
    const [platform, launches, clock, balance] = await Promise.all([
      this.client.fetchPlatform(),
      this.client.program.account.launch.all([
        { memcmp: { offset: LAUNCH_STATUS_OFFSET, bytes: LIVE_STATUS_BS58 } },
      ]),
      this.client.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
      this.client.connection.getBalance(this.signer.publicKey, "confirmed"),
    ]);
    if (!platform) throw new Error("platform account not found (is the program initialized on this cluster?)");
    if (!clock) throw new Error("clock sysvar unavailable");
    const now = clockUnixTs(clock.data);
    const wasLow = this.balanceLamports !== null && this.balanceLamports < LOW_BALANCE_LAMPORTS;
    this.balanceLamports = balance;
    if (balance < LOW_BALANCE_LAMPORTS && !wasLow && !this.cfg.dryRun) {
      log("low_balance", { agent: this.signer.publicKey.toBase58(), sol: balance / LAMPORTS_PER_SOL });
    }

    let skipReason: string | undefined;
    if (platform.params.agentsPaused) skipReason = "agents paused by platform";
    else if (!platform.agentAuthority.equals(this.signer.publicKey)) {
      skipReason = `this key is not the platform agent authority (${platform.agentAuthority.toBase58()})`;
    }

    const all = launches.map(({ publicKey, account }) => ({ address: publicKey, account, json: launchToJson(publicKey, account) }));
    const venues = await this.fetchVenues(all.filter((l) => l.json.venue === "pump").map((l) => l.json));
    const live = new Set<string>();
    for (const { address, account, json } of all) {
      if (signal.aborted) break;
      const key = address.toBase58();
      const rt = await this.runtimeOf(key, account);
      const launch: CrankLaunch = { address, account, json, symbol: rt.symbol };
      // Wound down = no longer Live: its decision and runtime are dropped below.
      if (await this.cranks.windDown(launch, now)) continue;
      live.add(key);
      const venue = venues.get(key) ?? null;
      if (json.venue === "pump") await this.cranks.pump(launch, platform, venue, now);
      await this.handle(rt, launch, venue, now, skipReason);
    }
    if (!signal.aborted) {
      for (const key of [...this.decisions.keys()]) if (!live.has(key)) this.decisions.delete(key);
      for (const key of [...this.runtime.keys()]) if (!live.has(key)) this.runtime.delete(key);
      this.cranks.retain(live);
      this.activity.forget(live);
    }
    this.lastTickAt = nowSec();
    this.tickCount += 1;
  }

  /** Venue state of every live pump launch, keyed by launch address, from one batched read. */
  private async fetchVenues(pump: LaunchJson[]): Promise<Map<string, VenueState | null>> {
    const keys = pump.flatMap((l) => venueKeys(l));
    const infos: (AccountInfo<Buffer> | null)[] = [];
    for (let i = 0; i < keys.length; i += MAX_BATCH_KEYS) {
      infos.push(...(await this.client.connection.getMultipleAccountsInfo(keys.slice(i, i + MAX_BATCH_KEYS), "confirmed")));
    }
    const venues = new Map<string, VenueState | null>();
    let at = 0;
    for (const l of pump) {
      const n = venueKeys(l).length;
      venues.set(l.address, decodeVenue(l, infos.slice(at, at + n)));
      at += n;
    }
    return venues;
  }

  private async runtimeOf(key: string, account: LaunchAccount): Promise<LaunchRuntime> {
    let rt = this.runtime.get(key);
    if (!rt) {
      rt = { nextTradeAt: 0, failures: 0, flow: new FlowWindow() };
      this.runtime.set(key, rt);
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

  private async handle(rt: LaunchRuntime, l: CrankLaunch, venue: VenueState | null, now: bigint, skipReason?: string): Promise<void> {
    const { account, json } = l;
    const pump = json.venue === "pump";
    if (pump && !venue) {
      const prices = { priceSol: 0, emaSol: q64ToSolPerToken(BigInt(json.emaPriceQ64)), bandLowSol: 0, bandHighSol: 0 };
      const where = json.pump.graduated ? "PumpSwap pool token accounts" : "pump.fun bonding curve";
      this.record(rt, l, prices, NEUTRAL_FLOW, { action: "skip", reason: `venue account missing (${where} not found)` }, "no_venue");
      return;
    }
    const market = marketOf(account, venue?.curve);
    const flow = rt.flow.observe(market, now);
    let ev = evaluate(market, this.sizing, now, this.strategy, flow);
    if (skipReason) {
      this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason: skipReason }, "paused");
      return;
    }
    // Backer payouts are signed by the agent and only sent into a strong market (never a dip): decided on the
    // same projection and flow the trade decision used.
    await this.cranks.payout(l, market, ev.projection, flow, now, this.strategy);
    if (venue?.complete) {
      const reason = "bonding curve complete, awaiting pump.fun migration (then graduate_pump)";
      this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason }, "complete");
      return;
    }
    if (ev.plan.action === "hold") {
      rt.failures = 0;
      this.record(rt, l, displayPrices(ev.projection), flow, { action: "hold", reason: ev.plan.reason }, ev.plan.kind);
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
      });
      return;
    }
    const waitMs = rt.nextTradeAt - Date.now();
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      if (rt.lastError !== undefined) {
        const reason = `backing off after error, retry in ${secs}s; wants ${ev.plan.reason}`;
        this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason, error: rt.lastError }, "backoff");
      } else {
        const reason = `cooldown after last trade, ${secs}s left; wants ${ev.plan.reason}`;
        this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason }, "cooldown");
      }
      return;
    }

    // Re-read the launch, the clock and the venue in one slot right before sending so the plan matches
    // what the program will see (the tick snapshot can be seconds old after earlier sends).
    const [launchInfo, clockInfo, ...venueInfos] = await this.client.connection.getMultipleAccountsInfo(
      [l.address, SYSVAR_CLOCK_PUBKEY, ...(pump ? venueKeys(json) : [])],
      "confirmed",
    );
    if (!launchInfo || !clockInfo) throw new Error(`launch ${json.address} or clock vanished during refresh`);
    const fresh = this.client.program.coder.accounts.decode<LaunchAccount>("launch", launchInfo.data);
    const freshJson = launchToJson(l.address, fresh);
    let freshVenue: VenueState | null = null;
    if (pump) {
      freshVenue = freshJson.pump.graduated === json.pump.graduated ? decodeVenue(freshJson, venueInfos) : null;
      if (!freshVenue || freshVenue.complete) {
        const reason = freshVenue ? "bonding curve completed during refresh" : "venue changed during refresh (graduation or missing account), re-planning next poll";
        this.record(rt, l, displayPrices(ev.projection), flow, { action: "skip", reason }, "venue_changed");
        return;
      }
    }
    ev = evaluate(marketOf(fresh, freshVenue?.curve), this.sizing, clockUnixTs(clockInfo.data), this.strategy, flow);
    const plan = ev.plan;
    if (plan.action === "hold") {
      rt.failures = 0;
      this.record(rt, l, displayPrices(ev.projection), flow, { action: "hold", reason: plan.reason }, plan.kind);
      return;
    }
    await this.execute(rt, { ...l, account: fresh, json: freshJson }, ev, flow, plan);
  }

  private async execute(rt: LaunchRuntime, l: CrankLaunch, ev: Evaluation, flow: FlowFeatures, plan: TradePlan): Promise<void> {
    const amount = plan.amount.toString();
    const prices = displayPrices(ev.projection);
    let extra: Record<string, unknown> = { expectedOut: plan.expectedOut, minOut: plan.minOut, impactBps: plan.impactBps, support: plan.support ?? false };
    try {
      const ix = await this.tradeIx(l, plan);
      const sent = await sendIxs(this.client.connection, this.signer, [ix], this.cfg.priorityFee, this.alt);
      extra = { ...extra, ...sent.cost };

      rt.failures = 0;
      rt.lastError = undefined;
      rt.nextTradeAt = Date.now() + this.cfg.cooldownMs;
      const result = await landed(this.client, sent.signature);
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
      this.record(rt, l, prices, flow, { action: plan.action, reason: plan.reason, amount, signature: sent.signature }, plan.kind, {
        ...extra,
        ...result?.cost,
        ...fill,
      });
    } catch (err) {
      const error = describeError(err);
      rt.lastError = error;
      // A public trade landed in the same slot first (anti-sandwich rule): nothing is wrong, the next poll lands
      // in a later slot, so retry then instead of backing off.
      const backoff =
        error === SAME_SLOT_TRADE_MESSAGE ? 0 : Math.min(this.cfg.cooldownMs * 2 ** rt.failures++, this.cfg.maxBackoffMs);
      rt.nextTradeAt = Date.now() + backoff;
      this.record(rt, l, prices, flow, { action: plan.action, reason: plan.reason, amount, error }, "error", { ...extra, retryInMs: backoff });
    }
  }

  /** `agent_buy` / `agent_sell` on the launch's venue. */
  private tradeIx(l: CrankLaunch, plan: TradePlan) {
    const agent = this.signer.publicKey;
    if (l.json.venue === "pump") {
      const ref = pumpRefOf(l.json);
      return plan.action === "buy"
        ? this.client.agentBuyPumpIx(agent, ref, plan.amount, plan.minOut)
        : this.client.agentSellPumpIx(agent, ref, plan.amount, plan.minOut);
    }
    return plan.action === "buy"
      ? this.client.agentBuyIx(agent, l.account.mint, plan.amount, plan.minOut)
      : this.client.agentSellIx(agent, l.account.mint, plan.amount, plan.minOut);
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
