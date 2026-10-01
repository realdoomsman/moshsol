"use client";

import { fmtPrice, type AgentZones } from "@holdfast/sdk";
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
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type LineWidth,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { ChartCandlestick, ChartLine, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Timeframe } from "@/lib/api";
import { fmtSolValue } from "@/lib/format";
import { useLocalStorage, useMounted, useNow } from "@/lib/hooks";
import { launchId } from "@/lib/launch";
import { useCandles, useTrades } from "@/lib/queries";
import type { Candle, LaunchSummary } from "@/lib/types";
import { AgentGlyph } from "../brand/glyphs";
import { IconButton } from "../ui/button";
import { cn } from "../ui/cn";
import { EmptyState } from "../ui/empty-state";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Segmented } from "../ui/tabs";
import { CHART_TRADES } from "./limits";

const TIMEFRAMES: { value: `${Timeframe}`; label: string; tf: Timeframe }[] = [
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
const SUPPLY = 1_000_000_000;

type Unit = "mcap" | "price";
type ChartType = "auto" | "line" | "candles";
interface Overlays {
  band: boolean;
  agent: boolean;
  cost: boolean;
}

/** Theme colours for the canvas, read from the design tokens (the chart can't use CSS variables). */
interface Palette {
  up: string;
  down: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  accent: string;
  accentInk: string;
  raised: string;
  surface: string;
  paper: string;
  mono: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.body);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    up: v("--color-up"),
    down: v("--color-down"),
    ink: v("--color-ink"),
    ink2: v("--color-ink-2"),
    ink3: v("--color-ink-3"),
    line: v("--color-line"),
    accent: v("--color-accent"),
    accentInk: v("--color-accent-ink"),
    raised: v("--color-raised"),
    surface: v("--color-surface"),
    paper: v("--color-paper"),
    mono: v("--font-mono") || "monospace",
  };
}

/** `#rrggbb` token → rgba() at `alpha` (canvas colours for fills and volume bars). */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSol: number;
  /** EMA (SOL per token) after the bucket's last trade, when a trade in it carried one. */
  ema: number | null;
  agentBuys: number;
  agentSells: number;
}

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type ToX = (time: number) => number | null;
type ToY = (price: number) => number | null;

/**
 * A canvas layer attached to a price series, for the two chart marks the library has no shape for:
 * the band fill and the agent diamonds. Paints in media pixels; x from the time scale, y from the
 * series' price scale. The owner calls `set…` with new data, which requests a redraw.
 */
abstract class CanvasOverlay implements ISeriesPrimitive<Time> {
  private host: SeriesAttachedParameter<Time> | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(zOrder: PrimitivePaneViewZOrder) {
    this.views = [{ zOrder: () => zOrder, renderer: () => ({ draw: (target: DrawTarget) => this.draw(target) }) }];
  }
  attached(host: SeriesAttachedParameter<Time>) {
    this.host = host;
  }
  detached() {
    this.host = null;
  }
  paneViews() {
    return this.views;
  }
  protected redraw() {
    this.host?.requestUpdate();
  }
  private draw(target: DrawTarget) {
    const host = this.host;
    if (!host) return;
    const ts = host.chart.timeScale();
    target.useMediaCoordinateSpace(({ context }) =>
      this.paint(
        context,
        (t) => ts.timeToCoordinate(t as UTCTimestamp),
        (p) => host.series.priceToCoordinate(p),
        ts.options().barSpacing,
      ),
    );
  }
  protected abstract paint(ctx: CanvasRenderingContext2D, x: ToX, y: ToY, barSpacing: number): void;
}

interface BandPoint {
  time: number;
  low: number;
  high: number;
}

/**
 * The agent's band (§3.4 rule 6): `accent` at 7% between the buy and sell edges, and the edges
 * themselves dashed 3-4 in `accent` at 80% (the library only dashes 2-2). Drawn under the grid and
 * the price; the edge line series stay (hidden) so autoscale keeps the band in view.
 */
