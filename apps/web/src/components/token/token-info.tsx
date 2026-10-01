"use client";

import { TOTAL_SUPPLY } from "@holdfast/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { pctOf } from "@/lib/format";
import { launchId } from "@/lib/launch";
import { useFallbackInterval } from "@/lib/live";
import { useHolders } from "@/lib/queries";
import { CONCENTRATION_WARN } from "@/lib/thresholds";
import type { HolderRow, LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { RuleTooltip } from "../ui/tooltip";
import { HOLDERS_LIMIT } from "./limits";
import { fmtPct } from "./shared";

export interface HolderStats {
  rows: HolderRow[];
  vaultPct: number;
  curvePct: number;
  /** Top 10 wallets, curve and vault excluded. */
  top10Pct: number;
  creatorPct: number;
  loaded: boolean;
}

/** Concentration figures from the holder snapshot (the curve/venue and vault accounts are labelled by the indexer). */
export function useHolderStats(l: LaunchSummary): HolderStats {
  const { data } = useHolders(launchId(l), HOLDERS_LIMIT);
  return useMemo(() => {
    const rows = data?.holders ?? [];
    const wallets = rows.filter((h) => h.label === null);
    return {
      rows,
      vaultPct: pctOf(l.vaultTokens, TOTAL_SUPPLY),
      curvePct: pctOf(l.tokenReserve, TOTAL_SUPPLY),
      top10Pct: wallets.slice(0, 10).reduce((s, h) => s + h.pct, 0),
      creatorPct: wallets.find((h) => h.owner === l.creator)?.pct ?? 0,
      loaded: data !== undefined,
    };
  }, [data, l.vaultTokens, l.tokenReserve, l.creator]);
}

/** Vault-agent trades in the last 24 h (the indexer's agent filter; counted from the newest 500). */
function useAgentTrades24h(id: string, now: number) {
  const interval = useFallbackInterval(10_000);
  const q = useQuery({
    queryKey: ["trades", id, "agent-24h"],
    queryFn: () => api.trades(id, { limit: 500, agent: true }),
    refetchInterval: interval,
  });
  const since = now - 86_400;
  return q.data ? q.data.trades.filter((t) => t.timestamp >= since).length : null;
}

/**
 * Token info grid (§4.5, Axiom audit grid): 3×2 cells, `label` under `num-l`. Concentration cells
 * turn `warn` above `CONCENTRATION_WARN`. Authorities and supply live in Verify, not here.
 */
export function TokenInfo({ launch: l, now, className }: { launch: LaunchSummary; now: number; className?: string }) {
  const h = useHolderStats(l);
  const agent24h = useAgentTrades24h(launchId(l), now);
  const cells = [
    {
      label: "Vault",
      rule: "Share of the supply held in the vault. Only the vault agent trades it; the platform multisig can withdraw it (listed on this page).",
      value: fmtPct(h.vaultPct),
    },
    {
      label: "Top 10",
      rule: "Share of the supply held by the 10 largest wallets. The curve and vault are excluded.",
      value: h.loaded ? fmtPct(h.top10Pct) : "—",
      warn: h.top10Pct > CONCENTRATION_WARN.top10Pct,
    },
    {
      label: "Creator",
      rule: "Share of the supply the creator's wallet holds now.",
      value: h.loaded ? fmtPct(h.creatorPct) : "—",
      warn: h.creatorPct > CONCENTRATION_WARN.creatorPct,
    },
    { label: "Backers", value: l.backerCount.toLocaleString("en-US") },
    { label: "Holders", rule: "Wallets holding any amount. The curve and vault are excluded.", value: l.holders.toLocaleString("en-US") },
    {
      label: "Agent 24h",
      rule: "Trades the vault agent made in the last 24 hours.",
      value: agent24h === null ? "—" : agent24h.toLocaleString("en-US"),
    },
  ];
  return (
    <section aria-label="Token info" className={className}>
      <dl className="grid grid-cols-3 overflow-hidden rounded-md border border-line bg-surface">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={cn("flex min-w-0 flex-col-reverse px-4 py-3", i % 3 !== 0 && "border-l border-line", i >= 3 && "border-t border-line")}
          >
            <dt className="label mt-1 truncate text-ink-3">{c.rule ? <RuleTooltip rule={c.rule}>{c.label}</RuleTooltip> : c.label}</dt>
            <dd className={cn("num-l truncate", c.warn ? "text-warn" : "text-ink")}>{c.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
