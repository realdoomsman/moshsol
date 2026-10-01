import { AGENT_URL, INDEXER_URL } from "./env";
import type {
  ActivityEvent,
  ActivityType,
  AgentActivity,
  AgentResearch,
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
/**
 * Server renders share identical plain GETs (public data: no headers, body or credentials) for this
 * long from the moment one is sent, in flight included: concurrent and back-to-back renders cost the
 * indexer/agent one request per URL per window, not one per render (and the indexer's per-IP budget
 * counts all SSR as one client). Live data stays fresh: browsers then follow the websocket.
 */
const SERVER_SHARE_MS = 1_000;
/** URLs remembered at once; expired entries go first, then the oldest. */
const SERVER_SHARE_MAX = 500;

/** A finished response, read whole so it can be shared; every caller parses its own copy of `text`. */
type RawResponse = { ok: boolean; status: number; statusText: string; text: string };

const shared = new Map<string, { at: number; res: Promise<RawResponse> }>();

async function fetchRaw(base: string, path: string, init?: RequestInit): Promise<RawResponse> {
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
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, statusText: res.statusText, text };
}

/** `fetchRaw`, shared between server renders for `SERVER_SHARE_MS` when the request is a plain GET. */
function load(base: string, path: string, init?: RequestInit): Promise<RawResponse> {
  if (typeof window !== "undefined" || init !== undefined) return fetchRaw(base, path, init);
  const key = `${base}${path}`;
  const now = Date.now();
  const hit = shared.get(key);
  if (hit && now - hit.at < SERVER_SHARE_MS) return hit.res;
  if (shared.size >= SERVER_SHARE_MAX) {
    for (const [k, v] of shared) if (now - v.at >= SERVER_SHARE_MS) shared.delete(k);
    if (shared.size >= SERVER_SHARE_MAX) shared.delete(shared.keys().next().value!);
  }
  const res = fetchRaw(base, path);
  shared.delete(key);
  shared.set(key, { at: now, res });
  return res;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await load(base, path, init);
  if (!res.ok) {
    const body = parseJson(res.text) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return JSON.parse(res.text) as T;
}

export type LaunchFilter = "raising" | "live" | "refunding" | "woundDown" | "all";
export type LaunchSort = "trending" | "new" | "mcap" | "volume" | "raised";
export type Timeframe = 60 | 300 | 900 | 3600 | 86400;

export interface UploadInput {
  image: File;
  name: string;
  symbol: string;
  /** The launch address the metadata is for: the indexer sets the metadata's website to its launch page. */
  launch: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  whitelist?: string[];
}

/**
 * Indexer health. Unlike other endpoints a 503 still carries the health body (e.g. first sync not
 * finished); an unreachable indexer or a non-health body (429 `{ error }`, a proxy page) throws.
 */
async function health(): Promise<IndexerHealth> {
  const res = await load(INDEXER_URL, "/api/health");
  const body = parseJson(res.text) as (Partial<IndexerHealth> & { error?: string }) | null;
  if (!body || typeof body.ok !== "boolean" || !("slot" in body)) {
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return { ...(body as IndexerHealth), ok: res.ok && body.ok };
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
  /** Several launches' candles in one request (≤ 50 ids), keyed by the ids as given; unknown ids are left out. */
  candlesBatch: (ids: readonly string[], tf: Timeframe) =>
    request<{ candles: Record<string, Candle[]> }>(INDEXER_URL, `/api/candles?tf=${tf}&ids=${ids.join(",")}`),
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
  /** The agent's decision log for one launch (keyed by `launchId`: address or mint). */
  agentActivity: (id: string) => request<AgentActivity>(AGENT_URL, `/launches/${id}/activity`),
  agentResearch: () => request<AgentResearch>(AGENT_URL, "/research"),
  upload: (input: UploadInput) => {
    const form = new FormData();
    form.set("image", input.image);
    form.set("name", input.name);
    form.set("symbol", input.symbol);
    form.set("launch", input.launch);
    for (const key of ["description", "twitter", "telegram"] as const) {
      const v = input[key];
      if (v) form.set(key, v);
    }
    if (input.whitelist?.length) form.set("whitelist", JSON.stringify(input.whitelist));
    return request<{ uri: string; image: string }>(INDEXER_URL, "/api/upload", { method: "POST", body: form });
  },
};
