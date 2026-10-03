"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ApiError, type LaunchFilter, type LaunchSort, type Timeframe } from "./api";
import { useFallbackInterval } from "./live";
import {
  activityQuery,
  agentActivityQuery,
  agentResearchQuery,
  agentStatusQuery,
  agentsQuery,
  backersQuery,
  candlesQuery,
  depositFeed,
  FEED_PAGE,
  type Feed,
  feedHeadQuery,
  holdersQuery,
  launchesQuery,
  launchQuery,
  platformQuery,
  portfolioQuery,
  recentTradesQuery,
  statsQuery,
  tradeFeed,
  type TradeFilter,
  tradersQuery,
  vaultWithdrawalsQuery,
} from "./query-options";
import type { DepositRow, TradeRow, TraderWindow } from "./types";
import { officialMintOf } from "./official";

export function usePlatform() {
  return useQuery({
    ...platformQuery(),
    // Everything that quotes fees depends on this; keep trying through indexer restarts.
    refetchInterval: (q) => (q.state.status === "error" ? 3_000 : false),
  });
}

export function useStats() {
  const interval = useFallbackInterval(10_000);
  return useQuery({ ...statsQuery(), refetchInterval: interval });
}

export function useLaunches(p: { status: LaunchFilter; sort: LaunchSort; q?: string }) {
  const interval = useFallbackInterval(8_000);
  return useQuery({
    ...launchesQuery(p),
    refetchInterval: interval,
    placeholderData: (prev) => prev,
  });
}

/** Launch summary by `launchId` (or whatever id the URL carries). Retries 404s briefly: a launch created seconds ago may not be indexed yet. */
export function useLaunch(id: string) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    ...launchQuery(id),
    refetchInterval: (q) => (q.state.error instanceof ApiError && q.state.error.status === 404 ? 1_500 : interval),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });
}

/** Mint of the official Holdfast token (`params.buybackMint`), null until it is set on-chain. */
export function useOfficialMint(): string | null {
  return officialMintOf(usePlatform().data?.params);
}

/**
 * The official Holdfast token and its launch (looked up by mint; same cache entry as `launchQuery(mint)`, so
 * websocket pushes keep it live). `launch` stays null when no Holdfast launch has the mint (`missing`).
 */
export function useOfficial() {
  const mint = useOfficialMint();
  const interval = useFallbackInterval(8_000);
  const q = useQuery({
    ...launchQuery(mint ?? ""),
    enabled: mint !== null,
    refetchInterval: (q) => (q.state.error instanceof ApiError && q.state.error.status === 404 ? 60_000 : interval),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });
  const missing = q.error instanceof ApiError && q.error.status === 404;
  return { mint, launch: mint && q.data && !missing ? q.data : null, missing };
}

/** Recent trades for chart overlays (EMA per bucket, agent markers). */
export function useTrades(id: string, limit: number, enabled = true) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    ...recentTradesQuery(id, limit),
    refetchInterval: interval,
    enabled,
  });
}

export function useCandles(id: string, tf: Timeframe, enabled = true) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    ...candlesQuery(id, tf),
    refetchInterval: interval,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useBackers(id: string) {
  const interval = useFallbackInterval(8_000);
  return useQuery({ ...backersQuery(id), refetchInterval: interval });
}

export interface PagedFeed<T> {
  rows: T[];
  /** Keys of the live head page, for "new row" animations. */
  headKeys: string[] | undefined;
  isLoading: boolean;
  /** The live head page failed to load (older-page failures are `loadError`). */
  error: string | null;
  retry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  loadMore: () => void;
}

interface OlderPages<T> {
  id: string;
  rows: T[];
  exhausted: boolean;
}

/**
 * Newest-first feed: a live head page (refreshed through the `[family, mint]` query prefix that the
 * indexer websocket invalidates) plus older pages fetched on demand with the `before` unix cursor.
 * The cursor is exclusive and second-granular, so each older page asks for `oldest + 1` and drops
 * rows it already has.
 */
