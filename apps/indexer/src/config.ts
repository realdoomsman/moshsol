import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer ≥ ${min}, got "${raw}"`);
  return n;
}

function wsFromRpc(rpc: string): string {
  const u = new URL(rpc);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  // Solana convention: pubsub listens on RPC port + 1.
  if (u.port) u.port = String(Number(u.port) + 1);
  return u.toString();
}

const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8899";
const port = envInt("PORT", 8787);

export const config = {
  port,
  // PaaS hosts assign PORT and need a public bind; locally stay on loopback.
  host: process.env.HOST || (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  rpcUrl,
  wsUrl: process.env.WS_URL || wsFromRpc(rpcUrl),
  dbPath: path.resolve(process.env.DB_PATH || path.join(APP_DIR, "data", "indexer.db")),
  filesDir: path.resolve(process.env.FILES_DIR || path.join(APP_DIR, "data", "files")),
  publicUrl: (process.env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  /** Requests per minute per client IP across all routes (0 disables). */
  rateLimitPerMin: envInt("RATE_LIMIT_PER_MIN", 1_200, 0),
  /** `POST /api/upload` requests per minute per client IP (0 disables). */
  uploadLimitPerMin: envInt("UPLOAD_LIMIT_PER_MIN", 20, 0),
  /** Honour X-Forwarded-For for the client IP (set when behind a reverse proxy). */
  trustProxy: ["1", "true", "yes"].includes((process.env.TRUST_PROXY ?? "").trim().toLowerCase()),
  // Cadences are tunable so public RPCs (devnet/mainnet rate limits) aren't hammered.
  pollMs: envInt("POLL_MS", 4_000),
  fullRefreshMs: envInt("FULL_REFRESH_MS", 15_000),
  /** Genesis/cursor verification cadence; also runs after every RPC outage or WS reconnect. */
  chainCheckMs: envInt("CHAIN_CHECK_MS", 30_000),
  holdersTtlMs: envInt("HOLDERS_TTL_MS", 30_000),
} as const;
