import type { ReactNode } from "react";
import { headlineSlot, type HeadlineStat as HeadlineStatKind, type InvariantContext } from "@/lib/thresholds";
import { cn } from "./cn";
import { RuleTooltip } from "./tooltip";

const VALUE_SIZES = {
  m: "h3 num",
  l: "num-l",
  xl: "num-xl",
};

/**
 * `label` over value (§4.5 stat row, §4.7 summary strip). `rule` turns the label into a dotted
 * RuleTooltip explaining the number in one sentence. `tone="warn"` for concentration thresholds;
 * never colour a stat up/down unless it *is* a price/PnL change (use `sub` for that).
 */
export function Stat({
  label,
  rule,
  value,
  sub,
  size = "l",
  tone,
  className,
}: {
  label: ReactNode;
  rule?: ReactNode;
  value: ReactNode;
  /** Secondary line under the value (`small ink-3`), e.g. "+2.26% of supply". */
  sub?: ReactNode;
  size?: keyof typeof VALUE_SIZES;
  tone?: "warn" | "accent";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label truncate text-ink-3">{rule ? <RuleTooltip rule={rule}>{label}</RuleTooltip> : label}</div>
      <div
        className={cn(
          "mt-1 truncate",
          VALUE_SIZES[size],
          tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent-ink" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub ? <div className="small num mt-0.5 truncate text-ink-3">{sub}</div> : null}
    </div>
  );
}

/**
 * A 1px-ruled strip of stats (token stat row, portfolio summary). Cells share the width and wrap
 * to a 2-column grid below 768px (or scroll with `scroll`).
 */
export function StatRow({ children, scroll, className }: { children: ReactNode; scroll?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        scroll
          ? "no-scrollbar flex overflow-x-auto [&>*]:min-w-36 [&>*]:shrink-0"
          : "grid grid-cols-2 md:auto-cols-fr md:grid-flow-col md:grid-cols-none",
        "border-y border-line [&>*]:border-line [&>*]:px-4 [&>*]:py-3",
        scroll ? "[&>*+*]:border-l" : "max-md:[&>*:nth-child(even)]:border-l max-md:[&>*:nth-child(n+3)]:border-t md:[&>*+*]:border-l",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A marketing/strip headline number gated by §5.3 (`lib/thresholds.ts`): shows the stat once it
 * clears its threshold, otherwise the invariant fallback ("Backer share of agent profit 100%"), otherwise
 * nothing. Tables and detail pages show real values directly — don't use this there.
 */
export function HeadlineStat({
  stat,
  value,
  label,
  format,
  rule,
  context,
  size = "l",
  className,
}: {
  stat: HeadlineStatKind;
  value: number | null | undefined;
  label: ReactNode;
  format: (value: number) => ReactNode;
  rule?: ReactNode;
  /** Platform facts for invariants, e.g. `{ backerFeeShareBps: platform.params.backerFeeShareBps }`. */
  context?: InvariantContext;
  size?: keyof typeof VALUE_SIZES;
  className?: string;
}) {
  const slot = headlineSlot(stat, value, context);
  if (slot.kind === "omit") return null;
  if (slot.kind === "invariant") {
    return <Stat label={slot.invariant.label} value={slot.invariant.value} size={size} className={className} />;
  }
  return <Stat label={label} rule={rule} value={format(slot.value)} size={size} className={className} />;
}
