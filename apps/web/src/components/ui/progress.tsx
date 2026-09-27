import { cn } from "./cn";

/**
 * Raise progress with a minimum tick (§3.8.3, §4.5). The fill is `ink` until the minimum is
 * reached, then `accent` (the raise will lock); the tick turns from `ink-3` to `accent-ink`. Width
 * tweens over 600 ms. `size="sm"` = 4px (cards, tiles), `"md"` = 12px (raise panel, with labels).
 */
export function ProgressBar({
  value,
  max,
  min,
  size = "sm",
  minLabel,
  label = "Raise progress",
  className,
}: {
  value: number;
  max: number;
  /** Minimum to reach; omit for a plain bar. */
  min?: number;
  size?: "sm" | "md";
  /** Text under the tick on `md`, e.g. "min 2". */
  minLabel?: string;
  label?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const minPct = min !== undefined && max > 0 ? Math.min(100, Math.max(0, (min / max) * 100)) : null;
  const reached = min !== undefined && value >= min;
  return (
    <div className={cn("relative", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn("relative w-full overflow-hidden bg-sunken", size === "sm" ? "h-1 rounded-[2px]" : "h-3 rounded-xs")}
      >
        <div
          className={cn(
            "h-full transition-[width,background-color] duration-(--dur-5) ease-(--ease-out)",
            reached ? "bg-accent" : "bg-ink",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {minPct !== null ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-0 -translate-x-1/2 transition-colors duration-(--dur-5)",
            size === "sm" ? "-top-0.5 h-2 w-px" : "-top-0.5 h-4 w-0.5",
            reached ? "bg-accent-ink" : "bg-ink-3",
          )}
          style={{ left: `${minPct}%` }}
        />
      ) : null}
      {size === "md" && minLabel && minPct !== null ? (
        <span
          className={cn("micro num absolute top-5 -translate-x-1/2 whitespace-nowrap", reached ? "text-accent-ink" : "text-ink-3")}
          style={{ left: `${minPct}%` }}
        >
          {minLabel}
        </span>
      ) : null}
    </div>
  );
}
