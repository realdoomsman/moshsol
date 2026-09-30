import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PARAMS, withParams, type StrategyParams } from "./strategy";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface AgentConfig {
  rpcUrl: string;
  /** Where the agent authority keypair comes from: inline JSON (AGENT_KEYPAIR_JSON) or a file path. */
  keypairSource: { kind: "env"; json: string } | { kind: "file"; path: string };
  pollMs: number;
  statusPort: number;
  statusHost: string;
  dryRun: boolean;
  cooldownMs: number;
  minTradeLamports: bigint;
  /** Policy parameters: backtest-tuned defaults, optionally overridden by `STRATEGY_PARAMS` (JSON object). */
  strategy: StrategyParams;
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

function strategyParams(): StrategyParams {
  const raw = process.env.STRATEGY_PARAMS?.trim();
  if (!raw) return DEFAULT_PARAMS;
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch (err) {
    throw new Error(`STRATEGY_PARAMS must be a JSON object: ${(err as Error).message}`);
  }
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    throw new Error("STRATEGY_PARAMS must be a JSON object");
  }
  return withParams(DEFAULT_PARAMS, overrides as Record<string, unknown>);
}

export function loadConfig(): AgentConfig {
  const priority = int("PRIORITY_MICROLAMPORTS", 0, 0, 1_000_000_000);
  const keypair = process.env.AGENT_KEYPAIR?.trim() || ".localnet/agent.json";
  const keypairJson = process.env.AGENT_KEYPAIR_JSON?.trim();
  const dryRun = (process.env.DRY_RUN ?? "").trim().toLowerCase();
  return {
    rpcUrl: process.env.RPC_URL?.trim() || "http://127.0.0.1:8899",
    // Hosted deployments pass the secret inline; locally a file path resolves from the repo root
    // (`pnpm --filter` runs scripts with cwd = apps/agent).
    keypairSource: keypairJson
      ? { kind: "env", json: keypairJson }
      : { kind: "file", path: path.resolve(REPO_ROOT, keypair) },
    pollMs: int("POLL_MS", 4000, 250, 3_600_000),
    // PaaS hosts (Railway, Render, …) assign PORT; STATUS_PORT wins when both are set.
    statusPort: int("STATUS_PORT", int("PORT", 8788, 0, 65_535), 0, 65_535),
    statusHost: process.env.STATUS_HOST?.trim() || (process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
    dryRun: dryRun === "1" || dryRun === "true" || dryRun === "yes",
    cooldownMs: int("COOLDOWN_MS", 15_000, 0, 86_400_000),
    // 0.01 SOL: below this a vault trade barely moves price and mostly adds noise to the tape.
    minTradeLamports: BigInt(int("MIN_TRADE_LAMPORTS", 10_000_000, 1, Number.MAX_SAFE_INTEGER)),
    strategy: strategyParams(),
    // Agent trades can't be sandwiched (same-slot rule) and every fill it accepts still passes the vault's cost
    // rules (planned against this floor), so the tolerance only absorbs public trades landing in flight.
    slippageBps: int("SLIPPAGE_BPS", 100, 0, 9_999),
    priorityMicroLamports: priority > 0 ? priority : undefined,
    computeUnits: 120_000,
    maxBackoffMs: 300_000,
  };
}

export function loadKeypair(source: AgentConfig["keypairSource"]): Keypair {
  let raw: string;
  const label = source.kind === "env" ? "AGENT_KEYPAIR_JSON" : source.path;
  if (source.kind === "env") {
    raw = source.json;
  } else {
    try {
      raw = fs.readFileSync(source.path, "utf8");
    } catch (err) {
      throw new Error(`cannot read agent keypair ${source.path}: ${(err as Error).message}`);
    }
  }
  const bytes: unknown = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    throw new Error(`agent keypair ${label} must be a JSON array of 64 bytes`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}