class BandOverlay extends CanvasOverlay {
  private points: BandPoint[] = [];
  private fill = "";
  private edge = "";
  constructor() {
    super("bottom");
  }
  set(points: BandPoint[], fill: string, edge: string) {
    this.points = points;
    this.fill = fill;
    this.edge = edge;
    this.redraw();
  }
  protected paint(ctx: CanvasRenderingContext2D, x: ToX, y: ToY, barSpacing: number) {
    const pts: { x: number; hi: number; lo: number }[] = [];
    for (const p of this.points) {
      const px = x(p.time);
      const hi = y(p.high);
      const lo = y(p.low);
      if (px !== null && hi !== null && lo !== null) pts.push({ x: px, hi, lo });
    }
    if (!pts.length) return;
    // A lone point spans one bar, the way the library draws a one-point line.
    const run = pts.length === 1 ? [{ ...pts[0], x: pts[0].x - barSpacing / 2 }, { ...pts[0], x: pts[0].x + barSpacing / 2 }] : pts;
    ctx.beginPath();
    run.forEach((p, i) => (i ? ctx.lineTo(p.x, p.hi) : ctx.moveTo(p.x, p.hi)));
    for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(run[i].x, run[i].lo);
    ctx.closePath();
    ctx.fillStyle = this.fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.edge;
    ctx.setLineDash([3, 4]);
    for (const key of ["hi", "lo"] as const) {
      ctx.beginPath();
      run.forEach((p, i) => (i ? ctx.lineTo(p.x, p[key]) : ctx.moveTo(p.x, p[key])));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

interface AgentMark {
  time: number;
  buy: boolean;
  /** Where the diamond hangs: under the bar's low for buys, over its high for sells (the value in line mode). */
  price: number;
}

/** Agent trades (§3.4 rule 6): a filled `accent` diamond (10px) under the bar for buys, an outlined one over it for sells. */
class AgentDiamonds extends CanvasOverlay {
  private marks: AgentMark[] = [];
  private accent = "";
  private surface = "";
  constructor() {
    super("normal");
  }
  set(marks: AgentMark[], accent: string, surface: string) {
    this.marks = marks;
    this.accent = accent;
    this.surface = surface;
    this.redraw();
  }
  protected paint(ctx: CanvasRenderingContext2D, x: ToX, y: ToY) {
    const r = 5;
    const gap = 10;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.accent;
    for (const m of this.marks) {
      const px = x(m.time);
      const py = y(m.price);
      if (px === null || py === null) continue;
      const cy = m.buy ? py + gap : py - gap;
      ctx.beginPath();
      ctx.moveTo(px, cy - r);
      ctx.lineTo(px + r, cy);
      ctx.lineTo(px, cy + r);
      ctx.lineTo(px - r, cy);
      ctx.closePath();
      ctx.fillStyle = m.buy ? this.accent : this.surface;
      ctx.fill();
      if (!m.buy) ctx.stroke();
    }
  }
}

interface ChartRefs {
  chart: IChartApi;
  palette: Palette;
  candles: ISeriesApi<"Candlestick">;
  area: ISeriesApi<"Area">;
  ema: ISeriesApi<"Line">;
  bandLow: ISeriesApi<"Line">;
  bandHigh: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  band: BandOverlay;
  candleAgents: AgentDiamonds;
  areaAgents: AgentDiamonds;
  costLine: { series: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">; line: IPriceLine } | null;
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

function Toggle({
  pressed,
  onChange,
  swatch,
  children,
}: {
  pressed: boolean;
  onChange: (v: boolean) => void;
  swatch: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        "small inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 [font-weight:560] transition-colors pointer-coarse:h-10",
        pressed ? "border-line-2 bg-raised text-ink" : "border-line text-ink-3 hover:border-line-2 hover:text-ink-2",
      )}
    >
      <span aria-hidden className={cn("inline-flex items-center", !pressed && "opacity-40")}>
        {swatch}
      </span>
      {children}
    </button>
  );
}

const lineSwatch = (className: string, dashed?: boolean) => (
  <span className={cn("inline-block w-3 border-t-[1.5px]", dashed && "border-dashed", className)} />
);

function Legend({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="text-ink-3">{k}</span> <span className="text-ink">{v}</span>
    </span>
  );
}

/**
 * Token chart (§4.5): price or market cap, candles or line, with the protocol overlays on by
 * default — the EMA band the vault agent trades against, agent trade markers, and the vault's
 * average cost (the line the agent never sells below). Legend = crosshair readout.
 */
export function PriceChart({ launch: l, zones, className }: { launch: LaunchSummary; zones: AgentZones; className?: string }) {
  const [tfChoice, setTfChoice] = useLocalStorage<string | null>("holdfast:chart-tf", null);
  const [unit, setUnit] = useLocalStorage<Unit>("holdfast:chart-unit", "price");
  const [typeChoice, setTypeChoice] = useLocalStorage<ChartType>("holdfast:chart-type", "auto");
  const [overlays, setOverlays] = useLocalStorage<Overlays>("holdfast:chart-overlays", { band: true, agent: true, cost: true });
  const id = launchId(l);
  const minute = useCandles(id, 60);
  const autoTf = useMemo(() => autoTimeframe(minute.data?.candles), [minute.data]);
  const tf = TIMEFRAMES.find((t) => t.value === tfChoice)?.tf ?? autoTf;
  const candles = useCandles(id, tf);
  const trades = useTrades(id, CHART_TRADES);
  const now = useNow(30_000);
  const mounted = useMounted();
  const panel = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<ChartRefs | null>(null);
  const fitted = useRef("");
  const refit = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const mult = unit === "mcap" ? SUPPLY : 1;
  const fmt = unit === "mcap" ? fmtSolValue : fmtPrice;
  const barCount = candles.data?.candles.length ?? 0;
  const type: Exclude<ChartType, "auto"> = typeChoice === "auto" ? (barCount < LINE_BELOW ? "line" : "candles") : typeChoice;
  const band = l.terms.agentBandBps / 10_000;

  // Create the chart once.
  useEffect(() => {
    if (!host.current) return;
    const p = readPalette();
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: p.ink3,
        fontFamily: p.mono,
        fontSize: 11,
        attributionLogo: false,
      },
      localization: { timeFormatter: (t: Time) => dateTime.format(new Date((t as number) * 1000)) },
      // §3.4 rule 6: horizontal grid only, in `line`.
      grid: { vertLines: { visible: false }, horzLines: { color: p.line } },
      // `entireTextOnly` drops a tick label rather than clip it at the pane's top or bottom edge.
      rightPriceScale: { borderColor: p.line, minimumWidth: 72, entireTextOnly: true, scaleMargins: { top: 0.18, bottom: 0.18 } },
      timeScale: {
        borderColor: p.line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        minBarSpacing: 3,
        maxBarSpacing: 22,
        tickMarkFormatter: tickLabel,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: p.ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: p.raised },
        horzLine: { color: p.ink3, width: 1, style: LineStyle.Dashed, labelBackgroundColor: p.raised },
      },
      handleScale: { axisPressedMouseMove: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: p.up,
      downColor: p.down,
      wickUpColor: p.up,
      wickDownColor: p.down,
      borderVisible: false,
      priceLineStyle: LineStyle.Dotted,
      // Keep at least ±6% of vertical range so flat markets (one candle, bundle-only) stay legible.
      autoscaleInfoProvider: minSpan(0.12),
    });
    const area = chart.addSeries(AreaSeries, {
      // Line mode is `ink` at 1.75px (§3.4 rule 6); the canvas takes fractional widths.
      lineColor: p.ink,
      lineWidth: 1.75 as LineWidth,
      // The fill fades from the line's highest point to the bottom of the pane, not across the whole pane.
      relativeGradient: true,
      priceLineStyle: LineStyle.Dotted,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBorderColor: p.surface,
      crosshairMarkerBackgroundColor: p.ink,
      visible: false,
      autoscaleInfoProvider: minSpan(0.04),
    });
    const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
    const ema = chart.addSeries(LineSeries, { ...quiet, color: p.ink3, lineWidth: 1, lineStyle: LineStyle.SparseDotted });
    // The band's edges are drawn by `BandOverlay`; these hidden lines keep it inside the autoscale.
    const bandEdge = { ...quiet, lineVisible: false } as const;
    const bandLow = chart.addSeries(LineSeries, bandEdge);
    const bandHigh = chart.addSeries(LineSeries, bandEdge);
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    chart.subscribeCrosshairMove((e) => setHover(e.time === undefined ? null : (e.time as number)));
    const bandOverlay = new BandOverlay();
    bandHigh.attachPrimitive(bandOverlay);
    const candleAgents = new AgentDiamonds();
    candleSeries.attachPrimitive(candleAgents);
    const areaAgents = new AgentDiamonds();
    area.attachPrimitive(areaAgents);
    refs.current = {
      chart,
      palette: p,
      candles: candleSeries,
      area,
      ema,
      bandLow,
      bandHigh,
      volume,
      band: bandOverlay,
      candleAgents,
      areaAgents,
      costLine: null,
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
    for (const s of [r.candles, r.area, r.ema, r.bandLow, r.bandHigh]) s.applyOptions({ priceFormat });
  }, [unit, fmt, ready]);

  const series = useMemo(() => {
    const bars = new Map<number, Bar>();
    for (const c of candles.data?.candles ?? []) {
      bars.set(c.time, {
        time: c.time,
        open: c.open * mult,
        high: c.high * mult,
        low: c.low * mult,
        close: c.close * mult,
        volumeSol: c.volumeSol,
        ema: null,
        agentBuys: 0,
        agentSells: 0,
      });
    }
    const asc = [...(trades.data?.trades ?? [])].sort((a, b) => a.timestamp - b.timestamp || a.slot - b.slot);
    for (const t of asc) {
      const bar = bars.get(Math.floor(t.timestamp / tf) * tf);
      if (!bar) continue;
      if (t.emaSol > 0) bar.ema = t.emaSol;
      if (t.isAgent && t.isBuy) bar.agentBuys += 1;
      else if (t.isAgent) bar.agentSells += 1;
    }
    const list = [...bars.values()];
    const first = list[0];
    const last = list.at(-1);
    const emaLine: { time: UTCTimestamp; value: number }[] = [];
    for (const b of list) {
      if (b.ema !== null) emaLine.push({ time: b.time as UTCTimestamp, value: b.ema * mult });
    }
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
      volume: list.map((b) => ({ time: b.time as UTCTimestamp, value: b.volumeSol, up: b.close >= b.open })),
      ema: emaLine,
      agentBars: list.filter((b) => b.agentBuys || b.agentSells),
    };
  }, [candles.data, trades.data, tf, mult, now, l.priceSol]);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const p = r.palette;
    const line = type === "line";
    const tone = series.up ? p.up : p.down;
    r.candles.applyOptions({ visible: !line });
    r.area.applyOptions({
      visible: line,
      // The line stays `ink`; the fill and the last-price label carry the direction.
      priceLineColor: tone,
      topColor: withAlpha(tone, 0.12),
      bottomColor: withAlpha(tone, 0),
    });
    // Volume bars would be slabs at line-mode spacing; the legend still reports each bucket's volume.
    r.volume.applyOptions({ visible: !line });
    r.chart.applyOptions({ crosshair: { mode: line ? CrosshairMode.Magnet : CrosshairMode.Normal } });
    r.candles.setData(series.candles);
    r.area.setData(series.line);
    r.volume.setData(
      series.volume.map((v) => ({ time: v.time, value: v.value, color: withAlpha(v.up ? p.up : p.down, 0.35) })),
    );
    const showBand = overlays.band;
    r.ema.applyOptions({ visible: showBand });
    r.bandLow.applyOptions({ visible: showBand });
    r.bandHigh.applyOptions({ visible: showBand });
    r.ema.setData(series.ema);
    const lowEdge = series.ema.map((e) => ({ time: e.time, value: e.value * (1 - band) }));
    const highEdge = series.ema.map((e) => ({ time: e.time, value: e.value * (1 + band) }));
    r.bandLow.setData(lowEdge);
    r.bandHigh.setData(highEdge);
    r.band.set(
      showBand ? lowEdge.map((e, i) => ({ time: e.time, low: e.value, high: highEdge[i].value })) : [],
      withAlpha(p.accent, 0.07),
      withAlpha(p.accent, 0.8),
    );
    const marks = overlays.agent
      ? series.agentBars.flatMap((b) => [
          ...(b.agentBuys ? [{ time: b.time, buy: true, price: line ? b.close : b.low }] : []),
          ...(b.agentSells ? [{ time: b.time, buy: false, price: line ? b.close : b.high }] : []),
        ])
      : [];
    r.candleAgents.set(line ? [] : marks, p.accent, p.surface);
    r.areaAgents.set(line ? marks : [], p.accent, p.surface);

