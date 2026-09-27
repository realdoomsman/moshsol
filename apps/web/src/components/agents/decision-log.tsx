"use client";

import { fmtPrice, timeAgo } from "@holdfast/sdk";
import Link from "next/link";
import { useState } from "react";
import { fmtLamports, fmtTokens } from "@/lib/format";
import type { AgentDecision, AgentStatus } from "@/lib/types";
import { decisionHeadline, decisionLabel } from "../band/model";
import { Address } from "../ui/address";
import { Chip, type ChipTone } from "../ui/chip";
import { EmptyState } from "../ui/empty-state";

/** Entries kept in the browser's log (the agent service only reports each vault's latest decision). */
const LOG_LIMIT = 120;

export interface LogEntry extends AgentDecision {
  key: string;
  /** First evaluation in a run of identical decisions. */
  firstAt: number;
  /** Consecutive evaluations collapsed into this entry. */
  count: number;
}

const ACTION_TONE: Record<AgentDecision["action"], ChipTone> = { buy: "accent", sell: "accent", hold: "muted", skip: "faint" };

/** "Holding" / "Waiting" / "Buying the dip" / "Sold"; a failed trade reads "Failed". */
export function ActionChip({ d }: { d: Pick<AgentDecision, "action" | "error" | "signature"> }) {
  if (d.error && (d.action === "buy" || d.action === "sell")) return <Chip tone="warn">Failed</Chip>;
  return <Chip tone={ACTION_TONE[d.action]}>{decisionLabel(d)}</Chip>;
}

/** Same decision again (a hold for the same reason): extend the run instead of adding a row. */
const sameRun = (a: AgentDecision, b: AgentDecision) =>
  a.mint === b.mint && a.action === b.action && !a.signature && !b.signature && !a.error && !b.error &&
  decisionHeadline(a) === decisionHeadline(b);

function merge(log: LogEntry[], decisions: AgentDecision[]): LogEntry[] {
  let next = log;
  for (const d of [...decisions].sort((a, b) => a.at - b.at)) {
    const i = next.findIndex((e) => e.mint === d.mint);
    const last = i === -1 ? null : next[i];
    if (last && last.at >= d.at) continue;
    if (last && sameRun(last, d)) {
      next = [{ ...last, ...d, key: last.key, firstAt: last.firstAt, count: last.count + 1 }, ...next.filter((_, j) => j !== i)];
    } else {
      next = [{ ...d, key: `${d.mint}:${d.at}`, firstAt: d.at, count: 1 }, ...next];
    }
  }
  return next.sort((a, b) => b.at - a.at).slice(0, LOG_LIMIT);
}

/**
 * The agent's decisions as a live log. `/status` carries each vault's latest decision; every new
 * tick is merged in, and repeated identical holds collapse into one row ("12 checks since 4m").
 */
export function useDecisionLog(status: AgentStatus | undefined): LogEntry[] {
  const [state, setState] = useState<{ tick: number | null; log: LogEntry[] }>(() => ({
    tick: status?.tick ?? null,
    log: status ? merge([], status.decisions) : [],
  }));
  if (status && status.tick !== state.tick) setState({ tick: status.tick, log: merge(state.log, status.decisions) });
  return state.log;
}

function amountText(d: AgentDecision): string | null {
  if (!d.amount) return null;
  return d.action === "buy" ? `${fmtLamports(d.amount)} SOL` : `${fmtTokens(d.amount)} tokens`;
}

export function DecisionLog({ log, now, loading }: { log: LogEntry[]; now: number; loading: boolean }) {
  if (!log.length) {
    return (
      <EmptyState>{loading ? "Connecting to the agent…" : "No decisions yet. The agent evaluates live vaults every few seconds."}</EmptyState>
    );
  }
  return (
    <ol aria-live="polite" className="max-h-[520px] overflow-y-auto overscroll-contain">
      {log.map((d) => {
        const amount = amountText(d);
        return (
          <li
            key={d.key}
            className="grid gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[88px_88px_minmax(0,1fr)_auto] md:items-baseline"
          >
            <span className="small num text-ink-3">{timeAgo(d.at, now)}</span>
            <span className="flex items-center gap-2 md:contents">
              <Link href={`/launch/${d.mint}`} className="ui text-ink hover:underline hover:decoration-line-2 hover:underline-offset-2">
                ${d.symbol ?? d.mint.slice(0, 4)}
              </Link>
              <span className="md:hidden">
                <ActionChip d={d} />
              </span>
            </span>
            <span className="min-w-0">
              <span className="small flex min-w-0 items-baseline gap-2 text-ink">
                <span className="hidden md:inline">
                  <ActionChip d={d} />
                </span>
                <span className="min-w-0">
                  {d.reason}
                  {amount ? ` · ${amount}` : ""}
                </span>
              </span>
              <span className="micro num mt-0.5 block text-ink-3">
                spot {fmtPrice(d.priceSol)} · EMA {fmtPrice(d.emaSol)} · band {fmtPrice(d.bandLowSol)}–{fmtPrice(d.bandHighSol)}
                {d.count > 1 ? ` · ${d.count} checks since ${timeAgo(d.firstAt, now)}` : ""}
              </span>
              {d.error ? <span className="small mt-0.5 block text-warn">{d.error}</span> : null}
            </span>
            <span className="small md:text-right">
              {d.signature ? <Address address={d.signature} kind="tx" copy={false} /> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
