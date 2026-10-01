"use client";

import { timeAgo } from "@holdfast/sdk";
import { ArrowUpRight } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { explorerTx } from "@/lib/explorer";
import { useMounted } from "@/lib/hooks";
import { launchId } from "@/lib/launch";
import { useBackers } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/tooltip";

/** Token-page panel (§3.6): `surface` + 1px `line`, 12px radius, optional title row. */
export function Panel({
  title,
  aside,
  id,
  className,
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("min-w-0 rounded-md border border-line bg-surface", className)}>
      {title ? (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <h2 className="h3 text-ink">{title}</h2>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * Keys that arrived after the first render, kept for the row wash (800 ms). Runs before paint so a
 * live insert never shows un-animated; the first page never flashes.
 */
export function useFreshKeys(keys: readonly string[] | undefined): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState(NO_KEYS);
  const signature = keys?.join("|");
  useLayoutEffect(() => {
    if (!keys) return;
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    const known = seen.current;
    const added = keys.filter((k) => !known.has(k));
    if (added.length === 0) return;
    for (const k of added) known.add(k);
    setFresh((prev) => new Set([...prev, ...added]));
    const id = window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const k of added) next.delete(k);
        return next;
      });
    }, 1_000);
    return () => window.clearTimeout(id);
    // `signature` changes exactly when `keys` does.
  }, [signature]);
  return fresh;
}

const absolute = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "12s" · "4m" · "2h" · "3d", with the local date and time on hover (client only: time zones differ). */
export function RelativeTime({ ts, now, className }: { ts: number; now: number; className?: string }) {
  const mounted = useMounted();
  const text = timeAgo(ts, now).replace(" ago", "");
  if (!mounted) return <span className={cn("num", className)}>{text}</span>;
  return (
    <Tooltip content={absolute.format(new Date(ts * 1000))} className={className}>
      <span className="num">{text}</span>
    </Tooltip>
  );
}

/** Per-row explorer link (Hyperliquid ↗ convention). */
export function TxLink({ signature }: { signature: string }) {
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noreferrer"
      aria-label="View transaction on explorer"
      title="View transaction on explorer"
      className="relative inline-flex text-ink-3 transition-colors before:absolute before:-inset-3 hover:text-ink"
    >
      <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
    </a>
  );
}

/** A 0–100 percentage: "<0.01%", "0.47%", "12.4%". */
export function fmtPct(v: number): string {
  if (v <= 0) return "0%";
  if (v < 0.01) return "<0.01%";
  return `${v.toFixed(v >= 10 ? 1 : 2)}%`;
}

export interface LaunchRoles {
  creator: string;
  /** Backer wallet → share of the backer fee pool in bps. */
  shares: ReadonlyMap<string, number>;
  backers: readonly string[];
  loaded: boolean;
}

/** Who is who on this launch (role chips on makers, holders and comment authors). */
export function useLaunchRoles(l: LaunchSummary): LaunchRoles {
  const backers = useBackers(launchId(l));
  return useMemo(() => {
    const rows = backers.data?.backers ?? [];
    return {
      creator: l.creator,
      shares: new Map(rows.map((b) => [b.owner, b.shareBps])),
      backers: rows.map((b) => b.owner),
      loaded: backers.data !== undefined,
    };
  }, [backers.data, l.creator]);
}

/** "4.2% share" for a backer's pool share. */
export const shareDetail = (bps: number) => `${fmtPct(bps / 100)} share`;
