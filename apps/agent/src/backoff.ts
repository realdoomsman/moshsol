import { SAME_SLOT_TRADE_MESSAGE, TransactionFailedError, describeError } from "@holdfast/sdk";

/**
 * Per-side (buy / sell) back-off after a failed trade send: a failing buy never holds a sell back, or the reverse.
 * How long a side waits depends on why the send failed:
 * - `program`: a program rule rejected the transaction, in simulation or landed (`AgentBuyNotDip`, `ExceededSlippage`,
 *   `InvalidArgument`, …). The same plan on the same state fails the same way and waiting longer changes nothing, so
 *   the side re-plans on the next state change (a launch or venue update from a later slot than the failure saw),
 *   and at the latest after PROGRAM_RETRY_MS. No exponential growth.
 * - `same_slot`: a public trade landed in the slot first (anti-sandwich rule); the next decision lands later, no wait.
 * - `transport`: the way out failed, not the plan (RPC 429 / 5xx, timeouts, Sender errors, an expired blockhash):
 *   exponential from TRANSPORT_BACKOFF_MS, doubling per consecutive transport failure of the side, up to
 *   MAX_TRANSPORT_BACKOFF_MS.
 * The cooldown after a landed trade is not a back-off: it is per launch (`COOLDOWN_MS`, agent.ts).
 */

export type Side = "buy" | "sell";
export type FailureKind = "program" | "same_slot" | "transport";

/** Longest a side waits after a program rejection when no state change comes first. */
export const PROGRAM_RETRY_MS = 5_000;
/** First transport back-off step, doubled per consecutive transport failure… */
export const TRANSPORT_BACKOFF_MS = 2_000;
/** …up to this. */
export const MAX_TRANSPORT_BACKOFF_MS = 30_000;

/** Why a send failed: a `TransactionFailedError` carries a program (or runtime) rejection; anything else is the path. */
export function failureKind(err: unknown): FailureKind {
  if (err instanceof TransactionFailedError) return describeError(err) === SAME_SLOT_TRADE_MESSAGE ? "same_slot" : "program";
  return "transport";
}

interface SideState {
  /** Wall-clock ms before which the side sends nothing (0 = free). */
  until: number;
  /** After a program rejection: the slot of the newest state change seen then; a change in a later slot lifts the wait. */
  liftAfterSlot: number | null;
  /** Consecutive transport failures (the exponent of the next transport wait). */
  transport: number;
  kind: FailureKind | null;
  /** The last failure's message, until a send of the side lands. */
  error: string | null;
}

export interface SideWait {
  /** Ms left (0 = the side may send). */
  ms: number;
  kind: FailureKind | null;
  error: string | null;
}

const idle = (): SideState => ({ until: 0, liftAfterSlot: null, transport: 0, kind: null, error: null });

export class TradeBackoff {
  private readonly sides: Record<Side, SideState> = { buy: idle(), sell: idle() };

  /**
   * A send of `side` failed with `err`; `changeSlot` = the slot of the newest launch / venue change seen so far, `now` = wall-clock ms.
   * Returns the failure's kind, message and the longest wait it imposes (a program rejection may end sooner).
   */
  failed(side: Side, err: unknown, changeSlot: number, now: number): { kind: FailureKind; error: string; retryInMs: number } {
    const s = this.sides[side];
    const kind = failureKind(err);
    const error = describeError(err);
    let retryInMs = 0;
    if (kind === "transport") {
      retryInMs = Math.min(TRANSPORT_BACKOFF_MS * 2 ** s.transport, MAX_TRANSPORT_BACKOFF_MS);
      s.transport += 1;
    } else if (kind === "program") {
      retryInMs = PROGRAM_RETRY_MS;
    }
    s.until = now + retryInMs;
    s.liftAfterSlot = kind === "program" ? changeSlot : null;
    s.kind = kind;
    s.error = error;
    return { kind, error, retryInMs };
  }

  /** A send of `side` landed: its wait, transport exponent and error are cleared. */
  landed(side: Side): void {
    this.sides[side] = idle();
  }

  /** The market wants no trade right now: the transport exponents start over (a pending wait still runs out). */
  calm(): void {
    this.sides.buy.transport = 0;
    this.sides.sell.transport = 0;
  }

  /** What `side` still has to wait when the newest state change seen is from `changeSlot`. */
  wait(side: Side, changeSlot: number, now: number): SideWait {
    const s = this.sides[side];
    const lifted = s.liftAfterSlot !== null && changeSlot > s.liftAfterSlot;
    const ms = s.until > now && !lifted ? s.until - now : 0;
    return { ms, kind: s.kind, error: s.error };
  }
}
