import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

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

function envFlag(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (["", "0", "false", "no"].includes(raw)) return false;
  if (["1", "true", "yes"].includes(raw)) return true;
  throw new Error(`${name} must be 1/true/yes or 0/false/no, got "${process.env[name]}"`);
}

/** Solana keypair paying for Arweave uploads: `ARWEAVE_KEYPAIR_JSON` (secret key JSON array) or `ARWEAVE_KEYPAIR` (file path). */
function arweaveKeypair(): Keypair {
  const inline = process.env.ARWEAVE_KEYPAIR_JSON?.trim();
  const file = process.env.ARWEAVE_KEYPAIR?.trim();
  if (!inline && !file) {
    throw new Error("STORAGE=arweave needs a Solana key: set ARWEAVE_KEYPAIR_JSON (secret key JSON array) or ARWEAVE_KEYPAIR (path)");
  }
  const source = inline ? "ARWEAVE_KEYPAIR_JSON" : `ARWEAVE_KEYPAIR (${file})`;
  let bytes: unknown;
  try {
    bytes = JSON.parse(inline || fs.readFileSync(path.resolve(file!), "utf8"));
  } catch (err) {
    throw new Error(`${source} is not readable JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error(`${source} must be a 64-byte Solana secret key JSON array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function arweaveConfig(rpcUrl: string) {
  const network = process.env.ARWEAVE_NETWORK || "mainnet";
  if (network !== "mainnet" && network !== "dev") throw new Error(`ARWEAVE_NETWORK must be mainnet or dev, got "${network}"`);
  const rawBudget = process.env.ARWEAVE_DAILY_BUDGET_SOL || "0.25";
  const budget = Number(rawBudget);
  if (!Number.isFinite(budget) || budget < 0) throw new Error(`ARWEAVE_DAILY_BUDGET_SOL must be a number ≥ 0, got "${rawBudget}"`);
  return {
    keypair: arweaveKeypair(),
    network,
    /** Solana RPC the SOL top-up transfers go through (dev: must be a devnet RPC). */
    rpcUrl: process.env.ARWEAVE_RPC_URL || rpcUrl,
    dailyBudgetLamports: Math.floor(budget * LAMPORTS_PER_SOL),
  } as const;
}

const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8899";
const port = envInt("PORT", 8787);
const trustProxy = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
// A bare hop count ("1") used to mean trust-all here, which lets any client pick its own X-Forwarded-For and
// escape every per-IP limit; Fastify ≥ 5.12 itself trusts nothing for a number. Only a proxy address list is safe.
if (/^\d+$/.test(trustProxy) && trustProxy !== "0") {
  throw new Error(
    `TRUST_PROXY=${trustProxy}: hop counts are not supported; list the proxy addresses instead (Railway: uniquelocal,100.64.0.0/10)`,
  );
}
const storage = process.env.STORAGE || "local";
if (storage !== "local" && storage !== "arweave") throw new Error(`STORAGE must be local or arweave, got "${storage}"`);

export const config = {
  port,
  // PaaS hosts assign PORT and need a public bind; locally stay on loopback.
  host: process.env.HOST || (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  rpcUrl,
  wsUrl: process.env.WS_URL || wsFromRpc(rpcUrl),
  dbPath: path.resolve(process.env.DB_PATH || path.join(APP_DIR, "data", "indexer.db")),
  filesDir: path.resolve(process.env.FILES_DIR || path.join(APP_DIR, "data", "files")),
  publicUrl: (process.env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  /** The website the metadata of a new launch links to (`website: SITE_URL/launch/<launch address>`). */
  siteUrl: (process.env.SITE_URL || "https://holdfast.fun").replace(/\/+$/, ""),
  /** Requests per minute per client IP across all routes (0 disables). */
  rateLimitPerMin: envInt("RATE_LIMIT_PER_MIN", 1_200, 0),
  /** `POST /api/upload` + `POST /api/upload/image` requests per minute per client IP (0 disables). */
  uploadLimitPerMin: envInt("UPLOAD_LIMIT_PER_MIN", 20, 0),
  /** Comments per minute per wallet (0 disables). */
  commentLimitPerMin: envInt("COMMENT_LIMIT_PER_MIN", 5, 0),
  /** Signed social writes (comments + profile updates) per minute per client IP (0 disables). */
  socialIpLimitPerMin: envInt("SOCIAL_IP_LIMIT_PER_MIN", 20, 0),
  /** `POST /rpc` + `GET /rpc-ws` calls per minute per client IP when RPC_PROXY is on (0 disables). */
  rpcProxyLimitPerMin: envInt("RPC_PROXY_LIMIT_PER_MIN", 600, 0),
  /** Browser-facing JSON-RPC/PubSub proxy to RPC_URL/WS_URL (method allowlist), so keyed RPC URLs stay server-side. */
  rpcProxy: envFlag("RPC_PROXY"),
  /** Where uploads go: FILES_DIR served under PUBLIC_URL/files (`local`) or Arweave via ArDrive Turbo (`arweave`). */
  arweave: storage === "arweave" ? arweaveConfig(rpcUrl) : null,
  /** Enables `DELETE /api/comments/:id` (header `x-admin-token`); moderation is off when unset. */
  adminToken: process.env.ADMIN_TOKEN?.trim() || null,
  /**
   * Client IP from X-Forwarded-For behind reverse proxies: a comma-separated list of proxy IPs/CIDRs or
   * `loopback`/`linklocal`/`uniquelocal` trusts only those proxies, so clients can't spoof their IP.
   * `true`/`yes` trusts every hop (the leftmost, client-supplied entry wins): per-IP limits are then spoofable.
   */
  trustProxy: ["true", "yes"].includes(trustProxy) ? true : ["", "0", "false", "no"].includes(trustProxy) ? false : trustProxy,
  // Cadences are tunable so public RPCs (devnet/mainnet rate limits) aren't hammered.
  pollMs: envInt("POLL_MS", 4_000),
  fullRefreshMs: envInt("FULL_REFRESH_MS", 15_000),
  /** Genesis/cursor verification cadence; also runs after every RPC outage or WS reconnect. */
  chainCheckMs: envInt("CHAIN_CHECK_MS", 30_000),
  holdersTtlMs: envInt("HOLDERS_TTL_MS", 30_000),
  /** SOL/USD refresh cadence (Jupiter, CoinGecko fallback); the last good price is kept through outages. */
  priceRefreshMs: envInt("PRICE_REFRESH_MS", 60_000, 1_000),
} as const;
