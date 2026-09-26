"use client";

import { fmtPrice } from "@moshsol/sdk";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
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
import { CandlestickChart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Timeframe } from "@/lib/api";
import { fmtSolValue } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { useCandles, useTrades } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
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
const UP = "#2fe6a7";
const DOWN = "#ff5c7c";

interface ChartRefs {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  ema: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
  bandLines: IPriceLine[];
}

export function PriceChart({ launch: l, bandLow, bandHigh }: { launch: LaunchSummary; bandLow: number; bandHigh: number }) {
  const [tfValue, setTfValue] = useLocalStorage("moshsol:chart-tf", "60");
  const [unit, setUnit] = useLocalStorage<Unit>("moshsol:chart-unit", "mcap");
  const tf = (TIMEFRAMES.find((t) => t.value === tfValue) ?? TIMEFRAMES[0]).tf;
  const candles = useCandles(l.mint, tf);
  const trades = useTrades(l.mint, 500);
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<ChartRefs | null>(null);
  const fitted = useRef<string>("");
  const [ready, setReady] = useState(false);
  const mult = unit === "mcap" ? SUPPLY : 1;

  // Create the chart once.
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7f8795",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        maxBarSpacing: 28,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(198,255,61,0.35)", labelBackgroundColor: "#1a1e24" },
        horzLine: { color: "rgba(198,255,61,0.35)", labelBackgroundColor: "#1a1e24" },
      },
      handleScale: { axisPressedMouseMove: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
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
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const ema = chart.addSeries(LineSeries, {
      color: "#9d6bff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "EMA",
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    refs.current = {
      chart,
      candles: candleSeries,
      ema,
      volume,
      markers: createSeriesMarkers(candleSeries, []),
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
    const formatter = unit === "mcap" ? (v: number) => fmtSolValue(v) : (v: number) => fmtPrice(v);
    const priceFormat = { type: "custom" as const, formatter, minMove: unit === "mcap" ? 0.0001 : 1e-12 };
    r.candles.applyOptions({ priceFormat });
    r.ema.applyOptions({ priceFormat });
  }, [unit, ready]);

  const series = useMemo(() => {
    const cs = candles.data?.candles ?? [];
    const times = new Set(cs.map((c) => c.time));
    const asc = [...(trades.data?.trades ?? [])].sort((a, b) => a.timestamp - b.timestamp || a.slot - b.slot);
    const emaByBucket = new Map<number, number>();
    // One marker per bucket and side, labelled with the trade count when > 1.
    const agentCounts = new Map<string, { time: number; isBuy: boolean; n: number }>();
    for (const t of asc) {
      const bucket = Math.floor(t.timestamp / tf) * tf;
      if (!times.has(bucket)) continue;
      if (t.emaSol > 0) emaByBucket.set(bucket, t.emaSol);
      if (t.isAgent) {
        const key = `${bucket}:${t.isBuy}`;
        const prev = agentCounts.get(key);
        if (prev) prev.n += 1;
        else agentCounts.set(key, { time: bucket, isBuy: t.isBuy, n: 1 });
      }
    }
    const markers: SeriesMarker<Time>[] = [...agentCounts.values()]
      .sort((a, b) => a.time - b.time)
      .map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.isBuy ? "belowBar" : "aboveBar",
        shape: m.isBuy ? "arrowUp" : "arrowDown",
        color: m.isBuy ? "#3de3ff" : "#c2a6ff",
        text: m.n > 1 ? `×${m.n}` : "",
        size: 1,
      }));
    return {
      candles: cs.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open * mult,
        high: c.high * mult,
        low: c.low * mult,
        close: c.close * mult,
      })),
      volume: cs.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volumeSol,
        color: c.close >= c.open ? "rgba(47,230,167,0.28)" : "rgba(255,92,124,0.28)",
      })),
      ema: [...emaByBucket.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, v]) => ({ time: time as UTCTimestamp, value: v * mult })),
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
    const key = `${tf}:${unit}:${series.candles.length > 0}`;
    if (fitted.current !== key && series.candles.length > 0) {
      fitted.current = key;
      // Wait a frame so autoSize has measured the container before fitting.
      requestAnimationFrame(() => refs.current?.chart.timeScale().fitContent());
    }
  }, [series, tf, unit, ready]);

  // Agent band as dashed price lines.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    for (const line of r.bandLines) r.candles.removePriceLine(line);
    r.bandLines = [];
    if (!(bandLow > 0 && bandHigh > 0)) return;
    r.bandLines.push(
      r.candles.createPriceLine({
        price: bandLow * mult,
        color: "rgba(61,227,255,0.55)",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: "agent buy ≤",
      }),
      r.candles.createPriceLine({
        price: bandHigh * mult,
        color: "rgba(194,166,255,0.6)",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: "agent sell ≥",
      }),
    );
  }, [bandLow, bandHigh, mult, ready]);

  const empty = !candles.isLoading && (candles.data?.candles.length ?? 0) === 0;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="no-scrollbar max-w-full overflow-x-auto">
          <Segmented
            size="sm"
            ariaLabel="Timeframe"
            value={tfValue}
            onChange={setTfValue}
            options={TIMEFRAMES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-[11px] text-dim sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-violet" /> EMA
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-cyan">▲</span>
              <span className="text-[#c2a6ff]">▼</span> agent trades
            </span>
          </div>
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
      <div className="relative mt-2 h-[300px] sm:h-[420px]">
        <div ref={host} className="absolute inset-0" />
        {candles.isLoading ? <Skeleton className="absolute inset-4" /> : null}
        {empty ? (
          <div className="absolute inset-0 grid place-items-center">
            <EmptyState icon={<CandlestickChart className="size-5" aria-hidden />} title="No candles yet">
              The chart starts at the bundle buy.
            </EmptyState>
          </div>
        ) : null}
      </div>
    </div>
  );
}
