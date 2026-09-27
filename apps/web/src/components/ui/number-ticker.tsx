"use client";

import { useState } from "react";
import { cn } from "./cn";

interface TickState {
  value: number;
  text: string;
  prevText: string;
  dir: 0 | 1 | -1;
  /** Bumps on every change so the flash/roll animations restart. */
  n: number;
}

/**
 * A live number (§3.8.3): tabular figures; when `value` changes the text flashes `up`/`down` and
 * eases back to its colour over 600 ms — never on first render. `roll` also rolls the changed
 * digits (325 ms, Stripe) — for hero/stat numbers only, not table cells. Reduced motion: instant.
 *
 *   <NumberTicker value={mcap} format={(v) => `${fmtSolValue(v)} SOL`} roll className="num-xl" />
 */
export function NumberTicker({
  value,
  format,
  roll,
  flash = true,
  className,
}: {
  value: number;
  format: (value: number) => string;
  roll?: boolean;
  flash?: boolean;
  className?: string;
}) {
  const text = format(value);
  const [s, setS] = useState<TickState>({ value, text, prevText: text, dir: 0, n: 0 });
  if (s.text !== text) {
    const dir = value > s.value ? 1 : value < s.value ? -1 : 0;
    setS({ value, text, prevText: s.text, dir, n: s.n + 1 });
  } else if (s.value !== value) {
    // Moved below display precision: nothing visible changed, so nothing flashes.
    setS({ ...s, value });
  }
  const flashClass = flash && s.dir !== 0 ? (s.dir > 0 ? "animate-flash-up" : "animate-flash-down") : undefined;

  if (!roll || s.n === 0) {
    return (
      <span key={s.n} className={cn("num", flashClass, className)}>
        {text}
      </span>
    );
  }

  // Compare right-aligned so the units digit lines up when the number gains a digit.
  const pad = Math.max(0, text.length - s.prevText.length);
  const prev = " ".repeat(pad) + s.prevText;
  const offset = prev.length - text.length;
  return (
    <span key={s.n} className={cn("num inline-flex", flashClass, className)} aria-label={text}>
      {Array.from(text).map((ch, i) => {
        const changed = /\d/.test(ch) && prev[i + offset] !== ch;
        return changed ? (
          <span key={i} aria-hidden className="inline-block overflow-hidden">
            <span className={cn("inline-block", s.dir >= 0 ? "animate-roll-up" : "animate-roll-down")}>{ch}</span>
          </span>
        ) : (
          <span key={i} aria-hidden className="whitespace-pre">
            {ch}
          </span>
        );
      })}
    </span>
  );
}
