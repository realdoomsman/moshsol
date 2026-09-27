"use client";

import { compact } from "@moshsol/sdk";
import { Bot, Coins, Rocket, TrendingUp, Users } from "lucide-react";
import { fmtSolValue } from "@/lib/format";
import { useStats } from "@/lib/queries";
import { cn } from "../ui/cn";
import { AnimatedNumber } from "../ui/interactive";
import { Skeleton } from "../ui/primitives";

const int = (n: number) => (n >= 10_000 ? compact(n, 1) : Math.round(n).toLocaleString("en-US"));

export function StatsStrip() {
  const { data, isError } = useStats();
  const items = data
    ? [
        { icon: Rocket, tone: "text-lime", label: "Launches", value: data.totalLaunches, fmt: int, sub: `${data.liveLaunches} live · ${data.raisingLaunches} raising` },
        { icon: Users, tone: "text-[#c2a6ff]", label: "Raised by backers", value: data.totalRaisedSol, fmt: fmtSolValue, unit: "SOL", sub: "all-time" },
        { icon: TrendingUp, tone: "text-up", label: "Volume 24h", value: data.volume24hSol, fmt: fmtSolValue, unit: "SOL", sub: `${fmtSolValue(data.totalVolumeSol)} SOL all-time` },
        { icon: Coins, tone: "text-warn", label: "Backer fees earned", value: data.backerFeesAccruedSol, fmt: fmtSolValue, unit: "SOL", sub: "paid from trading fees" },
        { icon: Bot, tone: "text-cyan", label: "Agent trades", value: data.agentTrades, fmt: int, sub: "rate-limited on-chain" },
      ]
    : null;

  return (
    <section aria-label="Platform stats" className="card grid grid-cols-2 overflow-hidden sm:grid-cols-5">
      {items
        ? items.map((s, i) => (
            <div
              key={s.label}
              className={cn(
                "border-line px-4 py-4 sm:px-5",
                i === 0 && "col-span-2 border-b sm:col-span-1 sm:border-b-0",
                i > 0 && "sm:border-l",
                (i === 1 || i === 2) && "border-b sm:border-b-0",
                i % 2 === 0 && i > 0 && "border-l",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-dim">
                <s.icon className={cn("size-3.5", s.tone)} aria-hidden />
                {s.label}
              </div>
              <div className="type-title mt-1.5 text-xl sm:text-[26px]">
                <AnimatedNumber value={s.value} format={s.fmt} />
                {s.unit ? <span className="ml-1 text-sm font-medium tracking-normal text-dim">{s.unit}</span> : null}
              </div>
              <div className="mt-0.5 truncate text-xs text-dim tabular-nums">{s.sub}</div>
            </div>
          ))
        : Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={cn("px-5 py-4", i === 0 && "col-span-2 sm:col-span-1")}>
              {isError ? (
                i === 0 ? <div className="text-sm text-dim">Stats unavailable — indexer offline</div> : null
              ) : (
                <>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-2 h-6 w-24" />
                  <Skeleton className="mt-2 h-3 w-16" />
                </>
              )}
            </div>
          ))}
    </section>
  );
}
