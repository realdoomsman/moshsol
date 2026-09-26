import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
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
  host: process.env.HOST || "127.0.0.1",
  rpcUrl,
  wsUrl: process.env.WS_URL || wsFromRpc(rpcUrl),
  dbPath: path.resolve(process.env.DB_PATH || path.join(APP_DIR, "data", "indexer.db")),
  filesDir: path.resolve(process.env.FILES_DIR || path.join(APP_DIR, "data", "files")),
  publicUrl: (process.env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  pollMs: 4_000,
  fullRefreshMs: 15_000,
  holdersTtlMs: 30_000,
} as const;
