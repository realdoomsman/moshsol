import { LAMPORTS_PER_SOL, SYSVAR_CLOCK_PUBKEY, type Keypair, type PublicKey } from "@solana/web3.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SAME_SLOT_TRADE_MESSAGE,
  WIND_DOWN_IDLE_SECS,
  describeError,
  launchPda,
  prepareTx,
  sendAndConfirm,
  statusOf,
  windDownTimingBlocker,
  type LaunchAccount,
  type MoshClient,
  type MoshEvent,
} from "@holdfast/sdk";
import type { AgentConfig } from "./config";
import { log } from "./log";
import type { Decision, StatusSnapshot, WindDown } from "./status";
import {
  displayPrices,
  evaluate,
  marketOf,
  type Evaluation,
  type TradePlan,
  type Sizing,
} from "./strategy";

/** Byte offset of `Launch.status`: discriminator(8) + index u64(8) + creator(32) + mint(32). */
const LAUNCH_STATUS_OFFSET = 80;
/** base58 of the single byte 0x01 = `LaunchStatus::Live`. */
const LIVE_STATUS_BS58 = "2";
/** Upper bound on the whole-loop retry delay after RPC failures. */
const MAX_TICK_BACKOFF_MS = 60_000;
/** Below this the agent cannot keep paying transaction fees for long. */
const LOW_BALANCE_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
/**
 * Wait before re-reading balances of a launch that passes the wind-down timing rules but still has outside
 * holders (only a burn or a transfer back to the curve/vault can clear that without a trade), and the first
 * back-off step after a failed `wind_down` send; failures double it up to WIND_DOWN_IDLE_SECS.
 */
const WIND_DOWN_RECHECK_MS = 10 * 60_000;
/** Wind-down attempts kept for `GET /status`, newest first. */
const MAX_WIND_DOWNS = 50;

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
  /** Wall-clock ms before which the wind-down crank neither re-reads balances nor re-sends. */
  windDownAt: number;
  /** Consecutive failed `wind_down` sends (sizes their back-off). */
  windDownFailures: number;
}

