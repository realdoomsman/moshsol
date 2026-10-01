import { lamportsToSol, TOTAL_SUPPLY } from "@holdfast/sdk";
import type { LaunchChipStatus } from "@/components/ui/chip";
import { pctOf } from "@/lib/format";
import { phaseOf, refundState } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";

/** Board lanes (§4.4): open raises, raises past their minimum (launchable), trading launches. */
export type Lane = "raising" | "min" | "live";

export const LANES: { value: Lane; label: string; short: string }[] = [
  { value: "raising", label: "Raising", short: "Raising" },
  { value: "min", label: "Min reached · launching", short: "Launching" },
  { value: "live", label: "Live", short: "Live" },
];

/** Which lane a launch sits in; `null` = off the board (failed or refunding raises, wound-down launches). */
export function laneOf(l: LaunchSummary, now: number): Lane | null {
  const phase = phaseOf(l, now);
  if (phase === "live") return "live";
  if (phase === "ready") return "min";
  if (phase === "raising") return BigInt(l.raised) >= BigInt(l.raiseMin) ? "min" : "raising";
  return null;
}

/** The one chip every surface shows for a launch (cards, tables, token header): a missed raise is "Refunding" while it holds deposits. */
export function chipStatus(l: LaunchSummary, now: number): LaunchChipStatus {
  const phase = phaseOf(l, now);
  if (phase === "live") return "live";
  if (phase === "refunding") return "refunding";
  if (phase === "woundDown") return "woundDown";
  if (phase === "failed") return refundState(l) === "none" ? "ended" : "refunding";
  return BigInt(l.raised) >= BigInt(l.raiseMin) ? "min-reached" : "raising";
}

/** Vault holdings: SOL plus the share of total supply held (tokens). */
export function vaultOf(l: LaunchSummary): { sol: number; supplyPct: number; valueSol: number } {
  const sol = lamportsToSol(l.vaultSol);
  const supplyPct = pctOf(l.vaultTokens, TOTAL_SUPPLY);
  return { sol, supplyPct, valueSol: sol + (Number(l.vaultTokens) / 1e6) * l.priceSol };
}

/** Toolbar sorts (§4.4) plus the table-only column sorts. */
export type SortKey =
  | "trending"
  | "new"
  | "mcap"
  | "volume"
  | "raised"
  | "closing"
  | "change"
  | "vault"
  | "backers"
  | "holders";

export type SortDir = "asc" | "desc";

export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const TOOLBAR_SORTS: { value: SortKey; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "new", label: "New" },
  { value: "mcap", label: "Market cap" },
  { value: "volume", label: "24h volume" },
  { value: "raised", label: "Raised" },
  { value: "closing", label: "Closing soonest" },
];

export const isToolbarSort = (v: string | undefined): v is SortKey => TOOLBAR_SORTS.some((s) => s.value === v);

export type View = "board" | "grid" | "table";

export const VIEWS: { value: View; label: string }[] = [
  { value: "board", label: "Board" },
  { value: "grid", label: "Grid" },
  { value: "table", label: "Table" },
];

export const isView = (v: string | undefined): v is View => VIEWS.some((x) => x.value === v);

/**
 * Descending-natural score per key (bigger = first when `desc`). `trending` keeps the indexer's
 * order (`rank`); `closing` ranks open raises by deadline, everything else after them.
 */
function score(l: LaunchSummary, key: SortKey, rank: number, now: number): number {
  switch (key) {
    case "trending":
      return -rank;
    case "new":
      return l.createdAt;
    case "mcap":
      return l.marketCapSol;
    case "volume":
      return l.volume24hSol;
    case "raised":
      return lamportsToSol(l.raised);
    case "closing": {
      const phase = phaseOf(l, now);
      return phase === "raising" ? -l.raiseDeadline : -Number.MAX_SAFE_INTEGER - rank;
    }
    case "change":
      return l.change24h ?? -Infinity;
    case "vault":
      return vaultOf(l).valueSol;
    case "backers":
      return l.backerCount;
    case "holders":
      return l.holders;
  }
}

/** Sorts a trending-ordered list; ties keep the trending order. */
export function sortLaunches(trendingOrder: LaunchSummary[], sort: Sort, now: number): LaunchSummary[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  return trendingOrder
    .map((l, rank) => ({ l, rank, s: score(l, sort.key, rank, now) }))
    .sort((a, b) => (a.s === b.s ? a.rank - b.rank : a.s < b.s ? -sign : sign))
    .map((x) => x.l);
}
