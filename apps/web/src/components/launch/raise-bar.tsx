"use client";

import { useEffect, useRef, useState } from "react";
import { fmtLamports, pctOf } from "@/lib/format";
import { cn } from "../ui/cn";

/**
 * Raised vs max with a marker at the minimum. The large bar fills in on mount, carries a travelling
 * shine while the raise is open, and celebrates each new deposit (pushed over the indexer
 * websocket) with a light sweep and a floating "+amount" chip at the fill head.
 */
export function RaiseBar({
  raised,
  raiseMin,
  raiseMax,
  size = "sm",
  failed,
  className,
}: {
  raised: string;
  raiseMin: string;
  raiseMax: string;
  size?: "sm" | "lg";
  failed?: boolean;
  className?: string;
}) {
  const fill = Math.min(100, pctOf(raised, raiseMax));
  const minAt = pctOf(raiseMin, raiseMax);
  const minMet = BigInt(raised) >= BigInt(raiseMin);
  const lg = size === "lg";

  const prev = useRef(raised);
  const [landed, setLanded] = useState<{ n: number; delta: bigint } | null>(null);
  useEffect(() => {
    const delta = BigInt(raised) - BigInt(prev.current);
    prev.current = raised;
    if (delta > 0n) setLanded((cur) => ({ n: (cur?.n ?? 0) + 1, delta }));
  }, [raised]);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(fill)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Raise progress"
      className={cn(
        "relative w-full rounded-full bg-white/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.6)]",
        lg ? "h-5" : "h-2",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 origin-left overflow-hidden rounded-full transition-[width] duration-[1200ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          failed
            ? "bg-down/60"
            : minMet
              ? "bg-gradient-to-r from-lime/80 to-lime"
              : "bg-gradient-to-r from-violet to-cyan",
          lg && "animate-bar-grow",
          lg && !failed && (minMet ? "shadow-[0_0_28px_-2px_rgb(198_255_61/0.55)]" : "shadow-[0_0_28px_-2px_rgb(61_227_255/0.5)]"),
        )}
        style={{ width: `${Math.max(fill, fill > 0 ? (lg ? 2.5 : 1.5) : 0)}%` }}
      >
        {!failed ? <span className="fill-shine absolute inset-0" /> : null}
        {landed ? (
          <span
            key={landed.n}
            className="absolute inset-0 animate-bar-sweep bg-gradient-to-r from-transparent via-white/80 to-transparent"
          />
        ) : null}
      </div>
      {lg && !failed && fill > 0 ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-full bg-white transition-[left] duration-[1200ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] [animation-delay:1s]",
            minMet ? "shadow-[0_0_14px_3px_rgb(198_255_61/0.8)]" : "shadow-[0_0_14px_3px_rgb(61_227_255/0.8)]",
          )}
          style={{ left: `calc(${Math.max(fill, 2.5)}% - 10px)` }}
        />
      ) : null}
      {lg && landed ? (
        <span
          key={`chip-${landed.n}`}
          aria-live="polite"
          className="absolute bottom-full mb-2 animate-float-up rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-black shadow-[0_6px_20px_-4px_rgb(198_255_61/0.7)]"
          style={{ left: `${fill}%` }}
        >
          +{fmtLamports(landed.delta)} SOL
        </span>
      ) : null}
      {minAt > 0 && minAt < 100 ? (
        <div
          className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2", lg ? "h-9" : "h-3.5")}
          style={{ left: `${minAt}%` }}
          title="Minimum raise"
        >
          <div
            className={cn(
              "h-full rounded-full",
              lg ? "w-1" : "w-0.5",
              minMet ? "bg-black/60" : "bg-white",
              lg && !minMet && !failed && "animate-marker-glow",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
