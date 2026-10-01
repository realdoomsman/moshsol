import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETUP_HINT = "see README → Accounts";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required (${SETUP_HINT})`);
  return v;
}

function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer ≥ ${min}, got "${raw}"`);
  return n;
}

/** 32-byte AES-256-GCM key as 64 hex characters (`openssl rand -hex 32`). */
function masterKey(): Buffer {
  const hex = required("WALLET_MASTER_KEY");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`WALLET_MASTER_KEY must be 64 hex characters (32 bytes; ${SETUP_HINT})`);
  return Buffer.from(hex, "hex");
}

function sessionSecret(): Buffer {
  const v = required("SESSION_SECRET");
  if (v.length < 32) throw new Error(`SESSION_SECRET must be at least 32 characters (\`openssl rand -hex 32\`; ${SETUP_HINT})`);
  return Buffer.from(v, "utf8");
}

const LOCAL_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true };

/**
 * Public origin of the web app (the browser only ever talks to it; `/api/auth/*` and `/api/wallet/*`
 * are proxied here). Session cookies are `Secure` on https; plain http is only accepted on localhost.
 */
function siteOrigin(): string {
  const raw = required("SITE_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SITE_URL must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS[url.hostname] === true)) {
    throw new Error(`SITE_URL must be https (plain http only on localhost), got "${raw}"`);
  }
  return url.origin;
}

export interface AccountsConfig {
  port: number;
  host: string;
  /** Web app origin, e.g. `https://example.com`; the OAuth redirect URI is `<siteOrigin>/api/auth/google/callback`. */
  siteOrigin: string;
  dbPath: string;
  googleClientId: string;
  googleClientSecret: string;
  walletMasterKey: Buffer;
  sessionSecret: Buffer;
  /** Requests per minute per client IP across all routes (0 disables). */
  rateLimitPerMin: number;
  /** `POST /api/wallet/sign` + `/api/wallet/export` requests per minute, per user and per client IP (0 disables). */
  signLimitPerMin: number;
  /** See the indexer's TRUST_PROXY: `true`, `false` or a list of trusted proxy addresses/CIDRs/keywords. */
  trustProxy: boolean | string;
}

/** Reads the environment; throws (and the service refuses to start) on anything missing or malformed. */
export function loadConfig(): AccountsConfig {
  const trustProxy = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  return {
    // Not PORT: `pnpm dev` shares one environment with the indexer, which listens on PORT. On Railway set
    // PORT to the same value so its healthcheck (which targets PORT) reaches this service.
    port: envInt("ACCOUNTS_PORT", 8789, 0),
    host: process.env.HOST?.trim() || "127.0.0.1",
    siteOrigin: siteOrigin(),
    dbPath: path.resolve(process.env.DB_PATH?.trim() || path.join(APP_DIR, "data", "accounts.db")),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    walletMasterKey: masterKey(),
    sessionSecret: sessionSecret(),
    rateLimitPerMin: envInt("RATE_LIMIT_PER_MIN", 120, 0),
    signLimitPerMin: envInt("SIGN_LIMIT_PER_MIN", 30, 0),
    trustProxy: ["1", "true", "yes"].includes(trustProxy) ? true : ["", "0", "false", "no"].includes(trustProxy) ? false : trustProxy,
  };
}
