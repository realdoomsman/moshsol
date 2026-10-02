import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_PRIORITY_FEE, type PriorityFeeBounds } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadNarratorConfig, type NarratorConfig } from "./narrate";
import { loadResearchConfig, type ResearchConfig } from "./research";
import { wsUrlOf } from "./stream";
import type { ExecutorSource } from "./executors";
import { DEFAULT_PARAMS, withParams, type StrategyParams } from "./strategy";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Helius Sender, global endpoint, SWQoS-only tier (minimum tip 5,000 lamports). */
const DEFAULT_SENDER_URL = "https://sender.helius-rpc.com/fast?swqos_only=true";

export interface AgentConfig {
  rpcUrl: string;
  /** Where the agent authority keypair comes from: inline JSON (AGENT_KEYPAIR_JSON) or a file path. */
  keypairSource: { kind: "env"; json: string } | { kind: "file"; path: string };
  /**
   * The agent wallets (`platform.agentExecutors`) that execute pump trades: `AGENT_EXECUTORS_JSON` (JSON array of
   * secret-key arrays), else the keypair files in `AGENT_EXECUTORS_DIR` (default: `agent-wallets/` next to the
   * agent keypair file).
   */
  executorSource: ExecutorSource;
  /**
   * The indexer (`INDEXER_URL`, e.g. https://api.holdfast.fun): source of a pump launch's real traded volume, which
   * the sell guardrail is keyed on (the program only counts its own trades). Unset = on-chain volume only.
   */
  indexerUrl: string | null;
  /** `INDEXER_INTERNAL_TOKEN`: exempts the agent's reads from the indexer's per-IP limit (same value as its INTERNAL_TOKEN). */
  indexerInternalToken: string | null;
  /** Below this a wallet is not picked and gets topped up from the agent key (`EXECUTOR_MIN_SOL`). */
  executorMinLamports: number;
  /** Top-ups bring a low wallet to this (`EXECUTOR_TOPUP_SOL`)… */
  executorTopUpLamports: number;
  /** …and send at most this much per rolling hour in total (`EXECUTOR_TOPUP_MAX_SOL_PER_HOUR`). */
  executorTopUpMaxPerHourLamports: number;
  /** Heartbeat poll: the full read of every live launch (fallback trigger, cranks, new launches). */
  pollMs: number;
  statusPort: number;
  statusHost: string;
  dryRun: boolean;
  /** Event-driven trigger (`SUBSCRIBE`, on unless `0`): websocket subscriptions to every live launch and its venue. */
  subscribe: boolean;
  /** Websocket endpoint (`WS_URL`; default derived from `RPC_URL`: https → wss, explicit port + 1). */
  wsUrl: string;
  /** A change is evaluated this long after its first notification; changes arriving meanwhile ride along. */
  debounceMs: number;
  /** Per launch after a landed trade (and only once the stream shows that fill). */
  cooldownMs: number;
  /** Helius Sender (`SENDER_URL`, `SENDER_TIP_LAMPORTS`): trades also go out through it, carrying the tip; null = RPC only. */
  sender: { url: string; tipLamports: number } | null;
  minTradeLamports: bigint;
  /** Policy parameters: backtest-tuned defaults, optionally overridden by `STRATEGY_PARAMS` (JSON object). */
  strategy: StrategyParams;
  slippageBps: number;
  /** µlamports per CU: the fee-market estimate clamped to [floor, cap]. */
  priorityFee: PriorityFeeBounds;
  maxBackoffMs: number;
  /** Permissionless pump cranks (fee collection, buyback, graduation): per-launch check interval. */
  crankMs: number;
  /** JSON file remembering the agent's address lookup table per cluster (genesis hash → address). */
  altFile: string;
  /** `AGENT_ALT`: use this lookup table instead of creating/remembering one. */
  alt: PublicKey | null;
  /** SQLite file for the activity feed and the research history (`AGENT_DB`). */
  dbFile: string;
  /** Optional AI narration of decisions (`AI_API_URL` / `AI_API_KEY` / `AI_MODEL`); null = off. */
  narrator: NarratorConfig | null;
  /** Optional periodic parameter research (`RESEARCH_INTERVAL_MIN` > 0); null = off. */
  research: ResearchConfig | null;
}

