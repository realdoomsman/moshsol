"use client";

import { useId } from "react";
import { SPARKLINE_MIN_POINTS } from "@/lib/thresholds";
import { cn } from "./cn";

/**
 * Price sparkline (§1.3 zora style): 1.5px stroke in the direction colour, fill fading to
 * transparent (the chart-fill exception to "no gradients"), end dot. Fewer than 12 points renders
 * "—" — never a two-point diagonal. `className` sets the size (default `h-8 w-24`).
 */
export function Sparkline({ values, className = "h-8 w-24" }: { values: number[]; className?: string }) {
  const gid = useId().replace(/:/g, "");
  if (values.length < SPARKLINE_MIN_POINTS) {
    return (
      <span className="small text-ink-3" aria-label="Not enough trades for a chart">
        —
      </span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.02 || 1;
  const w = 100;
  const h = 32;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const stroke = values[values.length - 1] >= values[0] ? "var(--color-up)" : "var(--color-down)";
  const [lastX, lastY] = pts[pts.length - 1];
  return (
    <span className={cn("relative inline-block", className)} aria-hidden>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.12" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${lastX}%`, top: `${(lastY / h) * 100}%`, background: stroke }}
      />
    </span>
  );
}
