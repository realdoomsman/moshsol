"use client";

import { fmtPrice, type AgentZones } from "@moshsol/sdk";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { CandlestickChart, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Timeframe } from "@/lib/api";
import { fmtSolValue } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { useCandles, useTrades } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { Segmented } from "../ui/interactive";
import { EmptyState, Skeleton } from "../ui/primitives";

const TIMEFRAMES: { value: string; label: string; tf: Timeframe }[] = [
  { value: "60", label: "1m", tf: 60 },
  { value: "300", label: "5m", tf: 300 },
  { value: "900", label: "15m", tf: 900 },
  { value: "3600", label: "1h", tf: 3600 },
  { value: "86400", label: "1d", tf: 86400 },
];

type Unit = "mcap" | "price";
const SUPPLY = 1_000_000_000;
const C = {
  up: "#2fe6a7",
  down: "#ff5c7c",
  ema: "#9d6bff",
  agentBuy: "#c6ff3d",
  agentSell: "#ff7ac3",
  text: "#8a92a0",
  grid: "rgba(255,255,255,0.035)",
  border: "rgba(255,255,255,0.08)",
};

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSol: number;
  agentBuys: number;
  agentSells: number;
}

interface ChartRefs {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  ema: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
  bandLines: IPriceLine[];
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthOnly = new Intl.DateTimeFormat("en-US", { month: "short" });

/** Axis ticks in the viewer's local time (the library would otherwise print UTC). */
function tickLabel(time: Time, type: TickMarkType): string {
  const d = new Date((time as number) * 1000);
  if (type === TickMarkType.Year) return String(d.getFullYear());
  if (type === TickMarkType.Month) return monthOnly.format(d);
  if (type === TickMarkType.DayOfMonth) return dayMonth.format(d);
  return clock.format(d);
}

function LegendValue({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="text-dim">{k}</span> <span className="text-ink">{v}</span>
    </span>
  );
}

function LineKey({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block w-3.5 border-t-2"
        style={{ borderColor: color, borderTopStyle: dashed ? "dashed" : "solid" }}
      />
      {label}
    </span>
  );
}

export function PriceChart({ launch: l, zones }: { launch: LaunchSummary; zones: AgentZones }) {
  const [tfValue, setTfValue] = useLocalStorage("moshsol:chart-tf", "60");
  const [unit, setUnit] = useLocalStorage<Unit>("moshsol:chart-unit", "mcap");
  const tf = (TIMEFRAMES.find((t) => t.value === tfValue) ?? TIMEFRAMES[0]).tf;
  const candles = useCandles(l.mint, tf);
  const trades = useTrades(l.mint, 500);
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<ChartRefs | null>(null);
  const fitted = useRef("");
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const mult = unit === "mcap" ? SUPPLY : 1;
  const fmt = unit === "mcap" ? fmtSolValue : fmtPrice;

  // Create the chart once.
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.text,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      localization: { timeFormatter: (t: Time) => dateTime.format(new Date((t as number) * 1000)) },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border, minimumWidth: 68, scaleMargins: { top: 0.2, bottom: 0.2 } },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        minBarSpacing: 3,
        maxBarSpacing: 22,
        tickMarkFormatter: tickLabel,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(198,255,61,0.3)", labelBackgroundColor: "#1a1e24" },
        horzLine: { color: "rgba(198,255,61,0.3)", labelBackgroundColor: "#1a1e24" },
      },
      handleScale: { axisPressedMouseMove: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      borderVisible: false,
      priceLineStyle: LineStyle.Dotted,
      // Keep at least ±6% of vertical range so flat markets (one candle, bundle-only) stay legible.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (!res?.priceRange) return res;
        const { minValue, maxValue } = res.priceRange;
        const mid = (minValue + maxValue) / 2;
        const minSpan = Math.abs(mid) * 0.12;
        if (maxValue - minValue >= minSpan) return res;
        return { ...res, priceRange: { minValue: mid - minSpan / 2, maxValue: mid + minSpan / 2 } };
      },
    });
    const ema = chart.addSeries(LineSeries, {
      color: C.ema,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    chart.subscribeCrosshairMove((p) => setHover(p.time === undefined ? null : (p.time as number)));
    refs.current = {
      chart,
      candles: candleSeries,
      ema,
      volume,
      markers: createSeriesMarkers(candleSeries, [], { autoScale: true }),
      bandLines: [],
    };
    setReady(true);
    return () => {
      chart.remove();
      refs.current = null;
    };
  }, []);

  // Price formatting follows the unit.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const priceFormat = { type: "custom" as const, formatter: fmt, minMove: unit === "mcap" ? 0.0001 : 1e-12 };
    r.candles.applyOptions({ priceFormat });
    r.ema.applyOptions({ priceFormat });
  }, [unit, fmt, ready]);

  const series = useMemo(() => {
    const cs = candles.data?.candles ?? [];
    const bars = new Map<number, Bar>();
    for (const c of cs) {
      bars.set(c.time, {
        time: c.time,
        open: c.open * mult,
        high: c.high * mult,
        low: c.low * mult,
        close: c.close * mult,
        volumeSol: c.volumeSol,
        agentBuys: 0,
        agentSells: 0,
      });
    }
    const asc = [...(trades.data?.trades ?? [])].sort((a, b) => a.timestamp - b.timestamp || a.slot - b.slot);
    const emaByBucket = new Map<number, number>();
    for (const t of asc) {
      const bar = bars.get(Math.floor(t.timestamp / tf) * tf);
      if (!bar) continue;
      if (t.emaSol > 0) emaByBucket.set(bar.time, t.emaSol * mult);
      if (t.isAgent && t.isBuy) bar.agentBuys += 1;
      else if (t.isAgent) bar.agentSells += 1;
    }
    // One small dot per candle and side, however many agent trades it holds (the legend has counts).
    const markers: SeriesMarker<Time>[] = [];
    for (const b of bars.values()) {
      if (b.agentBuys) {
        markers.push({ time: b.time as UTCTimestamp, position: "belowBar", shape: "circle", color: C.agentBuy, size: 0.5 });
      }
      if (b.agentSells) {
        markers.push({ time: b.time as UTCTimestamp, position: "aboveBar", shape: "circle", color: C.agentSell, size: 0.5 });
      }
    }
    return {
      bars,
      last: cs.length ? bars.get(cs[cs.length - 1].time)! : null,
      candles: [...bars.values()].map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
      volume: [...bars.values()].map((b) => ({
        time: b.time as UTCTimestamp,
        value: b.volumeSol,
        color: b.close >= b.open ? "rgba(47,230,167,0.22)" : "rgba(255,92,124,0.22)",
      })),
      ema: [...emaByBucket.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })),
      markers,
    };
  }, [candles.data, trades.data, tf, mult]);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.candles.setData(series.candles);
    r.volume.setData(series.volume);
    r.ema.setData(series.ema);
    r.markers.setMarkers(series.markers);
    const key = `${l.mint}:${tf}:${unit}:${series.candles.length > 0}`;
    if (fitted.current !== key && series.candles.length > 0) {
      fitted.current = key;
      // Wait a frame so autoSize has measured the container before fitting.
      requestAnimationFrame(() => refs.current?.chart.timeScale().fitContent());
    }
  }, [series, tf, unit, l.mint, ready]);

  // Agent thresholds as quiet dashed lines; their values live in the legend, not on the axis.
  const { buyBelow, sellAbove } = zones;
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    for (const line of r.bandLines) r.candles.removePriceLine(line);
    r.bandLines = [];
    if (!(buyBelow > 0 && sellAbove > 0)) return;
    const line = (price: number, color: string) =>
      r.candles.createPriceLine({
        price: price * mult,
        color,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        lineVisible: true,
      });
    r.bandLines.push(line(buyBelow, "rgba(198,255,61,0.45)"), line(sellAbove, "rgba(255,122,195,0.5)"));
  }, [buyBelow, sellAbove, mult, ready]);

  const shown = (hover !== null ? series.bars.get(hover) : undefined) ?? series.last;
  const change = shown && shown.open > 0 ? ((shown.close - shown.open) / shown.open) * 100 : null;
  const empty = !candles.isLoading && series.candles.length === 0;
  const fresh = !empty && l.tradeCount === 0;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 sm:px-4">
        <div className="no-scrollbar min-w-0 overflow-x-auto">
          <Segmented
            size="sm"
            ariaLabel="Timeframe"
            value={tfValue}
            onChange={setTfValue}
            options={TIMEFRAMES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        <Segmented<Unit>
          size="sm"
          className="shrink-0"
          ariaLabel="Chart unit"
          value={unit}
          onChange={setUnit}
          options={[
            { value: "mcap", label: "MCap" },
            { value: "price", label: "Price" },
          ]}
        />
      </div>
      <div className="relative mt-2 h-[320px] sm:h-[400px] lg:h-[440px]">
        <div ref={host} className="absolute inset-0" />
        {shown ? (
          <div className="pointer-events-none absolute top-1 left-3 z-10 grid max-w-[calc(100%-5.5rem)] gap-1 font-mono text-[11px] leading-tight sm:left-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="hidden text-muted sm:inline">{dateTime.format(new Date(shown.time * 1000))}</span>
              <LegendValue k="O" v={fmt(shown.open)} className="hidden sm:inline" />
              <LegendValue k="H" v={fmt(shown.high)} className="hidden sm:inline" />
              <LegendValue k="L" v={fmt(shown.low)} className="hidden sm:inline" />
              <LegendValue k="C" v={fmt(shown.close)} />
              {change !== null ? (
                <span className={change > 0 ? "text-up" : change < 0 ? "text-down" : "text-muted"}>
                  {change > 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              ) : null}
              <LegendValue k="Vol" v={`${fmtSolValue(shown.volumeSol)} SOL`} />
              {shown.agentBuys || shown.agentSells ? (
                <span className="text-cyan">
                  agent {shown.agentBuys ? <span className="text-lime">{shown.agentBuys} buy</span> : null}
                  {shown.agentBuys && shown.agentSells ? " · " : null}
                  {shown.agentSells ? <span className="text-pink">{shown.agentSells} sell</span> : null}
                </span>
              ) : null}
            </div>
            <div className="hidden flex-wrap items-center gap-x-3 gap-y-0.5 font-sans text-[11px] text-dim sm:flex">
              <LineKey color={C.ema} label={`EMA ${fmt(zones.ema * mult)}`} />
              <LineKey color={C.agentBuy} dashed label={`agent buys ≤ ${fmt(buyBelow * mult)}`} />
              <LineKey color={C.agentSell} dashed label={`agent sells ≥ ${fmt(sellAbove * mult)}`} />
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-lime" aria-hidden />
                <span className="size-1.5 rounded-full bg-pink" aria-hidden /> agent trade
              </span>
            </div>
          </div>
        ) : null}
        {candles.isLoading ? <Skeleton className="absolute inset-4" /> : null}
        {empty ? (
          <div className="absolute inset-0 grid place-items-center">
            <EmptyState icon={<CandlestickChart className="size-5" aria-hidden />} title="No candles yet">
              The chart starts at the bundle buy.
            </EmptyState>
          </div>
        ) : null}
        {fresh ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full border border-line bg-bg/85 px-3.5 py-2 text-xs text-muted backdrop-blur">
              <Sparkles className="size-3.5 text-lime" aria-hidden />
              Fresh launch — the bundle is in. Candles fill in with the first trades.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
