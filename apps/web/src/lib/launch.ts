import { LAUNCH_GRACE_SECS, type LaunchJson, type LaunchVenue } from "@holdfast/sdk";

/**
 * What identifies a launch in URLs, API paths and query keys: its address on pump launches (no mint
 * while raising), its mint on Holdfast launches. Launch rows carry the address as `address`,
 * activity events as `launch`.
 */
export type LaunchRef = Pick<LaunchJson, "venue" | "mint"> & ({ address: string } | { launch: string });

export function launchId(l: LaunchRef): string {
  if (l.venue !== "pump") return l.mint;
  return "address" in l ? l.address : l.launch;
}

export function launchHref(l: LaunchRef): string {
  return `/launch/${launchId(l)}`;
}

/** Where a pump launch trades: its pump.fun curve, or PumpSwap once graduated. */
export function pumpTradeUrl(l: Pick<LaunchJson, "mint" | "pump">): string {
  return l.pump.graduated ? `https://swap.pump.fun/?input=sol&output=${l.mint}` : `https://pump.fun/coin/${l.mint}`;
}

export type VenueKind = "holdfast" | "pump-curve" | "pumpswap";

export function venueKindOf(l: Pick<LaunchJson, "venue" | "pump">): VenueKind {
  return l.venue === "holdfast" ? "holdfast" : l.pump.graduated ? "pumpswap" : "pump-curve";
}

export const VENUE_LABEL: Record<VenueKind, string> = {
  holdfast: "Holdfast curve",
  "pump-curve": "pump.fun curve",
  pumpswap: "PumpSwap",
};

/**
 * UI lifecycle derived from on-chain status plus the clock. A raise still `raising` on-chain is "failed"
 * (refundable) once its deadline passed below the minimum, or once `LAUNCH_GRACE_SECS` past the deadline
 * nobody launched it; the first refund flips it on-chain.
 */
export type Phase = "raising" | "ready" | "failed" | "live" | "refunding" | "woundDown";

export function phaseOf(
  l: Pick<LaunchJson, "status" | "raised" | "raiseMin" | "raiseMax" | "raiseDeadline">,
  nowSec: number,
): Phase {
  if (l.status !== "raising") return l.status;
  const raised = BigInt(l.raised);
  const minMet = raised >= BigInt(l.raiseMin);
  const closed = nowSec >= l.raiseDeadline;
  if (closed && (!minMet || nowSec >= l.raiseDeadline + LAUNCH_GRACE_SECS)) return "failed";
  if (minMet && (closed || raised >= BigInt(l.raiseMax))) return "ready";
  return "raising";
}

export const PHASE_LABEL: Record<Phase, string> = {
  raising: "Raising",
  ready: "Ready to launch",
  failed: "Raise failed",
  live: "Live",
  refunding: "Refunding",
  woundDown: "Wound down",
};

/**
 * A refunding raise the creator cancelled (still before its deadline, or past its minimum before the launch
 * window closed) rather than one that missed its minimum or wasn't launched in time. The program keeps no
 * reason; this reads it off the numbers.
 */
export function wasCancelled(l: Pick<LaunchJson, "status" | "raised" | "raiseMin" | "raiseDeadline">, nowSec: number): boolean {
  if (l.status !== "refunding") return false;
  return l.raiseDeadline > nowSec || (BigInt(l.raised) >= BigInt(l.raiseMin) && nowSec < l.raiseDeadline + LAUNCH_GRACE_SECS);
}

/** What a closed raise still owes its backers: nothing was deposited, every deposit is back, or refunds are open. */
export type RefundState = "none" | "done" | "open";

export function refundState(l: Pick<LaunchJson, "raised" | "refunded">): RefundState {
  const raised = BigInt(l.raised);
  if (raised === 0n) return "none";
  return BigInt(l.refunded) >= raised ? "done" : "open";
}

export const REFUND_STATE_LABEL: Record<RefundState, string> = {
  none: "No deposits",
  done: "All refunded",
  open: "Refunds open",
};

/** One line under the status chip: what a visitor can do on this launch right now. */
export function phaseExplainer(phase: Phase, venue: LaunchVenue): string {
  const where = venue === "pump" ? "on pump.fun" : "here, on the Holdfast curve";
  switch (phase) {
    case "raising":
      return "Raising: you can put SOL in now. If the minimum isn't met by the deadline, you get 100% back.";
    case "ready":
      return `Minimum met and the raise is closed to new deposits. Anyone can launch it ${venue === "pump" ? "on pump.fun " : ""}now; the backers' SOL then makes the first buy. If nobody does within ${LAUNCH_GRACE_SECS / 86_400} days of the deadline, every backer gets 100% back.`;
    case "failed":
      return "The raise missed its minimum, or nobody launched it in time. Every backer gets 100% of their deposit back from this page.";
    case "refunding":
      return "Refunding: this raise was cancelled, missed its minimum or wasn't launched in time. Every backer gets 100% of their deposit back from this page.";
    case "live":
      return `Live: buy or sell ${where}. The vault agent holds the backers' bundle, selling into strength and buying back dips; once the vault is well above its start it may pay backers back.`;
    case "woundDown":
      return "Wound down: trading is over. Backers claim their share of the vault's SOL from this page.";
  }
}