function clockUnixTs(data: Buffer): bigint {
  // Clock sysvar: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64.
  return data.readBigInt64LE(32);
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class Agent {
  private readonly runtime = new Map<string, LaunchRuntime>();
  private readonly decisions = new Map<string, Decision>();
  /** Wind-down crank attempts, newest first, at most MAX_WIND_DOWNS. */
  private readonly windDowns: WindDown[] = [];
  private readonly startedAt = nowSec();
  private readonly sizing: Sizing;
  private lastTickAt: number | null = null;
  private tickCount = 0;
  /** Fee wallet balance as of the last tick; `low_balance` is logged each time it falls under the threshold. */
  private balanceLamports: number | null = null;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly client: MoshClient,
    private readonly signer: Keypair,
  ) {
    this.sizing = {
      minTradeLamports: cfg.minTradeLamports,
      slippageBps: cfg.slippageBps,
    };
  }

  snapshot(): StatusSnapshot {
    return {
      agent: this.signer.publicKey.toBase58(),
      dryRun: this.cfg.dryRun,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      tick: this.tickCount,
      balanceSol: this.balanceLamports === null ? null : this.balanceLamports / LAMPORTS_PER_SOL,
      decisions: [...this.decisions.values()],
      windDowns: [...this.windDowns],
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

    launches.sort((a, b) => a.account.index.cmp(b.account.index));
    const live = new Set<string>();
    for (const { account } of launches) {
      if (signal.aborted) break;
      const key = account.mint.toBase58();
      const rt = await this.runtimeOf(account.mint, key);
      // Wound down = no longer Live: its decision and runtime are dropped below.
      if (await this.windDown(rt, key, account, now)) continue;
      live.add(key);
      await this.handle(rt, key, account, now, skipReason);
    }
    if (!signal.aborted) {
      for (const mint of [...this.decisions.keys()]) if (!live.has(mint)) this.decisions.delete(mint);
      for (const mint of [...this.runtime.keys()]) if (!live.has(mint)) this.runtime.delete(mint);
    }
    this.lastTickAt = nowSec();
    this.tickCount += 1;
  }

  private async runtimeOf(mint: PublicKey, key: string): Promise<LaunchRuntime> {
    let rt = this.runtime.get(key);
    if (!rt) {
      rt = { nextTradeAt: 0, failures: 0, windDownAt: 0, windDownFailures: 0 };
      this.runtime.set(key, rt);
    }
    if (rt.symbol === undefined) {
      rt.symbol = await this.client
        .fetchTokenMeta(mint)
        .then((m) => m?.symbol)
        .catch(() => undefined);
    }
    return rt;
  }

  /**
   * Permissionless `wind_down` crank (independent of agent pauses and of which key is the agent authority). The
   * launch's age and idle time are checked against the tick snapshot first (no RPC); balances are read only once
   * those pass, at most every WIND_DOWN_RECHECK_MS, and a failed send backs off from there. Returns true when the
   * launch was wound down.
   */
  private async windDown(rt: LaunchRuntime, key: string, account: LaunchAccount, now: bigint): Promise<boolean> {
    const timing = { status: statusOf(account), launchedAt: account.launchedAt.toNumber(), lastTradeTs: account.lastTradeTs.toNumber() };
    if (windDownTimingBlocker(timing, Number(now)) !== null || Date.now() < rt.windDownAt) return false;
    const blocker = await this.client.windDownBlocker(account.mint, Number(now));
    if (blocker !== null) {
      rt.windDownAt = Date.now() + WIND_DOWN_RECHECK_MS;
      return false;
    }
    const attempt: WindDown = { mint: key, symbol: rt.symbol, at: nowSec() };
    if (this.cfg.dryRun) {
      rt.windDownAt = Date.now() + WIND_DOWN_RECHECK_MS;
      this.recordWindDown(attempt, { dryRun: true });
      return false;
    }
    const cranker = this.signer.publicKey;
    const connection = this.client.connection;
    try {
      const ix = await this.client.windDownIx(cranker, account.mint);
      const prepared = await prepareTx(connection, cranker, [ix], this.cfg.priorityFee);
      prepared.tx.sign(this.signer);
      const signature = await sendAndConfirm(connection, prepared.tx.serialize(), prepared.lastValidBlockHeight);
      const landed = await this.landed(signature);
      const event = landed?.events.find((e) => e.name === "woundDown");
      const result =
        event?.name === "woundDown"
          ? { solToBackers: event.data.solToBackers.toString(), tokensReturned: event.data.tokensReturned.toString() }
          : {};
      this.recordWindDown({ ...attempt, signature, ...result }, landed?.cost ?? {});
      return true;
    } catch (err) {
      const retryInMs = Math.min(WIND_DOWN_RECHECK_MS * 2 ** rt.windDownFailures++, WIND_DOWN_IDLE_SECS * 1000);
      rt.windDownAt = Date.now() + retryInMs;
      this.recordWindDown({ ...attempt, error: describeError(err) }, { retryInMs });
      return false;
    }
  }

  private recordWindDown(attempt: WindDown, extra: Record<string, unknown>): void {
    this.windDowns.unshift(attempt);
    this.windDowns.length = Math.min(this.windDowns.length, MAX_WIND_DOWNS);
    log("wind_down", { ...attempt, ...extra });
  }

  private async handle(rt: LaunchRuntime, key: string, account: LaunchAccount, now: bigint, skipReason?: string): Promise<void> {
    const mint = account.mint;

    let ev = evaluate(marketOf(account), this.sizing, now, this.cfg.strategy);
    if (skipReason) {
      this.record(rt, key, ev, { action: "skip", reason: skipReason }, "paused");
      return;
    }
    if (ev.plan.action === "hold") {
      rt.failures = 0;
      this.record(rt, key, ev, { action: "hold", reason: ev.plan.reason }, ev.plan.kind);
      return;
    }
    if (this.cfg.dryRun) {
      const plan = ev.plan;
      const reason = `dry run, not sent: ${plan.reason}`;
      this.record(rt, key, ev, { action: plan.action, reason, amount: plan.amount.toString() }, plan.kind, {
        expectedOut: plan.expectedOut,
        minOut: plan.minOut,
        impactBps: plan.impactBps,
      });
      return;
    }
    const waitMs = rt.nextTradeAt - Date.now();
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      if (rt.lastError !== undefined) {
        const reason = `backing off after error, retry in ${secs}s; wants ${ev.plan.reason}`;
        this.record(rt, key, ev, { action: "skip", reason, error: rt.lastError }, "backoff");
      } else {
        const reason = `cooldown after last trade, ${secs}s left; wants ${ev.plan.reason}`;
        this.record(rt, key, ev, { action: "skip", reason }, "cooldown");
      }
      return;
    }

    // Re-read the launch and the clock in one slot right before sending so the plan matches
    // what the program will see (the tick snapshot can be seconds old after earlier sends).
    const [launchInfo, clockInfo] = await this.client.connection.getMultipleAccountsInfo(
      [launchPda(mint, this.client.programId), SYSVAR_CLOCK_PUBKEY],
      "confirmed",
    );
    if (!launchInfo || !clockInfo) throw new Error(`launch ${key} or clock vanished during refresh`);
    const fresh = this.client.program.coder.accounts.decode<LaunchAccount>("launch", launchInfo.data);
    ev = evaluate(marketOf(fresh), this.sizing, clockUnixTs(clockInfo.data), this.cfg.strategy);
    const plan = ev.plan;
    if (plan.action === "hold") {
      rt.failures = 0;
      this.record(rt, key, ev, { action: "hold", reason: plan.reason }, plan.kind);
      return;
    }
    await this.execute(rt, key, mint, ev, plan);
  }

  private async execute(rt: LaunchRuntime, key: string, mint: PublicKey, ev: Evaluation, plan: TradePlan): Promise<void> {
    const agent = this.signer.publicKey;
    const connection = this.client.connection;
    const amount = plan.amount.toString();
    let extra: Record<string, unknown> = { expectedOut: plan.expectedOut, minOut: plan.minOut, impactBps: plan.impactBps };
    try {
      const ix =
        plan.action === "buy"
          ? await this.client.agentBuyIx(agent, mint, plan.amount, plan.minOut)
          : await this.client.agentSellIx(agent, mint, plan.amount, plan.minOut);
      const prepared = await prepareTx(connection, agent, [ix], this.cfg.priorityFee);
      const { tx, computeUnits, priorityMicroLamports } = prepared;
      extra = {
        ...extra,
        simulatedUnits: prepared.unitsConsumed,
        computeUnits,
        priorityMicroLamports,
        // What the runtime charges on top of the base fee: limit × price, rounded up.
        priorityFeeLamports: Math.ceil((computeUnits * priorityMicroLamports) / 1_000_000),
      };
      tx.sign(this.signer);
      const signature = await sendAndConfirm(connection, tx.serialize(), prepared.lastValidBlockHeight);

      rt.failures = 0;
      rt.lastError = undefined;
      rt.nextTradeAt = Date.now() + this.cfg.cooldownMs;
      const landed = await this.landed(signature);
      const events = landed?.events ?? [];
      const trade = events.find((e) => e.name === "trade");
      const profit = events.find((e) => e.name === "vaultProfitShared");
      const fill =
        trade?.name === "trade"
          ? {
              filledSol: trade.data.solAmount.toString(),
              filledTokens: trade.data.tokenAmount.toString(),
              vaultSol: trade.data.vaultSol.toString(),
              vaultTokens: trade.data.vaultTokens.toString(),
            }
          : {};
      const shared = profit?.name === "vaultProfitShared" ? { profitSharedLamports: profit.data.amount.toString() } : {};
      this.record(rt, key, ev, { action: plan.action, reason: plan.reason, amount, signature }, plan.kind, {
        ...extra,
        ...landed?.cost,
        ...fill,
        ...shared,
      });
    } catch (err) {
      const error = describeError(err);
      rt.lastError = error;
      // A public trade landed in the same slot first (anti-sandwich rule): nothing is wrong, the next poll lands
      // in a later slot, so retry then instead of backing off.
      const backoff =
        error === SAME_SLOT_TRADE_MESSAGE ? 0 : Math.min(this.cfg.cooldownMs * 2 ** rt.failures++, this.cfg.maxBackoffMs);
      rt.nextTradeAt = Date.now() + backoff;
      this.record(rt, key, ev, { action: plan.action, reason: plan.reason, amount, error }, "error", { ...extra, retryInMs: backoff });
    }
  }

  /** Compute used, fee paid and emitted events of a landed transaction (log detail only; null when unavailable). */
  private async landed(signature: string): Promise<{ cost: Record<string, unknown>; events: MoshEvent[] } | null> {
    const tx = await this.client.connection
      .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    if (!tx?.meta) return null;
    return {
      cost: { unitsConsumed: tx.meta.computeUnitsConsumed, feeLamports: tx.meta.fee },
      events: this.client.parseEvents(tx.meta.logMessages ?? []),
    };
  }

  private record(
    rt: LaunchRuntime,
    mint: string,
    ev: Evaluation,
    d: Pick<Decision, "action" | "reason" | "amount" | "signature" | "error">,
    kind: string,
    extra: Record<string, unknown> = {},
  ): void {
    const decision: Decision = { mint, symbol: rt.symbol, at: nowSec(), ...d, ...displayPrices(ev.projection) };
    this.decisions.set(mint, decision);
    const trade = d.action === "buy" || d.action === "sell";
    if (trade || rt.loggedKind !== kind) {
      rt.loggedKind = kind;
      log("decision", { ...decision, ...extra });
    }
  }
}
