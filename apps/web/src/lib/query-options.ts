import { queryOptions } from "@tanstack/react-query";
import { api, type LaunchFilter, type LaunchSort, type Timeframe } from "./api";
import type { DepositRow, TradeRow } from "./types";

/**
 * Query keys + fetchers shared by the client hooks (`queries.ts`) and the server prefetch
 * (`prefetch.tsx`), so a server-rendered cache hydrates into exactly the queries the page reads.
 * Polling, retries and other client-only behaviour stay in the hooks.
 */

export const platformQuery = () => queryOptions({ queryKey: ["platform"], queryFn: api.platform, staleTime: 60_000 });

export const statsQuery = () => queryOptions({ queryKey: ["stats"], queryFn: api.stats });

export const launchesQuery = (p: { status: LaunchFilter; sort: LaunchSort; q?: string }) =>
  queryOptions({
    queryKey: ["launches", p.status, p.sort, p.q ?? ""],
    queryFn: () => api.launches({ ...p, limit: 200 }),
  });

export const launchQuery = (mint: string) => queryOptions({ queryKey: ["launch", mint], queryFn: () => api.launch(mint) });

export const recentTradesQuery = (mint: string, limit: number) =>
  queryOptions({ queryKey: ["trades", mint, "recent", limit], queryFn: () => api.trades(mint, { limit }) });

export const candlesQuery = (mint: string, tf: Timeframe) =>
  queryOptions({ queryKey: ["candles", mint, tf], queryFn: () => api.candles(mint, tf) });

export const backersQuery = (mint: string) => queryOptions({ queryKey: ["backers", mint], queryFn: () => api.backers(mint) });

export const holdersQuery = (mint: string, limit: number) =>
  queryOptions({ queryKey: ["holders", mint, limit], queryFn: () => api.holders(mint, limit) });

export const portfolioQuery = (wallet: string) =>
  queryOptions({ queryKey: ["portfolio", wallet], queryFn: () => api.portfolio(wallet) });

export const activityQuery = () => queryOptions({ queryKey: ["activity"], queryFn: () => api.activity(40) });

export const agentsQuery = () => queryOptions({ queryKey: ["agents"], queryFn: api.agents });

export const agentStatusQuery = () => queryOptions({ queryKey: ["agent-status"], queryFn: api.agentStatus });

export const FEED_PAGE = 50;

/**
 * A newest-first feed: `queryKey` is the prefix the indexer websocket invalidates, `fetchPage`
 * loads one page older than the exclusive `before` cursor (unix seconds; undefined = newest).
 */
export interface Feed<T> {
  queryKey: readonly unknown[];
  fetchPage: (before: number | undefined) => Promise<T[]>;
}

export const tradeFeed = (mint: string, agentOnly: boolean): Feed<TradeRow> => ({
  queryKey: ["trades", mint, agentOnly ? "agent" : "all"],
  fetchPage: async (before) => (await api.trades(mint, { limit: FEED_PAGE, before, agent: agentOnly })).trades,
});

export const depositFeed = (mint: string): Feed<DepositRow> => ({
  queryKey: ["deposits", mint],
  fetchPage: async (before) => (await api.deposits(mint, { limit: FEED_PAGE, before })).deposits,
});

/** The live head page of a feed (older pages are local state, fetched on demand). */
export const feedHeadQuery = <T>(feed: Feed<T>) =>
  queryOptions({ queryKey: [...feed.queryKey, "head"], queryFn: () => feed.fetchPage(undefined) });
