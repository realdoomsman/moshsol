import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../band/model";
import { cn } from "../ui/cn";

/**
 * Legacy Holdfast-curve launches only (pump.fun launches have no trade-fee split: creator fees go
 * vault / burn / backers). Backers (accent) · Creator (ink-3) · Platform (line-2), split by 2px gaps
 * of ground: weight falls on the backers' share, the rest steps down in brightness with its size.
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
        Of the {pctFromBps(p.tradeFeeBps)} fee on every public trade on the Holdfast curve, frozen into each legacy launch at creation.
        Vault-agent trades pay no fee; pump.fun launches have no trade-fee split.
      </figcaption>
    </figure>
  );
}