function usePagedFeed<T extends { timestamp: number }>(p: {
  feed: Feed<T>;
  interval: number;
  rowKey: (row: T) => string;
}): PagedFeed<T> {
  const { feed, rowKey } = p;
  const { fetchPage } = feed;
  const id = JSON.stringify(feed.queryKey);
  const head = useQuery({ ...feedHeadQuery(feed), refetchInterval: p.interval });
  const [pages, setPages] = useState<OlderPages<T>>({ id, rows: [], exhausted: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Navigating between launches reuses this component; older pages belong to the previous feed.
  const older = pages.id === id ? pages : { id, rows: [] as T[], exhausted: false };

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const r of [...(head.data ?? []), ...older.rows]) {
      const k = rowKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }, [head.data, older.rows, rowKey]);

  const loadMore = useCallback(() => {
    const last = rows.at(-1);
    if (loadingMore || !last) return;
    setLoadingMore(true);
    setLoadError(null);
    void (async () => {
      try {
        const seen = new Set(rows.map(rowKey));
        let page = await fetchPage(last.timestamp + 1);
        let fresh = page.filter((r) => !seen.has(rowKey(r)));
        if (fresh.length === 0 && page.length >= FEED_PAGE) {
          // A full page inside one second: step past that second.
          page = await fetchPage(last.timestamp);
          fresh = page.filter((r) => !seen.has(rowKey(r)));
        }
        setPages((cur) => {
          const base = cur.id === id ? cur.rows : [];
          return { id, rows: [...base, ...fresh], exhausted: page.length < FEED_PAGE || fresh.length === 0 };
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [rows, loadingMore, fetchPage, rowKey, id]);

  return {
    rows,
    headKeys: head.data?.map(rowKey),
    isLoading: head.isLoading,
    error: head.error && !head.data ? head.error.message : null,
    retry: () => void head.refetch(),
    hasMore: !older.exhausted && (head.data?.length ?? 0) >= FEED_PAGE,
    loadingMore,
    loadError,
    loadMore,
  };
}

/** Stable identity for a trade row (a transaction may carry more than one trade). */
export const tradeKey = (t: TradeRow) => `${t.signature}:${t.isBuy ? "b" : "s"}:${t.tokenAmount}`;
const depositKey = (d: DepositRow) => `${d.signature}:${d.amount}`;

/** Trades feed with server-side filters (see `TradeFilter`); each filter combination pages on its own. */
export function useTradeFeed(id: string, filter: TradeFilter = {}): PagedFeed<TradeRow> {
  const interval = useFallbackInterval(5_000);
  const key = JSON.stringify(filter);
  // `key` captures every filter field, so the feed only changes when the filter's content does.
  const feed = useMemo(() => tradeFeed(id, filter), [id, key]);
  return usePagedFeed({ feed, interval, rowKey: tradeKey });
}

export function useTraders(id: string, window: TraderWindow) {
  const interval = useFallbackInterval(10_000);
  return useQuery({ ...tradersQuery(id, window), refetchInterval: interval, placeholderData: (prev) => prev });
}

export function useDepositFeed(id: string): PagedFeed<DepositRow> {
  const interval = useFallbackInterval(8_000);
  const feed = useMemo(() => depositFeed(id), [id]);
  return usePagedFeed({ feed, interval, rowKey: depositKey });
}

export function useHolders(id: string, limit: number) {
  const interval = useFallbackInterval(10_000);
  return useQuery({
    ...holdersQuery(id, limit),
    refetchInterval: interval,
    placeholderData: (prev) => prev,
  });
}

export function usePortfolio(wallet: string | null) {
  const interval = useFallbackInterval(8_000);
  return useQuery({
    ...portfolioQuery(wallet!),
    enabled: !!wallet,
    refetchInterval: interval,
  });
}

export function useActivity() {
  const interval = useFallbackInterval(5_000);
  return useQuery({ ...activityQuery(), refetchInterval: interval });
}

export function useVaultWithdrawals(id: string) {
  const interval = useFallbackInterval(15_000);
  return useQuery({ ...vaultWithdrawalsQuery(id), refetchInterval: interval });
}

export function useAgents() {
  const interval = useFallbackInterval(8_000);
  return useQuery({ ...agentsQuery(), refetchInterval: interval });
}

export function useAgentStatus() {
  return useQuery({
    ...agentStatusQuery(),
    refetchInterval: 4_000,
    retry: false,
  });
}

/** The agent's decision log for one launch (`launchId`); polls while mounted, empty until the agent has decided anything. */
export function useAgentActivity(id: string, enabled = true) {
  return useQuery({
    ...agentActivityQuery(id),
    refetchInterval: 10_000,
    retry: false,
    enabled,
  });
}

/** What the agent's research loop learned (`GET /research`); refreshes slowly, it changes at most hourly. */
export function useAgentResearch() {
  return useQuery({
    ...agentResearchQuery(),
    refetchInterval: 120_000,
    retry: false,
  });
}
