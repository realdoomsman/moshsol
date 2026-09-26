import { AGENT_URL, INDEXER_URL } from "./env";
import type {
  ActivityEvent,
  AgentStatus,
  AgentsOverview,
  BackerRow,
  Candle,
  DepositRow,
  HolderRow,
  LaunchSummary,
  PlatformInfo,
  PlatformStats,
  Portfolio,
  TradeRow,
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

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
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

export type LaunchFilter = "raising" | "live" | "refunding" | "all";
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

export const api = {
  platform: () => request<PlatformInfo>(INDEXER_URL, "/api/platform"),
  stats: () => request<PlatformStats>(INDEXER_URL, "/api/stats"),
  launches: (p: { status: LaunchFilter; sort: LaunchSort; q?: string; limit?: number }) => {
    const qs = new URLSearchParams({ status: p.status, sort: p.sort, limit: String(p.limit ?? 100) });
    if (p.q) qs.set("q", p.q);
    return request<{ launches: LaunchSummary[]; total: number }>(INDEXER_URL, `/api/launches?${qs}`);
  },
  launch: (mint: string) => request<LaunchSummary>(INDEXER_URL, `/api/launches/${mint}`),
  /** Newest first; `before` = unix seconds (exclusive), `agent` = vault agent trades only. */
  trades: (mint: string, p: { limit: number; before?: number; agent?: boolean }) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.before !== undefined) qs.set("before", String(p.before));
    if (p.agent) qs.set("agent", "1");
    return request<{ trades: TradeRow[] }>(INDEXER_URL, `/api/launches/${mint}/trades?${qs}`);
  },
  candles: (mint: string, tf: Timeframe) =>
    request<{ candles: Candle[] }>(INDEXER_URL, `/api/launches/${mint}/candles?tf=${tf}`),
  backers: (mint: string) => request<{ backers: BackerRow[] }>(INDEXER_URL, `/api/launches/${mint}/backers`),
  /** Newest first; `before` = unix seconds (exclusive). */
  deposits: (mint: string, p: { limit: number; before?: number }) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.before !== undefined) qs.set("before", String(p.before));
    return request<{ deposits: DepositRow[] }>(INDEXER_URL, `/api/launches/${mint}/deposits?${qs}`);
  },
  holders: (mint: string, limit: number) =>
    request<{ holders: HolderRow[] }>(INDEXER_URL, `/api/launches/${mint}/holders?limit=${limit}`),
  portfolio: (wallet: string) => request<Portfolio>(INDEXER_URL, `/api/portfolio/${wallet}`),
  activity: (limit = 40) => request<{ events: ActivityEvent[] }>(INDEXER_URL, `/api/activity?limit=${limit}`),
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
