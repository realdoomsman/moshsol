"use client";

import { countdown, shortAddr } from "@moshsol/sdk";
import { Check, Copy, Info } from "lucide-react";
import { motion, useSpring, useTransform } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { explorerAddress } from "@/lib/explorer";
import { useNow } from "@/lib/hooks";
import { cn } from "./cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ariaLabel,
  stretch,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  stretch?: boolean;
}) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl border border-line bg-black/30 p-1",
        stretch && "flex w-full",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-[13px]",
              stretch && "flex-1",
              active ? "text-ink" : "text-dim hover:text-muted",
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg border border-line-strong bg-white/[0.09]"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Spring-animated number; `format` renders every intermediate frame. */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 90, damping: 22, mass: 0.7 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className={cn("tabular-nums", className)}>{text}</motion.span>;
}

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1_400);
    return () => window.clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setDone(true));
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-dim transition hover:text-ink",
        className,
      )}
      aria-label={label ?? "Copy to clipboard"}
      title={label ?? "Copy"}
    >
      {done ? <Check className="size-3.5 text-up" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

export function TokenAvatar({
  src,
  symbol,
  size = 40,
  className,
}: {
  src: string | null | undefined;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const radius = size >= 48 ? "rounded-2xl" : size >= 32 ? "rounded-xl" : "rounded-lg";
  if (!src || failed) {
    return (
      <div
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center bg-gradient-to-br from-violet/70 to-cyan/60 font-bold text-white/95",
          radius,
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
      >
        {symbol.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    // Indexer-hosted user uploads; next/image would need a per-deployment remote allowlist.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={cn("shrink-0 bg-white/5 object-cover ring-1 ring-white/10", radius, className)}
      style={{ width: size, height: size }}
    />
  );
}

export function AddressLink({
  address,
  chars = 4,
  className,
  label,
}: {
  address: string;
  chars?: number;
  className?: string;
  label?: ReactNode;
}) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className={cn("font-mono text-[12.5px] text-muted transition hover:text-lime", className)}
    >
      {label ?? shortAddr(address, chars)}
    </a>
  );
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span tabIndex={0} className={cn("group relative inline-flex align-middle outline-none", className)}>
      <Info className="size-3.5 text-dim transition group-hover:text-muted group-focus:text-ink" aria-hidden />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-lg border border-line-strong bg-[#15181d] px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-muted opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export function Countdown({ to, className, endedLabel = "ended" }: { to: number; className?: string; endedLabel?: string }) {
  const now = useNow();
  return (
    <span className={cn("tabular-nums", className)} suppressHydrationWarning>
      {now >= to ? endedLabel : countdown(to, now)}
    </span>
  );
}

export function Sparkline({
  values,
  up,
  className,
}: {
  values: number[];
  up: boolean;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.02 || 1;
  const w = 100;
  const h = 32;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const color = up ? "var(--color-up)" : "var(--color-down)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-8 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
