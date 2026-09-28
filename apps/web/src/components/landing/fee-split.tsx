"use client";

import { useId, useState } from "react";
import { usePlatform } from "@/lib/queries";
import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../band/model";
import { cn } from "../ui/cn";
import { Skeleton } from "../ui/skeleton";

/**
 * §7 Where the fee goes: the split of every trade fee (from `/api/platform`) as one 48px bar, and an
 * earnings calculator — daily volume (log scale) × fee × backer share × your share of the raise.
 */
export function FeeSplit() {
  const platform = usePlatform();
  const p = platform.data?.params;
  if (!p) {
    return platform.isError ? (
      <p className="small border-l-2 border-warn pl-3 text-ink-2">Couldn&rsquo;t load the fee split. Indexer unreachable.</p>
    ) : (
      <Skeleton className="h-40 w-full" />
    );
  }
  return (
    <div className="grid gap-16 lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-7">
        <SplitBar params={p} />
      </div>
      <div className="lg:col-span-4 lg:col-start-9">
        <Calculator params={p} />
      </div>
    </div>
  );
}

/**
 * Backers (accent) · Creator (ink-3) · Platform (line-2), split by 2px gaps of ground: weight falls
 * on the backers' share, the rest steps down in brightness with its size.
 */
export function SplitBar({ params: p, className }: { params: PlatformInfo["params"]; className?: string }) {
  const platformBps = 10_000 - p.backerFeeShareBps - p.creatorFeeShareBps;
  const parts = [
    { label: "Backers", bps: p.backerFeeShareBps, fill: "bg-accent" },
    { label: "Creator", bps: p.creatorFeeShareBps, fill: "bg-ink-3" },
    { label: "Platform", bps: platformBps, fill: "bg-line-2" },
  ];
  return (
    <figure className={className}>
      <div className="flex gap-0.5">
        {parts.map((s, i) => (
          <div key={s.label} className="min-w-0" style={{ flexGrow: s.bps, flexBasis: 0 }}>
            {/* The last caption hugs the right edge so a narrow segment never pushes it off-screen. */}
            <div className={cn("flex flex-col", i === parts.length - 1 ? "items-end" : "items-start")}>
              <p className="label whitespace-nowrap text-ink-3">{s.label}</p>
              <p className="num-l text-ink">{pctFromBps(s.bps)}</p>
            </div>
            <div className={cn("mt-3 h-12", s.fill)} />
          </div>
        ))}
      </div>
      <figcaption className="small mt-3 text-ink-3">
        Of the {pctFromBps(p.tradeFeeBps)} fee on every public trade, frozen into each launch at creation. Vault-agent trades pay no
        fee.
      </figcaption>
    </figure>
  );
}

const VOLUME = { min: 1, max: 10_000 };
const SHARE = { min: 0.1, max: 100 };
const STEPS = 1000;

/** Log-scale slider position ↔ value. */
const fromPos = (pos: number, r: { min: number; max: number }) => r.min * (r.max / r.min) ** (pos / STEPS);
const toPos = (v: number, r: { min: number; max: number }) => Math.round((Math.log(v / r.min) / Math.log(r.max / r.min)) * STEPS);

function Calculator({ params: p }: { params: PlatformInfo["params"] }) {
  const [volume, setVolume] = useState(100);
  const [share, setShare] = useState(10);
  const perDay = volume * (p.tradeFeeBps / 10_000) * (p.backerFeeShareBps / 10_000) * (share / 100);
  return (
    <div>
      <h3 className="h3 text-ink">What backing earns</h3>
      <div className="mt-6 grid gap-6">
        <Slider
          label="Daily volume"
          value={volume}
          range={VOLUME}
          onChange={setVolume}
          display={`${volume >= 100 ? Math.round(volume).toLocaleString("en-US") : volume.toFixed(volume >= 10 ? 0 : 1)} SOL`}
        />
        <Slider
          label="Your share of the raise"
          value={share}
          range={SHARE}
          onChange={setShare}
          display={`${share >= 10 ? share.toFixed(0) : share.toFixed(1)}%`}
        />
      </div>
      <p className="num-xl mt-8 text-accent-ink">
        ≈ {perDay >= 1 ? perDay.toFixed(2) : perDay >= 0.01 ? perDay.toFixed(3) : perDay.toFixed(5)} SOL / day
      </p>
      <p className="small mt-2 text-ink-3">
        At {pctFromBps(p.tradeFeeBps)} fee × {pctFromBps(p.backerFeeShareBps)} backer share × your share. Paid from real trades; zero
        volume pays zero.
      </p>
    </div>
  );
}

function Slider({
  label,
  value,
  range,
  onChange,
  display,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  onChange: (v: number) => void;
  display: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="ui text-ink-2">
          {label}
        </label>
        <span className="ui num text-ink">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={toPos(value, range)}
        aria-valuetext={display}
        onChange={(e) => onChange(fromPos(Number(e.target.value), range))}
        className={cn(
          "mt-2 h-10 w-full cursor-pointer appearance-none bg-transparent",
          "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-[2px] [&::-webkit-slider-runnable-track]:bg-line-2",
          "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink",
          "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-[2px] [&::-moz-range-track]:bg-line-2",
          "[&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink",
        )}
      />
    </div>
  );
}
