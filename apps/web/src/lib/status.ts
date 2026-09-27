"use client";

import { useQuery } from "@tanstack/react-query";
import { useNow } from "./hooks";
import { agentStatusQuery, healthQuery } from "./query-options";

/** Indexer lag (slots) above which the status dot turns `warn` (§4.2 network pill). */
export const INDEXER_LAG_WARN_SLOTS = 150;
/** The agent is "stale" when its last tick is older than this (§4.10). */
export const AGENT_STALE_SECS = 60;

/** `up` = healthy, `warn` = degraded, `down` = unreachable, `unknown` = not loaded yet. */
export type HealthTone = "up" | "warn" | "down" | "unknown";

export interface IndexerStatus {
  tone: HealthTone;
  /** Plain-English one-liner, e.g. "Indexer synced". */
  label: string;
  slot: number | null;
  lagSlots: number | null;
}

export interface AgentHeartbeat {
  tone: HealthTone;
  /** "Agent online" / "Agent stale" / "Agent offline". */
  label: string;
  tick: number | null;
  lastTickAt: number | null;
  /** Seconds since the last tick (null before the first one). */
  sinceSecs: number | null;
  dryRun: boolean;
}

/** Indexer health from `/api/health`, polled every 15 s. */
export function useIndexerStatus(): IndexerStatus {
  const q = useQuery({ ...healthQuery(), refetchInterval: 15_000, retry: false });
  if (q.data) {
    const { ok, lagSlots, slot } = q.data;
    const lagging = lagSlots !== null && lagSlots >= INDEXER_LAG_WARN_SLOTS;
    return {
      tone: ok && !lagging ? "up" : "warn",
      label: !ok ? "Indexer syncing" : lagging ? "Indexer lagging" : "Indexer synced",
      slot,
      lagSlots,
    };
  }
  if (q.isError) return { tone: "down", label: "Indexer unreachable", slot: null, lagSlots: null };
  return { tone: "unknown", label: "Checking indexer", slot: null, lagSlots: null };
}

/** Vault agent heartbeat from the agent service's `/status`, polled every 15 s. */
export function useAgentHeartbeat(): AgentHeartbeat {
  const q = useQuery({ ...agentStatusQuery(), refetchInterval: 15_000, retry: false });
  const now = useNow(5_000);
  if (q.data) {
    const { lastTickAt, tick, dryRun } = q.data;
    const sinceSecs = lastTickAt === null ? null : Math.max(0, now - lastTickAt);
    const fresh = sinceSecs !== null && sinceSecs <= AGENT_STALE_SECS;
    return {
      tone: fresh ? "up" : "warn",
      label: fresh ? "Agent online" : "Agent stale",
      tick,
      lastTickAt,
      sinceSecs,
      dryRun,
    };
  }
  if (q.isError) {
    return { tone: "down", label: "Agent offline", tick: null, lastTickAt: null, sinceSecs: null, dryRun: false };
  }
  return { tone: "unknown", label: "Checking agent", tick: null, lastTickAt: null, sinceSecs: null, dryRun: false };
}
