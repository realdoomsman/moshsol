"use client";

import { lamportsToSol } from "@holdfast/sdk";
import Link from "next/link";
import { fmtSolValue } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useLaunches } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { formatCountdown } from "../ui/countdown";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { NumberTicker } from "../ui/number-ticker";
import { ProgressBar } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { TokenAvatar } from "../ui/token-avatar";

const MAX_TILES = 6;
const MAX_RAISING = 2;

/**
 * §2 "On Holdfast now": up to six tiles in one 1px-ruled row — the open raises closing soonest
 * (up to two), then live launches by trending. Horizontal scroll-snap on mobile. No marquee.
 */
export function LiveLaunches() {
  const nowSec = useNow(30_000);
  const raising = useLaunches({ status: "raising", sort: "new" });
  const live = useLaunches({ status: "live", sort: "trending" });

  const open = (raising.data?.launches ?? [])
    .filter((l) => l.raiseDeadline > nowSec && BigInt(l.raised) < BigInt(l.raiseMax))
    .sort((a, b) => a.raiseDeadline - b.raiseDeadline)
    .slice(0, MAX_RAISING);
  const tiles = [...open, ...(live.data?.launches ?? []).slice(0, MAX_TILES - open.length)];

  let body;
  if (tiles.length) {
    body = (
      <ul className="no-scrollbar -mx-5 flex snap-x snap-mandatory overflow-x-auto border-y border-line px-5 md:mx-0 md:grid md:snap-none md:grid-flow-col md:auto-cols-fr md:overflow-visible md:px-0">
        {tiles.map((l, i) => (
          <li key={l.mint} className={cn("w-[260px] shrink-0 snap-start md:w-auto", i > 0 && "border-l border-line")}>
            <Tile launch={l} />
          </li>
        ))}
      </ul>
    );
  } else if (raising.isError && live.isError) {
    body = (
      <ErrorState onRetry={() => void Promise.all([raising.refetch(), live.refetch()])} retrying={live.isFetching}>
        Couldn&rsquo;t load launches. Indexer unreachable.
      </ErrorState>
    );
  } else if (raising.isPending || live.isPending) {
    body = (
      <div className="grid grid-cols-2 border-y border-line md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="p-5">
            <Skeleton className="size-10" />
            <Skeleton className="mt-3 h-4 w-28" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <EmptyState action={<ButtonLink href="/create" size="sm" variant="secondary">Launch a token</ButtonLink>}>
        No raises open and nothing trading yet.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h2 className="h2 text-ink">On Holdfast now</h2>
        <Link href="/app" className="ui text-ink-2 transition-colors hover:text-ink">
          All launches →
        </Link>
      </div>
      {body}
    </div>
  );
}

function Tile({ launch: l }: { launch: LaunchSummary }) {
  const nowSec = useNow(30_000);
  const raising = l.status === "raising";
  const up = (l.change24h ?? 0) >= 0;
  return (
    <Link href={`/launch/${l.mint}`} className="block h-full p-5 transition-colors hover:bg-raised">
      <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={40} />
      <p className="h3 mt-3 truncate text-ink">{l.name}</p>
      <p className="small text-ink-3">${l.symbol}</p>
      {raising ? (
        <div className="mt-4">
          <ProgressBar
            value={lamportsToSol(l.raised)}
            max={lamportsToSol(l.raiseMax)}
            min={lamportsToSol(l.raiseMin)}
            label={`${l.name} raise progress`}
          />
          <p className="small num mt-2 text-ink-2">
            {fmtSolValue(lamportsToSol(l.raised))} / {fmtSolValue(lamportsToSol(l.raiseMax))} SOL ·{" "}
            {formatCountdown(l.raiseDeadline - nowSec)}
          </p>
        </div>
      ) : (
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
          <NumberTicker value={l.marketCapSol} format={(v) => `${fmtSolValue(v)} SOL`} className="num-l whitespace-nowrap text-ink" />
          {l.change24h === null ? null : (
            <span className={cn("small num whitespace-nowrap", up ? "text-up" : "text-down")}>
              {up ? "▲" : "▼"} {Math.abs(l.change24h).toFixed(Math.abs(l.change24h) >= 100 ? 0 : 1)}% 24h
            </span>
          )}
        </p>
      )}
    </Link>
  );
}
