import type { LaunchJson } from "@holdfast/sdk";

/** UI lifecycle derived from on-chain status plus the clock. */
export type Phase = "raising" | "ready" | "failed" | "live" | "refunding" | "woundDown";

export function phaseOf(
  l: Pick<LaunchJson, "status" | "raised" | "raiseMin" | "raiseMax" | "raiseDeadline">,
  nowSec: number,
): Phase {
  if (l.status !== "raising") return l.status;
  const raised = BigInt(l.raised);
  const minMet = raised >= BigInt(l.raiseMin);
  const closed = nowSec >= l.raiseDeadline;
  if (closed && !minMet) return "failed";
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
