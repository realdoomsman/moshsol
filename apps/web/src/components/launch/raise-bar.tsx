import { pctOf } from "@/lib/format";
import { cn } from "../ui/cn";

/** Raised vs max with a marker at the minimum. */
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
  const fill = pctOf(raised, raiseMax);
  const minAt = pctOf(raiseMin, raiseMax);
  const minMet = BigInt(raised) >= BigInt(raiseMin);
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(fill)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Raise progress"
      className={cn(
        "relative w-full rounded-full bg-white/[0.07]",
        size === "lg" ? "h-3.5" : "h-2",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out",
          failed ? "bg-down/70" : minMet ? "bg-lime" : "bg-gradient-brand",
          size === "lg" && !failed && "shadow-[0_0_24px_-2px_rgb(198_255_61/0.45)]",
        )}
        style={{ width: `${Math.min(100, fill)}%` }}
      />
      {minAt > 0 && minAt < 100 ? (
        <div
          className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2", size === "lg" ? "h-6" : "h-3.5")}
          style={{ left: `${minAt}%` }}
          title="Minimum raise"
        >
          <div className={cn("h-full w-0.5 rounded-full", minMet ? "bg-black/60" : "bg-white/70")} />
        </div>
      ) : null}
    </div>
  );
}
