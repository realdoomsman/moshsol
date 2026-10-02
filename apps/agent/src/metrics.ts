/**
 * Reaction-latency metrics for `GET /status` → `metrics`. Each stage keeps its latest MAX_SAMPLES samples (ms)
 * and reports n, p50, p95 and max over them:
 *
 * - `landToDecision`: a change landed on chain (the RPC node first reported its slot, `slotSubscribe`) → the
 *   agent's decision on it. Only stream-triggered decisions have a landing slot; heartbeat polls don't.
 * - `notify`: the slot first reported → the account notification carrying the change.
 * - `react`: the change seen by the agent (notification, or the heartbeat's read) → the decision (debounce +
 *   evaluation, plus the re-read when the stream is not trusted).
 * - `decisionToSent`: decision → the send accepted by the RPC / Sender (instruction, blockhash, fee, signing).
 * - `sentToLanded`: send → processed (signature notification or status poll); `sentToConfirmed`: → confirmed.
 *
 * `failures` counts failed trade sends by reason (`failureReason`): at most MAX_FAILURE_REASONS distinct keys, any
 * further reason counts under "other".
 */

import { TransactionExpiredError, TransactionFailedError, describeError } from "@holdfast/sdk";

const MAX_SAMPLES = 500;
/** Slots whose first-report time is remembered (≈ 13 min). */
const MAX_SLOTS = 2_048;
/** Distinct `failures` keys kept for `/status`. */
export const MAX_FAILURE_REASONS = 32;

/**
 * Stable key of a failed send: the program error when the logs name one, else the kind of failure without the
 * block height (expiry) or signature (landed failure) its message carries, so repeated failures aggregate.
 */
export function failureReason(err: unknown): string {
  if (err instanceof TransactionExpiredError) return "Transaction expired unconfirmed";
  if (err instanceof TransactionFailedError) return describeError({ message: `Transaction failed: ${JSON.stringify(err.txError)}`, logs: err.logs });
  return describeError(err);
}

export interface LatencySummary {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

class Latency {
  private readonly xs: number[] = [];

  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.xs.push(Math.round(ms));
    if (this.xs.length > MAX_SAMPLES) this.xs.shift();
  }

  summary(): LatencySummary {
    if (this.xs.length === 0) return { n: 0, p50: null, p95: null, max: null };
    const s = [...this.xs].sort((a, b) => a - b);
    // Nearest rank.
    const rank = (p: number) => s[Math.max(0, Math.ceil(p * s.length) - 1)]!;
    return { n: s.length, p50: rank(0.5), p95: rank(0.95), max: s[s.length - 1]! };
  }
}

export type Stage = "landToDecision" | "notify" | "react" | "decisionToSent" | "sentToLanded" | "sentToConfirmed";

const STAGES: Stage[] = ["landToDecision", "notify", "react", "decisionToSent", "sentToLanded", "sentToConfirmed"];

export interface MetricsSnapshot {
  latencyMs: Record<Stage, LatencySummary>;
  trades: { sent: number; landed: number; failed: number };
  failures: Record<string, number>;
}

export class Metrics {
  private readonly stages = Object.fromEntries(STAGES.map((s) => [s, new Latency()])) as Record<Stage, Latency>;
  private readonly slotSeen = new Map<number, number>();
  private readonly trades = { sent: 0, landed: 0, failed: 0 };
  private readonly failures = new Map<string, number>();

  add(stage: Stage, ms: number): void {
    this.stages[stage].add(ms);
  }

  /** First report of `slot` by the RPC node (`slotSubscribe`): when changes landing in it became visible. */
  slot(slot: number, at: number): void {
    if (this.slotSeen.has(slot)) return;
    this.slotSeen.set(slot, at);
    if (this.slotSeen.size > MAX_SLOTS) this.slotSeen.delete(this.slotSeen.keys().next().value!);
  }

  /** Wall-clock ms `slot` was first reported; undefined when it never was (or is too old). */
  slotAt(slot: number): number | undefined {
    return this.slotSeen.get(slot);
  }

  sent(): void {
    this.trades.sent += 1;
  }

  landed(): void {
    this.trades.landed += 1;
  }

  failed(err: unknown): void {
    this.trades.failed += 1;
    const reason = failureReason(err);
    // The last slot is "other": one more distinct reason would grow `/status` with every new message.
    const key = this.failures.has(reason) || this.failures.size < MAX_FAILURE_REASONS - 1 ? reason : "other";
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }

  snapshot(): MetricsSnapshot {
    return {
      latencyMs: Object.fromEntries(STAGES.map((s) => [s, this.stages[s].summary()])) as Record<Stage, LatencySummary>,
      trades: { ...this.trades },
      failures: Object.fromEntries(this.failures),
    };
  }
}
