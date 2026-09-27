"use client";

import { fmtPrice, type AgentZones } from "@moshsol/sdk";
import {
  AreaSeries,
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
import { CandlestickChart, LineChart, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Timeframe } from "@/lib/api";
import { fmtSolValue } from "@/lib/format";
import { useLocalStorage, useMounted, useNow } from "@/lib/hooks";
import { useCandles, useTrades } from "@/lib/queries";
import type { Candle, LaunchSummary } from "@/lib/types";
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

/** Auto timeframe: the finest one that keeps the chart to at most this many bars. */
const MAX_AUTO_BARS = 240;
/** Below this many bars, "auto" draws a line instead of candles. */
const LINE_BELOW = 12;
/** Below this many bars the view is spread across the full width instead of `fitContent`. */
const SPARSE_BARS = 40;

type Unit = "mcap" | "price";
type ChartType = "auto" | "line" | "candles";
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
  area: ISeriesApi<"Area">;
  ema: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  candleMarkers: ISeriesMarkersPluginApi<Time>;
  areaMarkers: ISeriesMarkersPluginApi<Time>;
  bandLines: { series: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">; line: IPriceLine }[];
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

/** Keeps at least `pct` of the mid price in view so near-flat markets don't blow up noise. */
function minSpan(pct: number) {
  return (original: () => AutoscaleInfo | null) => {
    const res = original();
    if (!res?.priceRange) return res;
    const { minValue, maxValue } = res.priceRange;
    const mid = (minValue + maxValue) / 2;
    const span = Math.abs(mid) * pct;
    if (maxValue - minValue >= span) return res;
    return { ...res, priceRange: { minValue: mid - span / 2, maxValue: mid + span / 2 } };
  };
}

/**
 * The finest timeframe whose bar count stays readable, counted from 1m candles (buckets only exist
 * where trades happened, so sparse launches stay on 1m for the most detail).
 */
function autoTimeframe(minute: Candle[] | undefined): Timeframe {
  if (!minute?.length) return 60;
  for (const { tf } of TIMEFRAMES) {
    const buckets = new Set(minute.map((c) => Math.floor(c.time / tf))).size;
    if (buckets <= MAX_AUTO_BARS) return tf;
  }
  return 86400;
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
  const [tfChoice, setTfChoice] = useLocalStorage<string | null>("moshsol:chart-tf", null);
  const [unit, setUnit] = useLocalStorage<Unit>("moshsol:chart-unit", "mcap");
  const [typeChoice, setTypeChoice] = useLocalStorage<ChartType>("moshsol:chart-type", "auto");
  const minute = useCandles(l.mint, 60);
  const autoTf = useMemo(() => autoTimeframe(minute.data?.candles), [minute.data]);
  const tf = TIMEFRAMES.find((t) => t.value === tfChoice)?.tf ?? autoTf;
  const candles = useCandles(l.mint, tf);
  const trades = useTrades(l.mint, 500);
  const now = useNow(30_000);
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<ChartRefs | null>(null);
  const fitted = useRef("");
  const refit = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useMounted();
  const [hover, setHover] = useState<number | null>(null);
  const mult = unit === "mcap" ? SUPPLY : 1;
  const fmt = unit === "mcap" ? fmtSolValue : fmtPrice;
  const barCount = candles.data?.candles.length ?? 0;
  const type: Exclude<ChartType, "auto"> =
    typeChoice === "auto" ? (barCount < LINE_BELOW ? "line" : "candles") : typeChoice;

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
      autoscaleInfoProvider: minSpan(0.12),
    });
    const area = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineStyle: LineStyle.Dotted,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBorderColor: "#060708",
      visible: false,
      autoscaleInfoProvider: minSpan(0.04),
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
      area,
      ema,
      volume,
      candleMarkers: createSeriesMarkers(candleSeries, [], { autoScale: true }),
      areaMarkers: createSeriesMarkers(area, [], { autoScale: true }),
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
    r.area.applyOptions({ priceFormat });
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
    // One small dot per bar and side, however many agent trades it holds (the legend has counts).
    const markers: SeriesMarker<Time>[] = [];
    for (const b of bars.values()) {
      if (b.agentBuys) {
        markers.push({ time: b.time as UTCTimestamp, position: "belowBar", shape: "circle", color: C.agentBuy, size: 0.5 });
      }
      if (b.agentSells) {
        markers.push({ time: b.time as UTCTimestamp, position: "aboveBar", shape: "circle", color: C.agentSell, size: 0.5 });
      }
    }
    const list = [...bars.values()];
    const first = list[0];
    const last = list.at(-1);
    // Line view: the first bucket's open, every close, then the current price carried to now, so a
    // launch with a single trade still draws a line across the chart.
    const line: { time: UTCTimestamp; value: number }[] = [];
    if (first && last) {
      line.push({ time: (first.time - tf) as UTCTimestamp, value: first.open });
      for (const b of list) line.push({ time: b.time as UTCTimestamp, value: b.close });
      const current = Math.floor(now / tf) * tf;
      if (current > last.time && l.priceSol > 0) line.push({ time: current as UTCTimestamp, value: l.priceSol * mult });
    }
    return {
      bars,
      last: last ?? null,
      up: first && last ? last.close >= first.open : true,
      candles: list.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })),
      line,
      volume: list.map((b) => ({
        time: b.time as UTCTimestamp,
        value: b.volumeSol,
        color: b.close >= b.open ? "rgba(47,230,167,0.22)" : "rgba(255,92,124,0.22)",
      })),
      ema: [...emaByBucket.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })),
      markers,
    };
  }, [candles.data, trades.data, tf, mult, now, l.priceSol]);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const line = type === "line";
    const tone = series.up ? C.up : C.down;
    r.candles.applyOptions({ visible: !line });
    r.area.applyOptions({
      visible: line,
      lineColor: tone,
      topColor: series.up ? "rgba(47,230,167,0.32)" : "rgba(255,92,124,0.32)",
      bottomColor: series.up ? "rgba(47,230,167,0.01)" : "rgba(255,92,124,0.01)",
      crosshairMarkerBackgroundColor: tone,
    });
    // Volume bars would be slabs at line-mode spacing; the legend still reports each bucket's volume.
    r.volume.applyOptions({ visible: !line });
    r.chart.applyOptions({ crosshair: { mode: line ? CrosshairMode.Magnet : CrosshairMode.Normal } });
    r.candles.setData(series.candles);
    r.area.setData(series.line);
    r.volume.setData(series.volume);
    r.ema.setData(series.ema);
    r.candleMarkers.setMarkers(line ? [] : series.markers);
    r.areaMarkers.setMarkers(line ? series.markers : []);

    const count = line ? series.line.length : series.candles.length;
    // Sparse views re-fit as points arrive; dense ones fit once so a user's zoom isn't reset.
    const key = `${l.mint}:${tf}:${unit}:${type}:${count >= SPARSE_BARS ? "dense" : count}`;
    if (fitted.current === key || count === 0) return;
    fitted.current = key;
    const fit = () => {
      const ts = refs.current?.chart.timeScale();
      if (!ts) return;
      if (count >= SPARSE_BARS) {
        ts.applyOptions({ maxBarSpacing: 22, rightOffset: 6 });
        ts.fitContent();
      } else if (line) {
        // Spread the line edge to edge, keeping ~4% of the width clear at each end. A logical range
        // [from, to] spans (to - from + 1) bar slots, with each point centred in its slot.
        const width = Math.max(120, ts.width());
        const padPx = Math.max(28, width * 0.04);
        const pad = padPx / ((width - 2 * padPx) / (count - 1));
        ts.applyOptions({ maxBarSpacing: width, rightOffset: 0 });
        ts.setVisibleLogicalRange({ from: 0.5 - pad, to: count - 1.5 + pad });
      } else {
        // Centre a few fat candles instead of pinning them to the right edge.
        const spacing = 36;
        const half = (Math.max(120, ts.width()) / spacing - 1) / 2;
        const mid = (count - 1) / 2;
        ts.applyOptions({ maxBarSpacing: spacing, rightOffset: 0 });
        ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
      }
    };
    // Sparse fits depend on the width, so they're re-applied when the chart resizes.
    refit.current = count >= SPARSE_BARS ? null : fit;
    // Wait a frame so autoSize has measured the container before fitting.
    requestAnimationFrame(fit);
  }, [series, tf, unit, type, l.mint, ready]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => refit.current?.());
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Agent thresholds as quiet dashed lines on the visible series; their values live in the legend.
  const { buyBelow, sellAbove } = zones;
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    for (const { series: s, line } of r.bandLines) s.removePriceLine(line);
    r.bandLines = [];
    if (!(buyBelow > 0 && sellAbove > 0)) return;
    const target = type === "line" ? r.area : r.candles;
    const add = (price: number, color: string) => {
      const line = target.createPriceLine({
        price: price * mult,
        color,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        lineVisible: true,
      });
      r.bandLines.push({ series: target, line });
    };
    add(buyBelow, "rgba(198,255,61,0.45)");
    add(sellAbove, "rgba(255,122,195,0.5)");
  }, [buyBelow, sellAbove, mult, type, ready]);

  const shown = (hover !== null ? series.bars.get(hover) : undefined) ?? series.last;
  const change = shown && shown.open > 0 ? ((shown.close - shown.open) / shown.open) * 100 : null;
  const empty = !candles.isLoading && series.candles.length === 0;
  // tradeCount includes the launch's bundle buy.
  const fresh = !empty && l.tradeCount <= 1;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 sm:px-4">
        <div className="no-scrollbar min-w-0 overflow-x-auto">
          <Segmented
            size="sm"
            ariaLabel="Timeframe"
            value={String(tf)}
            onChange={setTfChoice}
            options={TIMEFRAMES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Segmented<Exclude<ChartType, "auto">>
            size="sm"
            ariaLabel="Chart type"
            value={type}
            onChange={setTypeChoice}
            options={[
              {
                value: "line",
                label: (
                  <>
                    <LineChart className="size-3.5" aria-hidden />
                    <span className="sr-only sm:not-sr-only">Line</span>
                  </>
                ),
              },
              {
                value: "candles",
                label: (
                  <>
                    <CandlestickChart className="size-3.5" aria-hidden />
                    <span className="sr-only sm:not-sr-only">Candles</span>
                  </>
                ),
              },
            ]}
          />
          <Segmented<Unit>
            size="sm"
            ariaLabel="Chart unit"
            value={unit}
            onChange={setUnit}
            options={[
              { value: "mcap", label: "MCap" },
              { value: "price", label: "Price" },
            ]}
          />
        </div>
      </div>
      <div className="relative mt-2 h-[320px] sm:h-[400px] lg:h-[440px]">
        <div ref={host} className="absolute inset-0" />
        {shown ? (
          <div className="pointer-events-none absolute top-1 left-3 z-10 grid max-w-[calc(100%-5.5rem)] gap-1 font-mono text-[11px] leading-tight sm:left-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {/* Local time zone exists only in the browser; the server-rendered legend leaves it blank. */}
              <span className="hidden text-muted sm:inline">{mounted ? dateTime.format(new Date(shown.time * 1000)) : null}</span>
              {type === "candles" ? (
                <>
                  <LegendValue k="O" v={fmt(shown.open)} className="hidden sm:inline" />
                  <LegendValue k="H" v={fmt(shown.high)} className="hidden sm:inline" />
                  <LegendValue k="L" v={fmt(shown.low)} className="hidden sm:inline" />
                  <LegendValue k="C" v={fmt(shown.close)} />
                </>
              ) : (
                <LegendValue k={unit === "mcap" ? "MCap" : "Price"} v={fmt(shown.close)} />
              )}
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
            <EmptyState art="trades" title="No candles yet">
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
