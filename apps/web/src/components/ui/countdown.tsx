"use client";

import { useNow } from "@/lib/hooks";
import { cn } from "./cn";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2d 04h 07m" · "4h 07m" · "7m 12s" (§4.5: text only, no flip boxes). */
export function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(s % 60)}s`;
}

/**
 * Live text countdown to `to` (unix seconds). Turns `warn` below `warnBelowSecs` (1 h default, e.g.
 * a raise closing). Server-rendered against the request clock, so hydration matches.
 */
export function Countdown({
  to,
  prefix,
  endedLabel = "Closed",
  warnBelowSecs = 3_600,
  className,
}: {
  to: number;
  /** e.g. "Closes in". */
  prefix?: string;
  endedLabel?: string;
  warnBelowSecs?: number;
  className?: string;
}) {
  const now = useNow(1_000);
  const left = to - now;
  const ended = left <= 0;
  return (
    <span className={cn("num", !ended && left < warnBelowSecs && "text-warn", className)}>
      {ended ? endedLabel : prefix ? `${prefix} ${formatCountdown(left)}` : formatCountdown(left)}
    </span>
  );
}
