"use client";

import { timeAgo } from "@holdfast/sdk";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useNow } from "@/lib/hooks";
import { launchHref } from "@/lib/launch";
import { useAgentStatus } from "@/lib/queries";
import { AGENT_STALE_SECS } from "@/lib/status";
import { ActionTag } from "../band/agent-simulator";
import { decisionDeviation, decisionLabel, fmtDeviation } from "../band/model";
import { Address } from "../ui/address";
import { StatusDot } from "../ui/chip";
import { cn } from "../ui/cn";
import { Skeleton } from "../ui/skeleton";

const MAX_ROWS = 5;

/**
 * §9 The agent, live: a compact mirror of /agents — heartbeat, signer, tick, and the latest decision
 * per launch with its reason in the agent's own words. Failures are shown, never hidden.
 */
export function AgentLive() {
  const q = useAgentStatus();
  const nowSec = useNow(1_000);
  const seen = useRef<Set<string> | null>(null);
  const s = q.data;
  const rows = (s?.decisions ?? []).slice(0, MAX_ROWS);
  const keys = rows.map((d) => `${d.mint}:${d.action}`);
  // Rows present on first data never animate; later arrivals (or a changed action) insert live.
  if (s && seen.current === null) seen.current = new Set(keys);
  const keyList = keys.join("|");
  useEffect(() => {
    for (const k of keyList.split("|")) seen.current?.add(k);
  }, [keyList]);
  const since = s?.lastTickAt ? nowSec - s.lastTickAt : null;
  const online = since !== null && since <= AGENT_STALE_SECS;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3">
        {!s ? (
          q.isError ? (
            <p className="small text-warn">Agent status unavailable.</p>
          ) : (
            <Skeleton className="h-5 w-64" />
          )
        ) : (
          <>
            <span className={cn("ui inline-flex items-center gap-2", online ? "text-ink" : "text-warn")}>
              <StatusDot tone={online ? "up" : "warn"} />
              {online ? "Online" : "Stale"}
            </span>
            <span className="small inline-flex items-center gap-2 text-ink-3">
              Signer <Address address={s.agent} explorer />
            </span>
            <span className="small num text-ink-3">Tick {s.tick.toLocaleString("en-US")}</span>
            <span className="small num text-ink-3">
              {s.lastTickAt ? `Last tick ${timeAgo(s.lastTickAt, nowSec)}` : "No tick yet"}
            </span>
            {s.dryRun ? <span className="small text-warn">Dry run</span> : null}
          </>
        )}
      </div>
      {q.isError && s ? (
        <p className="small border-b border-line border-l-2 border-l-warn px-5 py-2 text-warn">
          Agent status unavailable.{s.lastTickAt ? ` Last seen ${timeAgo(s.lastTickAt, nowSec)}.` : ""}
        </p>
      ) : null}
      {s && !online && !q.isError ? (
        <p className="small border-b border-line border-l-2 border-l-warn px-5 py-2 text-warn">
          {s.lastTickAt ? `The vault agent last ticked ${timeAgo(s.lastTickAt, nowSec)}.` : "The vault agent hasn’t ticked yet."} Vaults
          don&rsquo;t trade until it&rsquo;s back.
        </p>
      ) : null}
      {s ? (
        rows.length ? (
          <ul>
            {rows.map((d, i) => {
              const fresh = seen.current !== null && !seen.current.has(keys[i]);
              return (
                <li
                  key={keys[i]}
                  className={cn(
                    "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 last:border-b-0 md:grid-cols-[5rem_8.5rem_minmax(0,1fr)_6rem_5rem]",
                    fresh && "[--expand-to:120px] [animation:var(--animate-expand-in),var(--animate-row-agent)]",
                  )}
                >
                  <Link href={launchHref(d)} className="ui truncate text-ink hover:underline">
                    ${d.symbol ?? d.mint.slice(0, 4)}
                  </Link>
                  <span>
                    <ActionTag action={d.action === "skip" ? "hold" : d.action} label={decisionLabel(d)} />
                  </span>
                  <span className="small col-span-3 text-ink-2 first-letter:uppercase md:col-span-1" title={d.reason}>
                    {d.error && (d.action === "buy" || d.action === "sell") ? `Failed: ${d.error}` : d.reason}
                  </span>
                  <span className="micro num text-ink-3 md:text-right">{fmtDeviation(decisionDeviation(d))} vs EMA</span>
                  <span className="micro num text-ink-3 md:text-right">{timeAgo(d.at, nowSec)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small px-5 py-6 text-ink-3">No decisions yet. The agent reports each live launch on its next tick.</p>
        )
      ) : null}
      <div className="border-t border-line px-5 py-3">
        <Link href="/agents" className="ui text-ink transition-colors hover:text-accent-ink">
          Open transparency →
        </Link>
      </div>
    </div>
  );
}
