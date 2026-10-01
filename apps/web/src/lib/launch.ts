import type { LaunchJson } from "@holdfast/sdk";

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