function pubkey(name: string): PublicKey | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`${name} must be a base58 public key, got "${raw}"`);
  }
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
  const priorityFloor = int("PRIORITY_MICROLAMPORTS", DEFAULT_PRIORITY_FEE.floor, 0, 1_000_000_000);
  const priorityCap = int("MAX_PRIORITY_MICROLAMPORTS", DEFAULT_PRIORITY_FEE.cap, 0, 1_000_000_000);
  if (priorityCap < priorityFloor) {
    throw new Error(`MAX_PRIORITY_MICROLAMPORTS (${priorityCap}) must be ≥ PRIORITY_MICROLAMPORTS (${priorityFloor})`);
  }
  const keypair = process.env.AGENT_KEYPAIR?.trim() || ".localnet/agent.json";
  const executorsJson = process.env.AGENT_EXECUTORS_JSON?.trim();
  const executorsDir = process.env.AGENT_EXECUTORS_DIR?.trim() || path.join(path.dirname(keypair), "agent-wallets");
  const sol = (name: string, fallback: number) => {
    const raw = process.env[name]?.trim();
    const v = raw ? Number(raw) : fallback;
    if (!Number.isFinite(v) || v < 0 || v > 10) throw new Error(`${name} must be a SOL amount in [0, 10], got ${raw}`);
    return Math.round(v * 1e9);
  };
  const executorMinLamports = sol("EXECUTOR_MIN_SOL", 0.01);
  const executorTopUpLamports = sol("EXECUTOR_TOPUP_SOL", 0.02);
  if (executorTopUpLamports < executorMinLamports) throw new Error("EXECUTOR_TOPUP_SOL must be ≥ EXECUTOR_MIN_SOL");
  const keypairJson = process.env.AGENT_KEYPAIR_JSON?.trim();
  const dryRun = (process.env.DRY_RUN ?? "").trim().toLowerCase();
  const rpcUrl = process.env.RPC_URL?.trim() || "http://127.0.0.1:8899";
  const subscribe = (process.env.SUBSCRIBE ?? "").trim() !== "0";
  // Helius Sender (SWQoS-only tier, 0.000005 SOL tip) is on by default against a Helius mainnet RPC: its global HTTPS
  // endpoint routes to the nearest region. `SENDER_URL=off` sends through the RPC alone; tip accounts are mainnet-only.
  const senderEnv = process.env.SENDER_URL?.trim();
  const heliusMainnet = new URL(rpcUrl).hostname === "mainnet.helius-rpc.com";
  const senderUrl = senderEnv === "off" ? undefined : senderEnv || (heliusMainnet ? DEFAULT_SENDER_URL : undefined);
  return {
    rpcUrl,
    // Hosted deployments pass the secret inline; locally a file path resolves from the repo root
    // (`pnpm --filter` runs scripts with cwd = apps/agent).
    keypairSource: keypairJson
      ? { kind: "env", json: keypairJson }
      : { kind: "file", path: path.resolve(REPO_ROOT, keypair) },
    executorSource: executorsJson ? { kind: "env", json: executorsJson } : { kind: "dir", path: path.resolve(REPO_ROOT, executorsDir) },
    indexerUrl: process.env.INDEXER_URL?.trim().replace(/\/+$/, "") || null,
    indexerInternalToken: process.env.INDEXER_INTERNAL_TOKEN?.trim() || null,
    executorMinLamports,
    executorTopUpLamports,
    executorTopUpMaxPerHourLamports: sol("EXECUTOR_TOPUP_MAX_SOL_PER_HOUR", 0.2),
    // With the stream the poll is only a heartbeat; without it, it is the trigger.
    pollMs: int("POLL_MS", subscribe ? 10_000 : 4_000, 250, 3_600_000),
    // PaaS hosts (Railway, Render, …) assign PORT; STATUS_PORT wins when both are set.
    statusPort: int("STATUS_PORT", int("PORT", 8788, 0, 65_535), 0, 65_535),
    statusHost: process.env.STATUS_HOST?.trim() || (process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
    dryRun: dryRun === "1" || dryRun === "true" || dryRun === "yes",
    subscribe,
    wsUrl: process.env.WS_URL?.trim() || wsUrlOf(rpcUrl),
    debounceMs: int("DEBOUNCE_MS", 150, 0, 5_000),
    cooldownMs: int("COOLDOWN_MS", 3_000, 0, 86_400_000),
    sender: senderUrl ? { url: senderUrl, tipLamports: int("SENDER_TIP_LAMPORTS", 5_000, 5_000, 100_000_000) } : null,
    // 0.01 SOL: below this a vault trade barely moves price and mostly adds noise to the tape.
    minTradeLamports: BigInt(int("MIN_TRADE_LAMPORTS", 10_000_000, 1, Number.MAX_SAFE_INTEGER)),
    strategy: strategyParams(),
    // Agent trades can't be sandwiched (same-slot rule) and every fill it accepts still passes the vault's cost
    // rules (planned against this floor), so the tolerance only absorbs public trades landing in flight.
    slippageBps: int("SLIPPAGE_BPS", 100, 0, 9_999),
    priorityFee: { floor: priorityFloor, cap: priorityCap },
    maxBackoffMs: 300_000,
    crankMs: int("CRANK_MS", 60_000, 1_000, 86_400_000),
    altFile: path.resolve(REPO_ROOT, process.env.ALT_FILE?.trim() || "apps/agent/.alt.json"),
    alt: pubkey("AGENT_ALT"),
    dbFile: path.resolve(REPO_ROOT, process.env.AGENT_DB?.trim() || "apps/agent/.agent.db"),
    narrator: loadNarratorConfig(),
    research: loadResearchConfig(),
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
