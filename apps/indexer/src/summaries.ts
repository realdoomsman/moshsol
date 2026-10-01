import { lamportsToSol, type LaunchJson } from "@holdfast/sdk";
import type { LaunchDbRow, PumpEventAggDbRow, Store, TradeAggDbRow, VaultEventAggDbRow } from "./db";
import type { SolPrice, SolUsd } from "./price";
import type { LaunchSummary } from "./types";

function toSummary(
  store: Store,
  row: LaunchDbRow,
  agg: TradeAggDbRow | undefined,
  vault: VaultEventAggDbRow | undefined,
  pump: PumpEventAggDbRow | undefined,
  solUsd: SolUsd | null,
  now: number,
): LaunchSummary {
  const snap = JSON.parse(row.snapshot!) as LaunchJson;
  let change24h: number | null = null;
  if (snap.status === "live") {
    // Price 24h ago = last trade at/before the cutoff; younger launches compare to the launch price.
    const ref = store.priceAt(row.address, now - 86_400) ?? row.launch_price ?? store.firstTradePrice(row.address);
    if (ref !== null && ref > 0) change24h = ((snap.priceSol - ref) / ref) * 100;
  }
  const volume24hSol = agg?.v24 ?? 0;
  return {
    ...snap,
    marketCapUsd: solUsd ? snap.marketCapSol * solUsd.usd : null,
    priceUsd: solUsd ? snap.priceSol * solUsd.usd : null,
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
    volume24hSol,
    volume24hUsd: solUsd ? volume24hSol * solUsd.usd : null,
    volume1hSol: agg?.v1 ?? 0,
    trades1h: agg?.t1 ?? 0,
    buyers24h: agg?.buyers24 ?? 0,
    sellers24h: agg?.sellers24 ?? 0,
    lastTradeAt: agg?.last_ts ?? null,
    holders: row.holders,
    topHolderPct: row.top_holder_pct,
    comments: row.comment_count,
    creatorName: row.creator_name,
    profitSharedSol: lamportsToSol(vault?.profit_shared ?? "0"),
    vaultWithdrawnSol: lamportsToSol(vault?.withdrawn_sol ?? "0"),
    vaultWithdrawnTokens: vault?.withdrawn_tokens ?? "0",
    woundDown:
      vault?.wound_down_ts != null
        ? {
            timestamp: vault.wound_down_ts,
            solToBackers: lamportsToSol(vault.wound_down_sol ?? "0"),
            tokensReturned: vault.wound_down_tokens ?? "0",
            signature: vault.wound_down_sig ?? "",
          }
        : null,
    graduation:
      pump?.graduated_ts != null
        ? { timestamp: pump.graduated_ts, signature: pump.graduated_sig ?? "", pool: pump.graduated_pool ?? snap.pump.pool }
        : null,
    cranks: {
      creatorFeeCollections: pump?.fee_collections ?? 0,
      buybacks: pump?.buybacks ?? 0,
      lastCollectedAt: pump?.last_collected_ts ?? null,
      lastBuybackAt: pump?.last_buyback_ts ?? null,
    },
  };
}

export function summaryOf(store: Store, price: SolPrice, row: LaunchDbRow | undefined): LaunchSummary | null {
  if (!row?.snapshot) return null;
  const now = Math.floor(Date.now() / 1000);
  return toSummary(
    store,
    row,
    store.tradeAggregate(row.address, now),
    store.vaultEventAggregate(row.address),
    store.pumpEventAggregate(row.address),
    price.current,
    now,
  );
}

/** Every launch with a snapshot, newest first. */
export function allSummaries(store: Store, price: SolPrice): LaunchSummary[] {
  const now = Math.floor(Date.now() / 1000);
  const aggs = store.tradeAggregates(now);
  const vault = store.vaultEventAggregates();
  const pump = store.pumpEventAggregates();
  const solUsd = price.current;
  return store
    .launches()
    .map((row) => toSummary(store, row, aggs.get(row.address), vault.get(row.address), pump.get(row.address), solUsd, now));
}

/** Summaries for a subset of launch rows (rows without a snapshot are skipped). */
export function summariesOf(store: Store, price: SolPrice, rows: LaunchDbRow[]): LaunchSummary[] {
  const now = Math.floor(Date.now() / 1000);
  const solUsd = price.current;
  return rows.flatMap((row) =>
    row.snapshot
      ? [
          toSummary(
            store,
            row,
            store.tradeAggregate(row.address, now),
            store.vaultEventAggregate(row.address),
            store.pumpEventAggregate(row.address),
            solUsd,
            now,
          ),
        ]
      : [],
  );
}
