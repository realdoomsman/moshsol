"use client";

import { CLUSTER, CLUSTER_LABEL } from "@/lib/env";
import { useAgentHeartbeat, useIndexerStatus, type IndexerStatus } from "@/lib/status";
import { StatusDot } from "../ui/chip";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/tooltip";

function indexerDetail(s: IndexerStatus): string {
  if (s.tone === "down") return "Indexer unreachable. Live data may be stale.";
  if (s.tone === "unknown") return "Checking the indexer…";
  const lag = s.lagSlots === null ? "" : ` · ${s.lagSlots} slots behind`;
  return `${s.label}${lag}`;
}

/**
 * Network pill (§4.2/§4.3): cluster name on `raised`, 22px, 4px radius, with a 6px dot from
 * `/api/health` (up when synced and < 150 slots behind, warn otherwise, down if unreachable). The
 * dot carries the page's one live pulse. `dotOnly` for the mobile top bar.
 */
export function NetworkPill({ dotOnly, className }: { dotOnly?: boolean; className?: string }) {
  const status = useIndexerStatus();
  return (
    <Tooltip content={indexerDetail(status)} placement="bottom">
      <span
        tabIndex={0}
        aria-label={`${CLUSTER_LABEL[CLUSTER]}: ${indexerDetail(status)}`}
        className={cn(
          "label inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-xs text-ink-2",
          dotOnly ? "px-2 pointer-coarse:h-10" : "bg-raised px-2",
          className,
        )}
      >
        <StatusDot tone={status.tone} live />
        {dotOnly ? <span className="sr-only">{CLUSTER_LABEL[CLUSTER]}</span> : CLUSTER_LABEL[CLUSTER]}
      </span>
    </Tooltip>
  );
}

/**
 * Footer status bar (#25, Hyperliquid/Drift pattern): indexer sync + slot + lag, agent heartbeat
 * + tick, network. Built only from `/api/health` and the agent's `/status`; failures show plainly.
 */
export function StatusBar({ className }: { className?: string }) {
  const indexer = useIndexerStatus();
  const agent = useAgentHeartbeat();
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className={cn("micro num flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-ink-3", className)}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusDot tone={indexer.tone} />
        <span className="text-ink-2">{indexer.label}</span>
        {indexer.slot !== null ? <span>· slot {fmt(indexer.slot)}</span> : null}
        {indexer.lagSlots !== null ? <span>· lag {fmt(indexer.lagSlots)}</span> : null}
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusDot tone={agent.tone} />
        <span className="text-ink-2">{agent.label}</span>
        {agent.tick !== null ? <span>· tick {fmt(agent.tick)}</span> : null}
        {agent.tone === "warn" && agent.sinceSecs !== null ? (
          <span>· last tick {Math.round(agent.sinceSecs / 60)}m ago</span>
        ) : null}
        {agent.dryRun ? <span>· dry run</span> : null}
      </span>
      <span className="whitespace-nowrap">{CLUSTER_LABEL[CLUSTER]}</span>
    </div>
  );
}
