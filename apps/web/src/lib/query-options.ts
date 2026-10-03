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

/** `id` on every per-launch query below: `launchId(l)` (address on pump launches, mint on Holdfast launches); the API accepts either. */
export const launchQuery = (id: string) => queryOptions({ queryKey: ["launch", id], queryFn: () => api.launch(id) });

export const recentTradesQuery = (id: string, limit: number) =>
  queryOptions({ queryKey: ["trades", id, "recent", limit], queryFn: () => api.trades(id, { limit }) });

/** The vault agent's own trades (newest `limit`): the chart's agent markers and the 24 h agent-trade count. */
export const agentTradesQuery = (id: string, limit: number) =>
  queryOptions({ queryKey: ["trades", id, "agent", limit], queryFn: () => api.trades(id, { limit, agent: true }) });

export const candlesQuery = (id: string, tf: Timeframe) =>
  queryOptions({ queryKey: ["candles", id, tf], queryFn: () => api.candles(id, tf) });

export const backersQuery = (id: string) => queryOptions({ queryKey: ["backers", id], queryFn: () => api.backers(id) });

export const holdersQuery = (id: string, limit: number) =>
  queryOptions({ queryKey: ["holders", id, limit], queryFn: () => api.holders(id, limit) });

export const tradersQuery = (id: string, window: TraderWindow) =>
  queryOptions({ queryKey: ["traders", id, window], queryFn: () => api.traders(id, window) });

export const COMMENTS_PAGE = 50;

/** Newest page of a launch's thread, keyed by the launch ADDRESS (what the `comment` websocket message carries). */
export const commentsQuery = (address: string) =>
  queryOptions({ queryKey: ["comments", address, "head"], queryFn: () => api.comments(address, { limit: COMMENTS_PAGE }) });

export const portfolioQuery = (wallet: string) =>
  queryOptions({ queryKey: ["portfolio", wallet], queryFn: () => api.portfolio(wallet) });

export const activityQuery = () => queryOptions({ queryKey: ["activity"], queryFn: () => api.activity(40) });

/** Vault withdrawals of one launch (`admin_withdraw_vault` and `dev_withdraw_vault`), newest first. */
export const vaultWithdrawalsQuery = (id: string) =>
  queryOptions({
    queryKey: ["launch-activity", id, "vault_withdrawn"],
    queryFn: () => api.launchActivity(id, { type: "vault_withdrawn", limit: 100 }),
  });

export const agentsQuery = () => queryOptions({ queryKey: ["agents"], queryFn: api.agents });

export const agentStatusQuery = () => queryOptions({ queryKey: ["agent-status"], queryFn: api.agentStatus });

export const agentActivityQuery = (id: string) => queryOptions({ queryKey: ["agent-activity", id], queryFn: () => api.agentActivity(id) });

export const agentResearchQuery = () => queryOptions({ queryKey: ["agent-research"], queryFn: api.agentResearch });

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

export const tradeFeed = (id: string, f: TradeFilter = {}): Feed<TradeRow> => {
  const traders = f.traders ?? null;
  const base = { limit: FEED_PAGE, agent: f.agent, side: f.side, minSol: f.minSol };
  return {
    queryKey: ["trades", id, "feed", f.agent ? "agent" : "all", f.side ?? "any", f.minSol ?? 0, traders?.join(",") ?? "*"],
    fetchPage: async (before) => {
      if (!traders) return (await api.trades(id, { ...base, before })).trades;
      if (traders.length === 0) return [];
      const pages = await Promise.all(traders.map(async (trader) => (await api.trades(id, { ...base, before, trader })).trades));
      return pages
        .flat()
        .sort((a, b) => b.timestamp - a.timestamp || b.slot - a.slot)
        .slice(0, FEED_PAGE);
    },
  };
};

export const depositFeed = (id: string): Feed<DepositRow> => ({
  queryKey: ["deposits", id],
  fetchPage: async (before) => (await api.deposits(id, { limit: FEED_PAGE, before })).deposits,
});

/** The live head page of a feed (older pages are local state, fetched on demand). */
export const feedHeadQuery = <T>(feed: Feed<T>) =>
  queryOptions({ queryKey: [...feed.queryKey, "head"], queryFn: () => feed.fetchPage(undefined) });
