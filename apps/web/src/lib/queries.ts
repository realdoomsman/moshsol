"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ApiError, type LaunchFilter, type LaunchSort, type Timeframe } from "./api";
import { useFallbackInterval } from "./live";
import {
  activityQuery,
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
} from "./query-options";
import type { DepositRow, TradeRow } from "./types";

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

/** Launch summary. Retries 404s briefly: a launch created seconds ago may not be indexed yet. */
export function useLaunch(mint: string) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    ...launchQuery(mint),
    refetchInterval: (q) => (q.state.error instanceof ApiError && q.state.error.status === 404 ? 1_500 : interval),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });
}

/** Recent trades for chart overlays (EMA per bucket, agent markers). */
export function useTrades(mint: string, limit: number, enabled = true) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    ...recentTradesQuery(mint, limit),
    refetchInterval: interval,
    enabled,
  });
}

export function useCandles(mint: string, tf: Timeframe, enabled = true) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    ...candlesQuery(mint, tf),
    refetchInterval: interval,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useBackers(mint: string) {
  const interval = useFallbackInterval(8_000);
  return useQuery({ ...backersQuery(mint), refetchInterval: interval });
}

export interface PagedFeed<T> {
  rows: T[];
  /** Keys of the live head page, for "new row" animations. */
  headKeys: string[] | undefined;
  isLoading: boolean;
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
    hasMore: !older.exhausted && (head.data?.length ?? 0) >= FEED_PAGE,
    loadingMore,
    loadError,
    loadMore,
  };
}

/** Stable identity for a trade row (a transaction may carry more than one trade). */
export const tradeKey = (t: TradeRow) => `${t.signature}:${t.isBuy ? "b" : "s"}:${t.tokenAmount}`;
const depositKey = (d: DepositRow) => `${d.signature}:${d.amount}`;

export function useTradeFeed(mint: string, agentOnly = false): PagedFeed<TradeRow> {
  const interval = useFallbackInterval(5_000);
  const feed = useMemo(() => tradeFeed(mint, agentOnly), [mint, agentOnly]);
  return usePagedFeed({ feed, interval, rowKey: tradeKey });
}

export function useDepositFeed(mint: string): PagedFeed<DepositRow> {
  const interval = useFallbackInterval(8_000);
  const feed = useMemo(() => depositFeed(mint), [mint]);
  return usePagedFeed({ feed, interval, rowKey: depositKey });
}

export function useHolders(mint: string, limit: number) {
  const interval = useFallbackInterval(10_000);
  return useQuery({
    ...holdersQuery(mint, limit),
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
