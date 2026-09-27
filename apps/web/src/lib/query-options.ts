import { queryOptions } from "@tanstack/react-query";
import { api, type LaunchFilter, type LaunchSort, type Timeframe } from "./api";
import type { DepositRow, TradeRow, TraderWindow } from "./types";

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

export const tradersQuery = (mint: string, window: TraderWindow) =>
  queryOptions({ queryKey: ["traders", mint, window], queryFn: () => api.traders(mint, window) });

export const COMMENTS_PAGE = 50;

/** Newest page of a launch's thread; the `comment` websocket message patches it in place. */
export const commentsQuery = (mint: string) =>
  queryOptions({ queryKey: ["comments", mint, "head"], queryFn: () => api.comments(mint, { limit: COMMENTS_PAGE }) });

export const portfolioQuery = (wallet: string) =>
  queryOptions({ queryKey: ["portfolio", wallet], queryFn: () => api.portfolio(wallet) });

export const activityQuery = () => queryOptions({ queryKey: ["activity"], queryFn: () => api.activity(40) });

export const agentsQuery = () => queryOptions({ queryKey: ["agents"], queryFn: api.agents });

export const agentStatusQuery = () => queryOptions({ queryKey: ["agent-status"], queryFn: api.agentStatus });

export const healthQuery = () => queryOptions({ queryKey: ["health"], queryFn: api.health });

export const searchQuery = (q: string) =>
  queryOptions({ queryKey: ["search", q], queryFn: () => api.search(q), staleTime: 15_000 });

export const FEED_PAGE = 50;

/**
 * A newest-first feed: `queryKey` is the prefix the indexer websocket invalidates, `fetchPage`
 * loads one page older than the exclusive `before` cursor (unix seconds; undefined = newest).
 */
export interface Feed<T> {
  queryKey: readonly unknown[];
  fetchPage: (before: number | undefined) => Promise<T[]>;
}

/**
 * Server-side trade filters (`/api/launches/:mint/trades`). `traders` = only these wallets: one
 * wallet is a single `trader=` query; several (e.g. every backer) are one query each, merged by
 * time — each returns its newest page before the cursor, so the merged top page is exact.
 */
export interface TradeFilter {
  agent?: boolean;
  side?: "buy" | "sell";
  minSol?: number;
  traders?: readonly string[];
}

export const tradeFeed = (mint: string, f: TradeFilter = {}): Feed<TradeRow> => {
  const traders = f.traders ?? null;
  const base = { limit: FEED_PAGE, agent: f.agent, side: f.side, minSol: f.minSol };
  return {
    queryKey: ["trades", mint, "feed", f.agent ? "agent" : "all", f.side ?? "any", f.minSol ?? 0, traders?.join(",") ?? "*"],
    fetchPage: async (before) => {
      if (!traders) return (await api.trades(mint, { ...base, before })).trades;
      if (traders.length === 0) return [];
      const pages = await Promise.all(traders.map(async (trader) => (await api.trades(mint, { ...base, before, trader })).trades));
      return pages
        .flat()
        .sort((a, b) => b.timestamp - a.timestamp || b.slot - a.slot)
        .slice(0, FEED_PAGE);
    },
  };
};

export const depositFeed = (mint: string): Feed<DepositRow> => ({
  queryKey: ["deposits", mint],
  fetchPage: async (before) => (await api.deposits(mint, { limit: FEED_PAGE, before })).deposits,
});

/** The live head page of a feed (older pages are local state, fetched on demand). */
export const feedHeadQuery = <T>(feed: Feed<T>) =>
  queryOptions({ queryKey: [...feed.queryKey, "head"], queryFn: () => feed.fetchPage(undefined) });