    const count = line ? series.line.length : series.candles.length;
    // Sparse views re-fit as points arrive; dense ones fit once so a user's zoom isn't reset.
    const key = `${id}:${tf}:${unit}:${type}:${count >= SPARSE_BARS ? "dense" : count}`;
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
        const pad = padPx / ((width - 2 * padPx) / Math.max(1, count - 1));
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
  }, [series, tf, unit, type, id, ready, overlays.band, overlays.agent, band]);

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

  // Vault average cost: a 1px `accent-ink` line labelled on the right axis.
  const avgCost = zones.avgCost;
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (r.costLine) r.costLine.series.removePriceLine(r.costLine.line);
    r.costLine = null;
    if (!overlays.cost || !(avgCost > 0)) return;
    const target = type === "line" ? r.area : r.candles;
    const line = target.createPriceLine({
      price: avgCost * mult,
      color: r.palette.accentInk,
      lineStyle: LineStyle.Solid,
      lineWidth: 1,
      axisLabelVisible: true,
      axisLabelColor: r.palette.accentInk,
      axisLabelTextColor: r.palette.paper,
      title: "Vault cost",
    });
    r.costLine = { series: target, line };
  }, [avgCost, mult, type, ready, overlays.cost]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panel.current?.requestFullscreen?.();
  };

  const shown = (hover !== null ? series.bars.get(hover) : undefined) ?? series.last;
  const latest = shown === series.last;
  const change = shown && shown.open > 0 ? ((shown.close - shown.open) / shown.open) * 100 : null;
  // Thresholds at the hovered bar: that bar's EMA against today's average cost; the latest bar uses
  // the EMA projected to now (what the agent sees on its next tick).
  const ema = latest || shown?.ema == null ? zones.ema : shown.ema;
  const buyBelow = latest ? zones.buyBelow : Math.min(ema * (1 - band), Math.max(avgCost, zones.buybackCeiling ?? 0));
  const sellAbove = latest ? zones.sellAbove : Math.max(ema * (1 + band), avgCost * (1 + band));
  const empty = !candles.isLoading && series.candles.length === 0;

  return (
    <section
      ref={panel}
      aria-label="Price chart"
      className={cn(
        "min-w-0 rounded-md border border-line bg-surface [&:fullscreen]:flex [&:fullscreen]:flex-col [&:fullscreen]:rounded-none [&:fullscreen]:border-0",
        className,
      )}
    >
      {/* Wraps instead of scrolling: below 640px the timeframe is a select and chart type shows icons. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Segmented<Unit>
          size="sm"
          label="Chart unit"
          value={unit}
          onChange={setUnit}
          items={[
            { value: "price", label: "Price" },
            { value: "mcap", label: "Mcap" },
          ]}
        />
        <div className="max-sm:hidden">
          <Segmented
            size="sm"
            label="Timeframe"
            value={String(tf) as `${Timeframe}`}
            onChange={setTfChoice}
            items={TIMEFRAMES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        <div className="sm:hidden">
          <Select
            size="sm"
            label="Timeframe"
            value={String(tf) as `${Timeframe}`}
            onChange={setTfChoice}
            options={TIMEFRAMES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        <Segmented<Exclude<ChartType, "auto">>
          size="sm"
          label="Chart type"
          value={type}
          onChange={setTypeChoice}
          items={[
            {
              value: "candles",
              label: (
                <>
                  <ChartCandlestick className="size-4 sm:hidden" strokeWidth={1.5} aria-hidden />
                  <span className="max-sm:sr-only">Candles</span>
                </>
              ),
            },
            {
              value: "line",
              label: (
                <>
                  <ChartLine className="size-4 sm:hidden" strokeWidth={1.5} aria-hidden />
                  <span className="max-sm:sr-only">Line</span>
                </>
              ),
            },
          ]}
        />
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line max-sm:hidden" />
        <Toggle
          pressed={overlays.band}
          onChange={(band) => setOverlays({ ...overlays, band })}
          swatch={lineSwatch("border-accent", true)}
        >
          Band
        </Toggle>
        <Toggle
          pressed={overlays.agent}
          onChange={(agent) => setOverlays({ ...overlays, agent })}
          swatch={<AgentGlyph size={12} className="text-accent" />}
        >
          Agent
        </Toggle>
        <Toggle
          pressed={overlays.cost}
          onChange={(cost) => setOverlays({ ...overlays, cost })}
          swatch={lineSwatch("border-accent-ink")}
        >
          Vault cost
        </Toggle>
        <IconButton
          size="sm"
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
          className="ml-auto"
        >
          {fullscreen ? (
            <Minimize2 className="size-4" strokeWidth={1.5} aria-hidden />
          ) : (
            <Maximize2 className="size-4" strokeWidth={1.5} aria-hidden />
          )}
        </IconButton>
      </div>
      <div className={cn("relative", fullscreen ? "min-h-0 flex-1" : "h-[320px] md:h-[440px]")}>
        <div ref={host} className="absolute inset-0" />
        {shown ? (
          <div className="micro num pointer-events-none absolute top-2 left-4 z-10 grid max-w-[calc(100%-6rem)] gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {/* Local time zone exists only in the browser; the server-rendered legend leaves it blank. */}
              <span className="text-ink-2">{mounted ? dateTime.format(new Date(shown.time * 1000)) : null}</span>
              {type === "candles" ? (
                <>
                  <Legend k="O" v={fmt(shown.open)} className="max-md:hidden" />
                  <Legend k="H" v={fmt(shown.high)} className="max-md:hidden" />
                  <Legend k="L" v={fmt(shown.low)} className="max-md:hidden" />
                  <Legend k="C" v={fmt(shown.close)} />
                </>
              ) : (
                <Legend k={unit === "mcap" ? "Mcap" : "Price"} v={fmt(shown.close)} />
              )}
              {change !== null ? (
                <span className={change > 0 ? "text-up" : change < 0 ? "text-down" : "text-ink-2"}>
                  {change > 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              ) : null}
              <Legend k="Vol" v={`${fmtSolValue(shown.volumeSol)} SOL`} />
              {shown.agentBuys || shown.agentSells ? (
                <span className="text-accent-ink">
                  ◆ agent {shown.agentBuys ? `${shown.agentBuys} buy` : ""}
                  {shown.agentBuys && shown.agentSells ? " · " : ""}
                  {shown.agentSells ? `${shown.agentSells} sell` : ""}
                </span>
              ) : null}
            </div>
            {overlays.band && ema > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 max-md:hidden">
                <Legend k="EMA" v={fmt(ema * mult)} />
                <span className="text-ink-3">
                  Agent buys ≤ <span className="text-ink">{fmt(buyBelow * mult)}</span> / sells ≥{" "}
                  <span className="text-ink">{fmt(sellAbove * mult)}</span>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {candles.isLoading ? <Skeleton className="absolute inset-4" /> : null}
        {empty ? (
          <div className="absolute inset-0 grid place-items-center">
            <EmptyState>No trades yet. The first trade prices from {fmtPrice(l.priceSol)} SOL.</EmptyState>
          </div>
        ) : null}
      </div>
    </section>
  );
}
