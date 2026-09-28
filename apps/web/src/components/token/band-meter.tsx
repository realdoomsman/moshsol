import { fmtPrice } from "@holdfast/sdk";
import { cn } from "../ui/cn";

/** Accent at 40% for the agent's buy/sell zones; the sell zone is hatched so the two read apart without colour. */
const ZONE = "color-mix(in oklab, var(--color-accent) 40%, transparent)";
const HATCH = `repeating-linear-gradient(135deg, ${ZONE} 0 3px, transparent 3px 6px)`;

/**
 * Where spot sits against the vault agent's rules (§4.5 vault card, /agents rows): an 8px track
 * with the buy zone (spot ≤ `buyBelow`, accent 40%), the neutral band (`line`, the same track as
 * the progress bars) and the hatched sell zone (spot ≥ `sellAbove`); an `ink` needle + dot at
 * `price`, and ticks for the EMA and the vault's average cost. All values are SOL per token.
 * `compact` drops the label row (inline use).
 */
export function BandMeter({
  price,
  ema,
  buyBelow,
  sellAbove,
  avgCost,
  compact,
  className,
}: {
  price: number;
  ema: number;
  buyBelow: number;
  sellAbove: number;
  avgCost?: number;
  compact?: boolean;
  className?: string;
}) {
  const points = [price, ema, buyBelow, sellAbove, ...(avgCost && avgCost > 0 ? [avgCost] : [])].filter((v) => v > 0);
  const min = Math.min(...points);
  const max = Math.max(...points);
  // Keep the neutral band readable: pad the domain by 60% of the band's width on each side.
  const pad = Math.max(sellAbove - buyBelow, max * 0.01) * 0.6;
  const lo = min - pad;
  const hi = max + pad;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const zone = price <= buyBelow ? "the buy zone" : price >= sellAbove ? "the sell zone" : "the neutral band";
  const valid = points.length >= 4 && hi > lo;

  return (
    <div
      role="img"
      aria-label={`Price ${fmtPrice(price)} SOL is in ${zone}: the agent may buy at or below ${fmtPrice(buyBelow)} and sell at or above ${fmtPrice(sellAbove)}.`}
      className={cn("w-full", className)}
    >
      <div className={cn("relative", compact ? "h-4" : "h-5")}>
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-xs bg-line">
          {valid ? (
            <>
              <div className="absolute inset-y-0 left-0" style={{ width: `${at(buyBelow)}%`, background: ZONE }} />
              <div className="absolute inset-y-0 right-0" style={{ left: `${at(sellAbove)}%`, background: HATCH }} />
            </>
          ) : null}
        </div>
        {valid ? (
          <>
            <span
              aria-hidden
              className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-ink-3"
              style={{ left: `${at(ema)}%` }}
            />
            {avgCost && avgCost > 0 ? (
              <span
                aria-hidden
                className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-accent-ink"
                style={{ left: `${at(avgCost)}%` }}
              />
            ) : null}
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink transition-[left] duration-(--dur-5) ease-(--ease-out)"
              style={{ left: `${at(price)}%` }}
            >
              <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-ink" />
            </span>
          </>
        ) : null}
      </div>
      {compact ? null : (
        <div className="micro num mt-1.5 flex justify-between gap-2 text-ink-3">
          <span>buy ≤ {fmtPrice(buyBelow)}</span>
          <span>EMA {fmtPrice(ema)}</span>
          <span>sell ≥ {fmtPrice(sellAbove)}</span>
        </div>
      )}
    </div>
  );
}
