"use client";

import { fmtPrice, type CurveState } from "@holdfast/sdk";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useVenueCurve } from "@/lib/chain";
import { useNow } from "@/lib/hooks";
import type { LaunchSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { fmtDeviation, simulateAgent, simulatorDomain, simulatorPresets, type SimAction, type SimDecision } from "./model";
import { useElementSize } from "./use-size";

const PAD = 28;
/** Line height of a `micro` level label. */
const LABEL_H = 16;

type Level = { key: string; p: number; label: string; className: string; text: string; dash?: string; left?: boolean };

/**
 * Stacks level labels so they never overlap: levels closer than a label's height merge into one
 * block (rows in line order) that sits above the top-most line, or below the bottom-most when there
 * is no room above. Blocks are then pushed apart top to bottom and kept inside the diagram.
 */
function labelBlocks(levels: (Level & { y: number })[], h: number): { top: number; rows: (Level & { y: number })[] }[] {
  const groups: (Level & { y: number })[][] = [];
  for (const l of [...levels].sort((a, b) => a.y - b.y)) {
    const g = groups[groups.length - 1];
    if (g && l.y - g[g.length - 1].y < LABEL_H + 2) g.push(l);
    else groups.push([l]);
  }
  let floor = 0;
  return groups.map((rows) => {
    const blockH = rows.length * LABEL_H;
    const above = rows[0].y - 2 - blockH;
    let top = above >= floor ? above : rows[rows.length - 1].y + 2;
    top = Math.max(floor, Math.min(top, h - blockH));
    floor = top + blockH;
    return { top, rows };
  });
}

const ACTION_TAG: Record<SimAction, { label: string; className: string }> = {
  buy: { label: "Buy", className: "bg-up-wash text-up" },
  sell: { label: "Sell", className: "bg-down-wash text-down" },
  hold: { label: "Hold", className: "bg-raised text-ink-2" },
};

/** Buy / Sell / Hold tag: Buy and Sell are the only places up/down colour is allowed (§3.4). `label` overrides the copy. */
export function ActionTag({ action, label, className }: { action: SimAction; label?: string; className?: string }) {
  const t = ACTION_TAG[action];
  return (
    <span className={cn("label inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-xs px-2", t.className, className)}>
      {label ?? t.label}
    </span>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The agent simulator (§4.2 §5): the launch's band, EMA and vault cost line with a draggable price
 * handle. Every position is evaluated with `simulateAgent` — the on-chain agent rules from the
 * launch's frozen terms, applied to its real vault, window budgets and the venue's reserves (the
 * Holdfast curve, or the pump.fun curve / PumpSwap pool read from chain) — and the decision card
 * updates as you drag. `compact` is the hero variant (no presets, summary overlay).
 */
export function AgentSimulator({ launch, compact = false, className }: { launch: LaunchSummary; compact?: boolean; className?: string }) {
  const curve = useVenueCurve(launch);
  if (curve === undefined) return <Skeleton className={cn(compact ? "h-[300px]" : "h-[560px]", "w-full rounded-md", className)} />;
  if (curve === null) return <EmptyState className={className}>The venue&rsquo;s reserves can&rsquo;t be read right now, so there is nothing to simulate.</EmptyState>;
  return <Simulator launch={launch} curve={curve} compact={compact} className={className} />;
}

function Simulator({ launch, curve, compact, className }: { launch: LaunchSummary; curve: CurveState; compact: boolean; className?: string }) {
  const nowSec = useNow(15_000);
  /** A preset outside the everyday range (the dump below cost) widens the domain to show it; drags never do. */
  const [jump, setJump] = useState<number | null>(null);
  const domain = useMemo(() => simulatorDomain(launch, curve, nowSec, jump), [launch, curve, nowSec, jump]);
  const presets = useMemo(() => simulatorPresets(launch, curve, nowSec), [launch, curve, nowSec]);
  const [chosen, setChosen] = useState<number | null>(null);
  /** The curve can't trade below its floor, so neither can the handle. */
  const lowest = Math.max(domain.min, domain.floor);
  const clamp = (p: number) => Math.min(domain.max, Math.max(lowest, p));
  const price = clamp(chosen ?? launch.priceSol);
  const decision = useMemo(() => simulateAgent(launch, curve, price, nowSec), [launch, curve, price, nowSec]);

  const height = compact ? 300 : 560;
  const hatchId = `floor-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [boxRef, box] = useElementSize<HTMLDivElement>({ width: compact ? 640 : 820, height });
  const w = box.width;
  const h = box.height;
  const dragging = useRef(false);

  const y = (p: number) => PAD + (1 - (p - domain.min) / (domain.max - domain.min)) * (h - PAD * 2);
  const priceAt = (py: number) => domain.min + (1 - (py - PAD) / (h - PAD * 2)) * (domain.max - domain.min);
  const setFromPointer = (e: PointerEvent<HTMLElement>) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) setChosen(clamp(priceAt(e.clientY - r.top)));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = (domain.max - domain.min) * (e.key.startsWith("Page") ? 0.05 : 0.01);
    const next =
      e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "PageUp"
        ? price + step
        : e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "PageDown"
          ? price - step
          : e.key === "Home"
            ? domain.max
            : e.key === "End"
              ? lowest
              : null;
    if (next === null) return;
    e.preventDefault();
    setChosen(clamp(next));
  };

  const z = decision.zones;
  const hx = w * (compact ? 0.5 : 0.56);
  const hy = y(price);
  const narrow = w < 520;
  const showSellFloor = z.sellAbove > z.bandHigh * 1.001;
  const levels: Level[] = [
    { key: "high", p: z.bandHigh, label: "Sells above", className: "stroke-accent", text: "text-accent-ink", dash: "5 4" },
    { key: "ema", p: z.ema, label: "EMA", className: "stroke-ink-3", text: "text-ink-3", dash: "1.5 3.5" },
    { key: "low", p: z.bandLow, label: "Buys below", className: "stroke-accent", text: "text-accent-ink", dash: "5 4" },
    { key: "cost", p: z.avgCost, label: "Vault avg cost", className: "stroke-accent-ink", text: "text-accent-ink", left: true },
  ];
  if (showSellFloor) {
    levels.push({
      key: "sellfloor",
      p: z.sellAbove,
      label: "Min sell fill",
      className: "stroke-accent-ink",
      text: "text-accent-ink",
      dash: "2 3",
      left: true,
    });
  }
  const lines = levels.filter((l) => l.p >= domain.min && l.p <= domain.max);
  const placed = lines.map((l) => ({ ...l, y: y(l.p) }));
  const blocks = [...labelBlocks(placed.filter((l) => !l.left), h), ...labelBlocks(placed.filter((l) => l.left), h)];
  // Levels off the chart are pinned to the edge they lie beyond, with their value.
  const pinnedBelow = [
    ...levels.filter((l) => l.p < domain.min),
    ...(domain.floor < domain.min ? [{ key: "floor", p: domain.floor, label: "Curve start", text: "text-ink-3" }] : []),
  ].sort((a, b) => b.p - a.p);
  const pinnedAbove = levels.filter((l) => l.p > domain.max).sort((a, b) => b.p - a.p);
  const cardY = h / 2;
  const beamKey = `${decision.action}:${decision.checks.map((c) => (c.ok ? 1 : 0)).join("")}`;

  const diagram = (
    <div
      ref={boxRef}
      className="relative h-full min-h-0 w-full cursor-ns-resize select-none overflow-hidden"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setFromPointer(e);
      }}
    >
      <svg width={w} height={h} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          {/* Below the curve floor the price can't trade: a hairline hatch, not a grey slab. */}
          <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} className="stroke-line-2" strokeWidth={1} />
          </pattern>
        </defs>
        <rect x={0} width={w} y={y(z.bandHigh)} height={Math.max(0, y(z.bandLow) - y(z.bandHigh))} className="fill-accent" fillOpacity={0.07} />
        {domain.floor > domain.min ? (
          <>
            <rect x={0} width={w} y={y(domain.floor)} height={Math.max(0, h - y(domain.floor))} fill={`url(#${hatchId})`} />
            <line x1={0} x2={w} y1={y(domain.floor)} y2={y(domain.floor)} className="stroke-line-2" strokeWidth={1} />
          </>
        ) : null}
        {lines.map((l) => (
          <line
            key={l.key}
            x1={0}
            x2={w}
            y1={y(l.p)}
            y2={y(l.p)}
            className={l.className}
            strokeWidth={l.key === "ema" ? 1.25 : 1}
            strokeDasharray={l.dash}
            strokeLinecap={l.key === "ema" ? "round" : undefined}
          />
        ))}
        {!compact ? (
          <AnimatePresence initial={false}>
            <motion.path
              key={beamKey}
              d={`M${hx + 8},${hy} C${(hx + w) / 2},${hy} ${(hx + w) / 2},${cardY} ${w},${cardY}`}
              fill="none"
              className="hidden stroke-accent @[760px]:block"
              strokeWidth={1.25}
              initial={{ pathLength: 0, opacity: 1 }}
              animate={{ pathLength: 1, opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            />
          </AnimatePresence>
        ) : null}
        {narrow ? null : <line x1={hx - 36} x2={hx} y1={hy} y2={hy} className="stroke-ink" strokeWidth={1.5} />}
        <circle cx={hx} cy={hy} r={7} className="fill-ink" />
      </svg>
      {blocks.map((b) => (
        <span
          key={b.rows.map((r) => r.key).join(":")}
          className={cn("micro num pointer-events-none absolute whitespace-nowrap", b.rows[0].left ? "left-3" : "right-3 text-right")}
          style={{ top: b.top }}
        >
          {b.rows.map((r) => (
            <span key={r.key} className={cn("block", r.text)}>
              {r.label} <span className="text-ink-3">{fmtPrice(r.p)}</span>
            </span>
          ))}
        </span>
      ))}
      {pinnedBelow.length ? (
        <span className="micro num pointer-events-none absolute bottom-1.5 left-3 flex flex-wrap gap-x-4 whitespace-nowrap">
          {pinnedBelow.map((l) => (
            <span key={l.key} className={cn("inline-flex items-center gap-1", l.text)}>
              <ChevronDown className="size-3 shrink-0" strokeWidth={2} aria-hidden />
              {l.label} <span className="text-ink-3">{fmtPrice(l.p)}</span>
            </span>
          ))}
        </span>
      ) : null}
      {pinnedAbove.length ? (
        <span className="micro num pointer-events-none absolute right-3 top-1.5 flex flex-wrap justify-end gap-x-4 whitespace-nowrap">
          {pinnedAbove.map((l) => (
            <span key={l.key} className={cn("inline-flex items-center gap-1", l.text)}>
              <ChevronUp className="size-3 shrink-0" strokeWidth={2} aria-hidden />
              {l.label} <span className="text-ink-3">{fmtPrice(l.p)}</span>
            </span>
          ))}
        </span>
      ) : null}
      {domain.floor > domain.min ? (
        <span
          className="micro num pointer-events-none absolute left-3 whitespace-nowrap pt-1 text-ink-3"
          style={{ top: y(domain.floor) }}
        >
          Curve start {fmtPrice(domain.floor)} · lowest price the curve can quote
        </span>
      ) : null}
      <span
        className={cn(
          "micro num pointer-events-none absolute whitespace-nowrap rounded-xs bg-ink px-1.5 py-0.5 text-paper",
          narrow ? "-translate-x-1/2 -translate-y-full" : "-translate-x-full -translate-y-1/2",
        )}
        // Narrow diagrams: above the handle, clear of the edge-aligned line labels.
        style={narrow ? { left: hx, top: hy - 12 } : { left: hx - 38, top: hy }}
      >
        {fmtPrice(price)} · {fmtDeviation(decision.deviation)}
      </span>
      <button
        type="button"
        role="slider"
        aria-label="Simulated price"
        aria-valuemin={lowest}
        aria-valuemax={domain.max}
        aria-valuenow={price}
        aria-valuetext={`${fmtPrice(price)} SOL, ${fmtDeviation(decision.deviation)} vs EMA`}
        className="absolute size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full active:cursor-grabbing"
        style={{ left: hx, top: hy }}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
        }}
        onPointerMove={(e) => {
          if (dragging.current) setFromPointer(e);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      />
    </div>
  );

  if (compact) {
    return (
      <div className={cn("relative", className)} style={{ height }}>
        {diagram}
        <div className="pointer-events-none absolute left-4 top-3 max-w-[70%]">
          <p className="flex items-center gap-2">
            <ActionTag action={decision.action} />
            <span className="small num truncate text-ink">{decision.size ?? sentence(decision.reason)}</span>
          </p>
          <p className="micro mt-1 text-ink-3">Simulated with the vault agent&rsquo;s rules · drag the price</p>
        </div>
      </div>
    );
  }

  // Side by side only when the panel itself is wide enough (the landing), stacked in narrow homes (docs).
  return (
    <div className={cn("@container", className)}>
      <div className="grid overflow-hidden rounded-md border border-line bg-surface @[760px]:h-[560px] @[760px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative flex min-h-0 flex-col">
          <div className="order-2 flex flex-wrap gap-2 border-t border-line p-4 @[760px]:order-1 @[760px]:border-t-0 @[760px]:pb-0">
            {presets.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant="secondary"
                onClick={() => {
                  setJump(p.price);
                  setChosen(p.price);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="order-1 h-[320px] min-h-0 @[760px]:order-2 @[760px]:h-auto @[760px]:flex-1">{diagram}</div>
        </div>
        <DecisionCard decision={decision} animKey={beamKey} symbol={launch.symbol} />
      </div>
    </div>
  );
}

function DecisionCard({ decision, animKey, symbol }: { decision: SimDecision; animKey: string; symbol: string }) {
  return (
    <div className="flex flex-col justify-center border-t border-line p-5 @[760px]:border-l @[760px]:border-t-0 @[760px]:p-6" aria-live="polite">
      <p className="label text-ink-3">Vault agent decision</p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={animKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="mt-3"
        >
          <div className="flex items-center gap-2">
            <ActionTag action={decision.action} />
            <span className="ui num text-ink">{decision.size ?? "No trade"}</span>
          </div>
          <p className="small mt-3 text-ink-2">{sentence(decision.reason)}</p>
          <ul className="mt-4 grid border-t border-line">
            {decision.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 border-b border-line py-2.5">
                {c.ok ? (
                  <Check className="size-4 shrink-0 text-ink" strokeWidth={2} aria-label="Passes" />
                ) : (
                  <X className="size-4 shrink-0 text-ink-3" strokeWidth={2} aria-label="Fails" />
                )}
                <span className={cn("small min-w-0 flex-1", c.ok ? "text-ink" : "text-ink-3")}>{c.label}</span>
                <span className="micro num shrink-0 text-ink-3">{c.detail}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>
      <p className="micro mt-4 text-ink-3">
        {decision.side === "buy" ? "Buy" : "Sell"} rules from ${symbol}&rsquo;s terms, frozen at creation · on-chain checks only
      </p>
    </div>
  );
}
