import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface AgentConfig {
  rpcUrl: string;
  /** Absolute path of the agent authority keypair (JSON secret-key array). */
  keypairPath: string;
  pollMs: number;
  statusPort: number;
  statusHost: string;
  dryRun: boolean;
  cooldownMs: number;
  minTradeLamports: bigint;
  /** MAX_FRACTION_PER_TRADE expressed in bps (0.5 → 5000). */
  maxFractionBps: bigint;
  slippageBps: number;
  priorityMicroLamports: number | undefined;
  computeUnits: number;
  maxBackoffMs: number;
}

function int(name: string, fallback: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) {
    throw new Error(`${name} must be an integer in [${lo}, ${hi}], got "${raw}"`);
  }
  return v;
}

export function loadConfig(): AgentConfig {
  const fractionRaw = process.env.MAX_FRACTION_PER_TRADE;
  const fraction = fractionRaw === undefined || fractionRaw.trim() === "" ? 0.5 : Number(fractionRaw);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(`MAX_FRACTION_PER_TRADE must be in (0, 1], got "${fractionRaw}"`);
  }
  const priority = int("PRIORITY_MICROLAMPORTS", 0, 0, 1_000_000_000);
  const keypair = process.env.AGENT_KEYPAIR?.trim() || ".localnet/agent.json";
  const dryRun = (process.env.DRY_RUN ?? "").trim().toLowerCase();
  return {
    rpcUrl: process.env.RPC_URL?.trim() || "http://127.0.0.1:8899",
    // Relative paths resolve from the repo root: `pnpm --filter` runs scripts with cwd = apps/agent.
    keypairPath: path.resolve(REPO_ROOT, keypair),
    pollMs: int("POLL_MS", 4000, 250, 3_600_000),
    statusPort: int("STATUS_PORT", 8788, 0, 65_535),
    statusHost: process.env.STATUS_HOST?.trim() || "127.0.0.1",
    dryRun: dryRun === "1" || dryRun === "true" || dryRun === "yes",
    cooldownMs: int("COOLDOWN_MS", 15_000, 0, 86_400_000),
    minTradeLamports: BigInt(int("MIN_TRADE_LAMPORTS", 1_000_000, 1, Number.MAX_SAFE_INTEGER)),
    maxFractionBps: BigInt(Math.round(fraction * 10_000)),
    slippageBps: int("SLIPPAGE_BPS", 50, 0, 9_999),
    priorityMicroLamports: priority > 0 ? priority : undefined,
    computeUnits: 120_000,
    maxBackoffMs: 300_000,
  };
}

export function loadKeypair(file: string): Keypair {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read agent keypair ${file}: ${(err as Error).message}`);
  }
  const bytes: unknown = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    throw new Error(`agent keypair ${file} must be a JSON array of 64 bytes`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}
