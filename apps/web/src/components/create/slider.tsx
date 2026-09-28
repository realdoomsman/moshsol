"use client";

import { cn } from "../ui/cn";

/**
 * Range input on a 4px `line` track (the progress-bar track) with an `ink-2` fill and a 16px `ink`
 * thumb: the thumb is the control, the fill only says how far. The native input sits on top
 * (transparent track) so keyboard, touch and screen readers get the real control.
 */
export function Slider({
  id,
  value,
  min,
  max,
  step,
  onChange,
  valueText,
  invalid,
  className,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Spoken value, e.g. "15% of supply". */
  valueText: string;
  invalid?: boolean;
  className?: string;
}) {
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <div className={cn("relative h-10", className)}>
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-[2px] bg-line">
        <div className={cn("h-full", invalid ? "bg-down" : "bg-ink-2")} style={{ width: `${pct}%` }} />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "relative block h-10 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
          "[&::-webkit-slider-runnable-track]:h-10 [&::-webkit-slider-runnable-track]:bg-transparent",
          "[&::-moz-range-track]:h-10 [&::-moz-range-track]:bg-transparent",
          "[&::-webkit-slider-thumb]:mt-3 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-ink",
          "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-ink",
          "focus-visible:[&::-webkit-slider-thumb]:outline-2 focus-visible:[&::-webkit-slider-thumb]:outline-offset-2 focus-visible:[&::-webkit-slider-thumb]:outline-accent",
          "focus-visible:[&::-moz-range-thumb]:outline-2 focus-visible:[&::-moz-range-thumb]:outline-offset-2 focus-visible:[&::-moz-range-thumb]:outline-accent",
        )}
      />
    </div>
  );
}
