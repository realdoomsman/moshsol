"use client";

import { motion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown after the label in `ink-3`, e.g. "Holders (48)" → `count={48}`. */
  count?: number;
  disabled?: boolean;
}

const INDICATOR = { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };

/** Arrow/Home/End move between tabs and select them (automatic activation). */
function rovingKeys<T extends string>(
  e: KeyboardEvent<HTMLDivElement>,
  items: { value: T; disabled?: boolean }[],
  value: T,
  onChange: (v: T) => void,
  root: HTMLDivElement | null,
) {
  const enabled = items.filter((i) => !i.disabled);
  const i = enabled.findIndex((t) => t.value === value);
  const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: enabled.length - 1 }[
    e.key
  ];
  if (next === undefined || !enabled.length) return;
  e.preventDefault();
  const target = enabled[(next + enabled.length) % enabled.length];
  onChange(target.value);
  root?.querySelector<HTMLElement>(`[data-value="${CSS.escape(target.value)}"]`)?.focus();
}

/**
 * Underline tabs (§4.5 token tabs, §4.9 boards): `ui` type, active = `ink` with a 2px `ink`
 * underline that slides (160 ms), inactive = `ink-2`. Scrolls horizontally when it doesn't fit.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}) {
  const layoutId = useId();
  const root = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={root}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => rovingKeys(e, items, value, onChange, root.current)}
      className={cn("no-scrollbar flex gap-6 overflow-x-auto border-b border-line", className)}
    >
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            data-value={t.value}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            className={cn(
              "ui relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap transition-colors disabled:text-ink-3",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="num text-ink-3">{t.count}</span> : null}
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={INDICATOR}
                className="absolute inset-x-0 -bottom-px h-0.5 bg-ink"
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Active fill: `up`/`down` for the Buy/Sell toggle (§4.5); default = `raised` + ink text. */
  tone?: "up" | "down";
  disabled?: boolean;
}

const SEGMENT_SIZES = {
  sm: "h-8 text-[13px] pointer-coarse:h-10",
  md: "h-9 text-[14px] pointer-coarse:h-10",
  lg: "h-10 text-[14px]",
};

/**
 * Segmented control (§3.6: 8px radius, `sunken` track): view toggles (Board | Grid | Table),
 * windows (24h · 7d · All) and the Buy/Sell switch. `stretch` fills the width (mobile).
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  size = "md",
  stretch,
  className,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: keyof typeof SEGMENT_SIZES;
  stretch?: boolean;
  className?: string;
}) {
  const layoutId = useId();
  const root = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={root}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => rovingKeys(e, items, value, onChange, root.current)}
      className={cn("inline-flex gap-0.5 rounded-sm bg-sunken p-0.5", stretch && "flex w-full", className)}
    >
      {items.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            data-value={s.value}
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={s.disabled}
            onClick={() => onChange(s.value)}
            className={cn(
              "relative inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-3 whitespace-nowrap [font-weight:560] transition-colors disabled:text-ink-3",
              SEGMENT_SIZES[size],
              stretch && "flex-1",
              active
                ? s.tone === "up"
                  ? "text-on-up"
                  : s.tone === "down"
                    ? "text-on-down"
                    : "text-ink"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={INDICATOR}
                aria-hidden
                className={cn(
                  "absolute inset-0 rounded-[6px]",
                  s.tone === "up" ? "bg-up" : s.tone === "down" ? "bg-down" : "bg-raised shadow-[0_0_0_1px_var(--color-line)]",
                )}
              />
            ) : null}
            <span className="relative">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
