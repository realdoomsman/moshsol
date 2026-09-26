import type { LaunchJson } from "@moshsol/sdk";
import type { LaunchDbRow, Store, TradeAggDbRow } from "./db";
import type { LaunchSummary } from "./types";

export interface SummaryExtras {
  /** SOL traded in the last hour; used for the trending score. */
  volume1hSol: number;
}

export type RankedSummary = LaunchSummary & SummaryExtras;

function toSummary(store: Store, row: LaunchDbRow, agg: TradeAggDbRow | undefined, now: number): RankedSummary {
  const snap = JSON.parse(row.snapshot!) as LaunchJson;
  let change24h: number | null = null;
  if (snap.status === "live") {
    // Price 24h ago = last trade at/before the cutoff; younger launches compare to the launch price.
    const ref = store.priceAt(row.address, now - 86_400) ?? row.launch_price ?? store.firstTradePrice(row.address);
    if (ref !== null && ref > 0) change24h = ((snap.priceSol - ref) / ref) * 100;
  }
  return {
    ...snap,
    name: row.meta_name ?? row.onchain_name,
    symbol: row.meta_symbol ?? row.onchain_symbol,
    uri: row.uri,
    image: row.image,
    description: row.description,
    twitter: row.twitter,
    telegram: row.telegram,
    website: row.website,
    whitelist: row.whitelist ? (JSON.parse(row.whitelist) as string[]) : null,
    change24h,
    volume24hSol: agg?.v24 ?? 0,
    lastTradeAt: agg?.last_ts ?? null,
    holders: row.holders,
    volume1hSol: agg?.v1 ?? 0,
  };
}

/** Strips ranking-only fields before sending a summary over the wire. */
export function publicSummary(s: RankedSummary): LaunchSummary {
  const { volume1hSol: _drop, ...rest } = s;
  return rest;
}

export function summaryOf(store: Store, row: LaunchDbRow | undefined): LaunchSummary | null {
  if (!row?.snapshot) return null;
  const now = Math.floor(Date.now() / 1000);
  return publicSummary(toSummary(store, row, store.tradeAggregate(row.address, now), now));
}

/** Every launch with a snapshot, newest first, with ranking extras. */
export function allSummaries(store: Store): RankedSummary[] {
  const now = Math.floor(Date.now() / 1000);
  const aggs = store.tradeAggregates(now);
  return store.launches().map((row) => toSummary(store, row, aggs.get(row.address), now));
}
