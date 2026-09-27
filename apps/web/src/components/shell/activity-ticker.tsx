"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { describeActivity, TONE_TEXT } from "@/lib/activity";
import { useLive } from "@/lib/live";
import { useActivity } from "@/lib/queries";
import type { ActivityEvent } from "@/lib/types";
import { cn } from "../ui/cn";
import { TokenAvatar } from "../ui/interactive";

function TickerItem({ e }: { e: ActivityEvent }) {
  const d = describeActivity(e);
  return (
    <Link
      href={`/launch/${e.mint}`}
      prefetch={false}
      className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-2.5 text-[12.5px] transition hover:bg-white/[0.05]"
    >
      <TokenAvatar src={e.image} symbol={e.symbol} size={18} />
      {e.isAgent ? <Bot className="size-3.5 text-cyan" aria-label="Agent" /> : null}
      <span className={cn("font-medium", e.isAgent ? "text-cyan" : "text-muted")}>{d.who}</span>
      <span className={TONE_TEXT[d.tone]}>{d.verb}</span>
      {d.amount ? <span className="font-semibold tabular-nums text-ink">{d.amount}</span> : null}
      <span className="font-semibold text-ink group-hover:text-lime">${e.symbol}</span>
    </Link>
  );
}

export function ActivityTicker() {
  const { connected } = useLive();
  const { data, isError } = useActivity();
  const events = data?.events.slice(0, 24) ?? [];
  const duration = Math.max(30, events.length * 5);

  return (
    <div className="border-b border-line bg-black/20">
      <div className="mx-auto flex h-10 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em]",
            connected ? "text-lime" : "text-dim",
          )}
        >
          <span className={cn("size-1.5 rounded-full", connected ? "animate-pulse-dot bg-lime text-lime" : "bg-dim")} />
          Live
        </span>
        <div className="no-scrollbar relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)] motion-reduce:overflow-x-auto">
          {events.length === 0 ? (
            <div className="truncate text-[12.5px] text-dim">
              {isError ? "Indexer unreachable — retrying…" : "Waiting for on-chain activity…"}
            </div>
          ) : (
            <div
              className="flex w-max animate-marquee hover:[animation-play-state:paused]"
              style={{ ["--marquee-duration" as string]: `${duration}s` }}
            >
              {[0, 1].map((copy) => (
                <div key={copy} className="flex shrink-0 items-center gap-1 pr-1" aria-hidden={copy === 1}>
                  {events.map((e) => (
                    <TickerItem key={`${copy}-${e.id}`} e={e} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
