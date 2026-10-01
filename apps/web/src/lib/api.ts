import { AGENT_URL, INDEXER_URL } from "./env";
import type {
  ActivityEvent,
  ActivityType,
  AgentStatus,
  AgentsOverview,
  BackerRow,
  Candle,
  Comment,
  CommentsPage,
  DepositRow,
  HolderRow,
  IndexerHealth,
  LaunchSummary,
  PlatformInfo,
  PlatformStats,
  Portfolio,
  SearchResult,
  TradeRow,
  TraderStat,
  TraderWindow,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Server renders never wait long on the indexer/agent: a slow request is dropped and the page
 * falls back to loading that data in the browser.
 */
const SERVER_TIMEOUT_MS = 1_500;

export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      cache: "no-store",
      signal: typeof window === "undefined" ? AbortSignal.timeout(SERVER_TIMEOUT_MS) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, `Can't reach ${base}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type LaunchFilter = "raising" | "live" | "refunding" | "woundDown" | "all";
export type LaunchSort = "trending" | "new" | "mcap" | "volume" | "raised";
export type Timeframe = 60 | 300 | 900 | 3600 | 86400;

export interface UploadInput {
  image: File;
  name: string;
  symbol: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  whitelist?: string[];
}

/**
 * Indexer health. Unlike other endpoints a 503 still carries the health body (e.g. first sync not
 * finished); only an unreachable indexer throws.
 */
async function health(): Promise<IndexerHealth> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER_URL}/api/health`, {
      cache: "no-store",
      signal: typeof window === "undefined" ? AbortSignal.timeout(SERVER_TIMEOUT_MS) : undefined,
    });
  } catch {
    throw new ApiError(0, `Can't reach ${INDEXER_URL}`);
  }
  const body = (await res.json().catch(() => null)) as IndexerHealth | null;
  if (!body) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return { ...body, ok: res.ok && body.ok };
}

export const api = {
  health,
  /** Launches (name/symbol/mint prefix) and wallets (profile name/address prefix); `q` is 1–64 chars. */
  search: (q: string) => request<SearchResult>(INDEXER_URL, `/api/search?q=${encodeURIComponent(q)}`),
  platform: () => request<PlatformInfo>(INDEXER_URL, "/api/platform"),
  stats: () => request<PlatformStats>(INDEXER_URL, "/api/stats"),
  launches: (p: { status: LaunchFilter; sort: LaunchSort; q?: string; limit?: number }) => {
    const qs = new URLSearchParams({ status: p.status, sort: p.sort, limit: String(p.limit ?? 100) });
    if (p.q) qs.set("q", p.q);
    return request<{ launches: LaunchSummary[]; total: number }>(INDEXER_URL, `/api/launches?${qs}`);
  },
  /** `id` here and on every `/api/launches/:id/…` route below: the launch address or its mint (`launchId`). */
  launch: (id: string) => request<LaunchSummary>(INDEXER_URL, `/api/launches/${id}`),
  /**
   * Newest first; `before` = unix seconds (exclusive). Server-side filters: `agent` = vault agent
   * trades only, `side`, `minSol` (SOL, float) and `trader` (one wallet).
   */
  trades: (
    id: string,
    p: { limit: number; before?: number; agent?: boolean; side?: "buy" | "sell"; minSol?: number; trader?: string },
  ) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.before !== undefined) qs.set("before", String(p.before));
    if (p.agent) qs.set("agent", "1");
    if (p.side) qs.set("side", p.side);
    if (p.minSol !== undefined && p.minSol > 0) qs.set("minSol", String(p.minSol));
    if (p.trader) qs.set("trader", p.trader);
    return request<{ trades: TradeRow[] }>(INDEXER_URL, `/api/launches/${id}/trades?${qs}`);
  },
  /** Top non-agent traders of a launch by SOL volume in the window. */
  traders: (id: string, window: TraderWindow, limit = 50) =>
    request<{ window: TraderWindow; traders: TraderStat[] }>(
      INDEXER_URL,
      `/api/launches/${id}/traders?window=${window}&limit=${limit}`,
    ),
  /** Flat thread, newest first (replies included); `before` = comment id (exclusive). */
  comments: (id: string, p: { limit: number; before?: number; replyTo?: number }) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.before !== undefined) qs.set("before", String(p.before));
    if (p.replyTo !== undefined) qs.set("replyTo", String(p.replyTo));
    return request<CommentsPage>(INDEXER_URL, `/api/launches/${id}/comments?${qs}`);
  },
  /** Signed comment (see `lib/signed.ts`): `message` must hash `body` exactly as sent. */
  postComment: (
    id: string,
    p: { wallet: string; message: string; signature: string; body: string; replyTo?: number },
  ) =>
    request<{ comment: Comment }>(INDEXER_URL, `/api/launches/${id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    }),
  candles: (id: string, tf: Timeframe) =>
    request<{ candles: Candle[] }>(INDEXER_URL, `/api/launches/${id}/candles?tf=${tf}`),
  backers: (id: string) => request<{ backers: BackerRow[] }>(INDEXER_URL, `/api/launches/${id}/backers`),
  /** Newest first; `before` = unix seconds (exclusive). */
  deposits: (id: string, p: { limit: number; before?: number }) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.before !== undefined) qs.set("before", String(p.before));
    return request<{ deposits: DepositRow[] }>(INDEXER_URL, `/api/launches/${id}/deposits?${qs}`);
  },
  holders: (id: string, limit: number) =>
    request<{ holders: HolderRow[] }>(INDEXER_URL, `/api/launches/${id}/holders?limit=${limit}`),
  portfolio: (wallet: string) => request<Portfolio>(INDEXER_URL, `/api/portfolio/${wallet}`),
  activity: (limit = 40) => request<{ events: ActivityEvent[] }>(INDEXER_URL, `/api/activity?limit=${limit}`),
  /** One launch's events, newest first; `type` narrows to one event type (e.g. admin `vault_withdrawn`). */
  launchActivity: (id: string, p: { type?: ActivityType; limit: number; before?: number }) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.type) qs.set("type", p.type);
    if (p.before !== undefined) qs.set("before", String(p.before));
    return request<{ events: ActivityEvent[] }>(INDEXER_URL, `/api/launches/${id}/activity?${qs}`);
  },
  agents: () => request<AgentsOverview>(INDEXER_URL, "/api/agents"),
  agentStatus: () => request<AgentStatus>(AGENT_URL, "/status"),
  upload: (input: UploadInput) => {
    const form = new FormData();
    form.set("image", input.image);
    form.set("name", input.name);
    form.set("symbol", input.symbol);
    for (const key of ["description", "twitter", "telegram", "website"] as const) {
      const v = input[key];
      if (v) form.set(key, v);
    }
    if (input.whitelist?.length) form.set("whitelist", JSON.stringify(input.whitelist));
    return request<{ uri: string; image: string }>(INDEXER_URL, "/api/upload", { method: "POST", body: form });
  },
};
