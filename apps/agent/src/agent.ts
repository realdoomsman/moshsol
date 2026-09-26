import { SYSVAR_CLOCK_PUBKEY, type Keypair, type PublicKey, type TransactionError } from "@solana/web3.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  describeError,
  launchPda,
  type LaunchAccount,
  type MoshClient,
} from "@moshsol/sdk";
import type { AgentConfig } from "./config";
import { log } from "./log";
import type { Decision, StatusSnapshot } from "./status";
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
}

function clockUnixTs(data: Buffer): bigint {
  // Clock sysvar: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64.
  return data.readBigInt64LE(32);
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class Agent {
  private readonly runtime = new Map<string, LaunchRuntime>();
  private readonly decisions = new Map<string, Decision>();
  private readonly startedAt = nowSec();
  private readonly sizing: Sizing;
  private lastTickAt: number | null = null;
  private tickCount = 0;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly client: MoshClient,
    private readonly signer: Keypair,
  ) {
    this.sizing = {
      minTradeLamports: cfg.minTradeLamports,
      maxFractionBps: cfg.maxFractionBps,
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
      decisions: [...this.decisions.values()],
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
    const [platform, launches, clock] = await Promise.all([
      this.client.fetchPlatform(),
      this.client.program.account.launch.all([
        { memcmp: { offset: LAUNCH_STATUS_OFFSET, bytes: LIVE_STATUS_BS58 } },
      ]),
      this.client.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
    ]);
    if (!platform) throw new Error("platform account not found (is the program initialized on this cluster?)");
    if (!clock) throw new Error("clock sysvar unavailable");
    const now = clockUnixTs(clock.data);

    let skipReason: string | undefined;
    if (platform.params.agentsPaused) skipReason = "agents paused by platform";
    else if (!platform.agentAuthority.equals(this.signer.publicKey)) {
      skipReason = `this key is not the platform agent authority (${platform.agentAuthority.toBase58()})`;
    }

    launches.sort((a, b) => a.account.index.cmp(b.account.index));
    const live = new Set<string>();
    for (const { account } of launches) {
      if (signal.aborted) break;
      const mint = account.mint.toBase58();
      live.add(mint);
      await this.handle(account, now, skipReason);
    }
    if (!signal.aborted) {
      for (const mint of [...this.decisions.keys()]) if (!live.has(mint)) this.decisions.delete(mint);
      for (const mint of [...this.runtime.keys()]) if (!live.has(mint)) this.runtime.delete(mint);
    }
    this.lastTickAt = nowSec();
    this.tickCount += 1;
  }

  private async handle(account: LaunchAccount, now: bigint, skipReason?: string): Promise<void> {
    const mint = account.mint;
    const key = mint.toBase58();
    let rt = this.runtime.get(key);
    if (!rt) {
      rt = { nextTradeAt: 0, failures: 0 };
      this.runtime.set(key, rt);
    }
    if (rt.symbol === undefined) {
      rt.symbol = await this.client
        .fetchTokenMeta(mint)
        .then((m) => m?.symbol)
        .catch(() => undefined);
    }

    let ev = evaluate(marketOf(account), this.sizing, now);
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
    ev = evaluate(marketOf(fresh), this.sizing, clockUnixTs(clockInfo.data));
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
    const amount = plan.amount.toString();
    const extra = { expectedOut: plan.expectedOut, minOut: plan.minOut, impactBps: plan.impactBps };
    try {
      const ix =
        plan.action === "buy"
          ? await this.client.agentBuyIx(agent, mint, plan.amount, plan.minOut)
          : await this.client.agentSellIx(agent, mint, plan.amount, plan.minOut);
      const { tx, blockhash, lastValidBlockHeight } = await this.client.buildTx(agent, [ix], {
        computeUnits: this.cfg.computeUnits,
        priorityMicroLamports: this.cfg.priorityMicroLamports,
      });
      tx.sign(this.signer);
      const connection = this.client.connection;
      const signature = await connection.sendRawTransaction(tx.serialize());
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw await this.failure(signature, res.value.err);

      rt.failures = 0;
      rt.lastError = undefined;
      rt.nextTradeAt = Date.now() + this.cfg.cooldownMs;
      const fill = await this.fillOf(signature);
      this.record(rt, key, ev, { action: plan.action, reason: plan.reason, amount, signature }, plan.kind, { ...extra, ...fill });
    } catch (err) {
      const error = describeError(err);
      rt.failures += 1;
      rt.lastError = error;
      const backoff = Math.min(this.cfg.cooldownMs * 2 ** (rt.failures - 1), this.cfg.maxBackoffMs);
      rt.nextTradeAt = Date.now() + backoff;
      this.record(rt, key, ev, { action: plan.action, reason: plan.reason, amount, error }, "error", { ...extra, retryInMs: backoff });
    }
  }

  /** Error carrying the transaction logs so `describeError` can map the program error. */
  private async failure(signature: string, err: TransactionError): Promise<Error> {
    const tx = await this.client.connection
      .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    return Object.assign(new Error(`transaction ${signature} failed: ${JSON.stringify(err)}`), {
      logs: tx?.meta?.logMessages ?? [],
    });
  }

  /** Actual fill and resulting vault balances from the emitted `trade` event (log detail only). */
  private async fillOf(signature: string): Promise<Record<string, string>> {
    const tx = await this.client.connection
      .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    const trade = this.client.parseEvents(tx?.meta?.logMessages ?? []).find((e) => e.name === "trade");
    if (!trade || trade.name !== "trade") return {};
    const d = trade.data;
    return {
      filledSol: d.solAmount.toString(),
      filledTokens: d.tokenAmount.toString(),
      vaultSol: d.vaultSol.toString(),
      vaultTokens: d.vaultTokens.toString(),
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
