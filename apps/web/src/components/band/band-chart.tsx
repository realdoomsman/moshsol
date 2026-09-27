"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../ui/cn";
import { type AgentMarker, type BandPoint, bandEdges } from "./model";
import { useElementSize } from "./use-size";

/** Right gutter for the SELLS / EMA / BUYS labels. */
const GUTTER = 56;
const PAD_Y = 16;
const LABEL_GAP = 15;

/**
 * The Band (§4.2 §1): price line in ink, the on-chain EMA dotted, the agent band (EMA ± band from
 * the launch's terms) as dashed accent edges over a 7% fill, and vault-agent trades as diamonds
 * (filled = buy, outline = sell). On first load (and on `drawKey` change) the line draws left →
 * right over 1600 ms, the band fades in, diamonds pop in sequence and the callout slides up.
 * Reduced motion renders the final state. Callers guarantee ≥ `BAND_MIN_POINTS` points.
 */
export function BandChart({
  points,
  bandBps,
  markers,
  callout,
  height,
  drawKey = 0,
  className,
}: {
  points: BandPoint[];
  bandBps: number;
  markers: AgentMarker[];
  /** One line about the latest agent trade ("Agent bought 0.12 SOL · −2.4% vs EMA"). */
  callout: string | null;
  height: number;
  drawKey?: number;
  className?: string;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>({ width: 640, height });
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  const clipId = `band-clip-${useId().replace(/[^\w-]/g, "")}`;

  useEffect(() => {
    setDrawn(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [drawKey]);

  // The price dot pulses once when a live trade appends a point (never on first render).
  const last = points[points.length - 1];
  const firstLast = useRef(last?.time);
  const pulse = last && last.time !== firstLast.current ? last.time : null;

  const w = size.width;
  const h = height;
  const plotW = Math.max(40, w - GUTTER);
  const t0 = points[0]?.time ?? 0;
  const t1 = last?.time ?? 1;
  // Price history, agent trades and the band as it stands now set the scale; an EMA still catching
  // up from launch (far under price) runs off the bottom edge instead of squashing the price line.
  const withEma = points.filter((p): p is BandPoint & { ema: number } => p.ema !== null);
  const lastEma = withEma[withEma.length - 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of [...points.map((p) => p.price), ...markers.map((m) => m.price)]) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (lastEma) {
    const e = bandEdges(lastEma.ema, bandBps);
    lo = Math.min(lo, e.low);
    hi = Math.max(hi, e.high);
  }
  const span = hi - lo || hi * 0.02 || 1;
  lo -= span * 0.12;
  hi += span * 0.12;
  const x = (t: number) => (t1 === t0 ? plotW : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (h - PAD_Y * 2);

  const line = (pts: { t: number; v: number }[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const highs = withEma.map((p) => ({ t: p.time, v: bandEdges(p.ema, bandBps).high }));
  const lows = withEma.map((p) => ({ t: p.time, v: bandEdges(p.ema, bandBps).low }));
  const pricePath = line(points.map((p) => ({ t: p.time, v: p.price })));
  const emaPath = line(withEma.map((p) => ({ t: p.time, v: p.ema })));
  const fillPath =
    highs.length > 1 ? `${line(highs)}L${[...lows].reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("L")}Z` : "";

  let labels: { yHigh: number; yEma: number; yLow: number } | null = null;
  if (lastEma) {
    const e = bandEdges(lastEma.ema, bandBps);
    const yEma = y(lastEma.ema);
    labels = { yHigh: Math.min(y(e.high), yEma - LABEL_GAP), yEma, yLow: Math.max(y(e.low), yEma + LABEL_GAP) };
  }

  const animate = drawn && !reduced;
  const final = drawn || !!reduced;
  const drawMs = 1600;
  const bandDelay = drawMs;
  const markerDelay = (i: number) => drawMs + 400 + i * 80;
  const latest = markers[markers.length - 1];

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 overflow-visible" aria-hidden>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={plotW} y1={PAD_Y + f * (h - PAD_Y * 2)} y2={PAD_Y + f * (h - PAD_Y * 2)} className="stroke-line" strokeWidth={1} />
        ))}
        <clipPath id={clipId}>
          <rect x={0} y={0} width={plotW} height={h} />
        </clipPath>
        <g
          clipPath={`url(#${clipId})`}
          className={cn(animate && "transition-opacity duration-400 ease-(--ease-out)")}
          style={{ opacity: final ? 1 : 0, transitionDelay: animate ? `${bandDelay}ms` : undefined }}
        >
          {fillPath ? <path d={fillPath} className="fill-accent" fillOpacity={0.07} /> : null}
          {highs.length > 1 ? (
            <path d={line(highs)} fill="none" className="stroke-accent" strokeWidth={1} strokeDasharray="4 4" />
          ) : null}
          {lows.length > 1 ? (
            <path d={line(lows)} fill="none" className="stroke-accent" strokeWidth={1} strokeDasharray="4 4" />
          ) : null}
          {withEma.length > 1 ? (
            <path d={emaPath} fill="none" className="stroke-ink-3" strokeWidth={1.25} strokeDasharray="1.5 3" strokeLinecap="round" />
          ) : null}
        </g>
        <path
          d={pricePath}
          fill="none"
          className={cn("stroke-ink", animate && "transition-[stroke-dashoffset] duration-(--dur-6) ease-(--ease-in-out)")}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={final ? 0 : 1}
        />
        {markers.map((m, i) => {
          const cx = x(m.time);
          const cy = y(m.price);
          return (
            <g key={m.signature} transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)})`}>
              <rect
                x={-4}
                y={-4}
                width={8}
                height={8}
                transform="rotate(45)"
                className={cn(
                  m.side === "buy" ? "fill-accent stroke-accent" : "fill-surface stroke-accent",
                  animate && "transition-[scale] duration-(--dur-4) ease-(--ease-spring)",
                )}
                strokeWidth={1.5}
                style={{
                  scale: final ? 1 : 0,
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  transitionDelay: animate ? `${markerDelay(i)}ms` : undefined,
                }}
              />
            </g>
          );
        })}
        {last ? (
          <g transform={`translate(${x(last.time).toFixed(1)} ${y(last.price).toFixed(1)})`}>
            {pulse !== null && !reduced ? (
              <motion.circle
                key={pulse}
                r={3}
                className="fill-none stroke-ink"
                strokeWidth={1}
                initial={{ r: 3, opacity: 0.6 }}
                animate={{ r: 11, opacity: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
            <circle
              r={3.5}
              className={cn("fill-ink", animate && "transition-opacity duration-(--dur-3)")}
              style={{ opacity: final ? 1 : 0, transitionDelay: animate ? `${drawMs}ms` : undefined }}
            />
          </g>
        ) : null}
      </svg>
      {labels ? (
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-y-0 right-0", animate && "transition-opacity duration-400")}
          style={{ width: GUTTER - 8, opacity: final ? 1 : 0, transitionDelay: animate ? `${bandDelay}ms` : undefined }}
        >
          <span className="label absolute left-0 -translate-y-1/2 text-accent-ink" style={{ top: labels.yHigh }}>
            Sells
          </span>
          <span className="label absolute left-0 -translate-y-1/2 text-ink-3" style={{ top: labels.yEma }}>
            EMA
          </span>
          <span className="label absolute left-0 -translate-y-1/2 text-accent-ink" style={{ top: labels.yLow }}>
            Buys
          </span>
        </div>
      ) : null}
      {callout && latest ? (
        <p
          className={cn(
            "micro pointer-events-none absolute max-w-[260px] rounded-xs bg-ink px-2 py-1 text-paper",
            animate && "transition-[opacity,translate] duration-(--dur-4) ease-(--ease-out)",
          )}
          style={{
            left: Math.min(Math.max(x(latest.time), 130), plotW - 110),
            top: Math.min(y(latest.price) + 14, h - 30),
            opacity: final ? 1 : 0,
            translate: final ? "-50% 0" : "-50% 8px",
            transitionDelay: animate ? `${markerDelay(markers.length)}ms` : undefined,
          }}
        >
          {callout}
        </p>
      ) : null}
    </div>
  );
}
