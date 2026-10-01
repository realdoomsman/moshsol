"use client";

import { timeAgo } from "@holdfast/sdk";
import Link from "next/link";
import { useNow } from "@/lib/hooks";
import { launchHref } from "@/lib/launch";
import { useAgentStatus } from "@/lib/queries";
import type { AgentDecision } from "@/lib/types";
import { BandMeter } from "../token/band-meter";
import { EmptyState } from "../ui/empty-state";
import { ActionChip } from "./decision-log";

/**
 * The agent's newest decision with its band (the live stand-in for the "agent defends" loop in the
 * /agents header until a recording exists).
 */
export function LatestDecision() {
  const status = useAgentStatus();
  const now = useNow(5_000);
  const d = (status.data?.decisions ?? []).reduce<AgentDecision | null>((best, x) => (!best || x.at > best.at ? x : best), null);
  if (!d) {
    return (
      <EmptyState className="py-12">
        {status.isError
          ? "The agent service isn't reachable right now."
          : status.isLoading
            ? "Connecting to the agent…"
            : "No live vaults to watch yet."}
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label text-ink-3">Latest decision</span>
        <span className="small num text-ink-3">{timeAgo(d.at, now)}</span>
      </div>
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <Link href={launchHref(d)} className="h3 text-ink hover:underline hover:decoration-ink-3/60 hover:underline-offset-2">
            ${d.symbol ?? d.mint.slice(0, 4)}
          </Link>
          <ActionChip d={d} />
        </div>
        {/* The chip carries the action ("Holding", "Waiting", "Bought"); the line is the agent's reason. */}
        <p className="small text-ink-2 first-letter:uppercase">
          {d.reason}
          {d.error ? <span className="text-warn"> · {d.error}</span> : null}
        </p>
      </div>
      <BandMeter price={d.priceSol} ema={d.emaSol} buyBelow={d.bandLowSol} sellAbove={d.bandHighSol} />
    </div>
  );
}
