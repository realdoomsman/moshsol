"use client";

import { lamportsToSol } from "@holdfast/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClampGlyph } from "@/components/brand/glyphs";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Countdown } from "@/components/ui/countdown";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ProgressBar } from "@/components/ui/progress";
import { Sparkline } from "@/components/ui/sparkline";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { fmtSolValue } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { useFallbackInterval, useLiveEvents } from "@/lib/live";
import type { LaunchSummary } from "@/lib/types";
import { trendingQuery } from "@/lib/users";
import { Change, useDaySpark } from "./launch-card";
import { vaultOf } from "./model";

/** "12m", "3h 05m", "2d 4h" — how long the #1 has held the top spot. */
function fmtHeld(secs: number): string {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Both panels share one skeleton: label, head row, (body), a footer pinned to the bottom edge. */
const PANEL =
  "relative flex min-w-0 flex-col rounded-md border border-line bg-surface p-4 transition-colors hover:border-line-2 hover:bg-raised " +
  "has-[a[data-card-link]:focus-visible]:outline-2 has-[a[data-card-link]:focus-visible]:outline-offset-2 has-[a[data-card-link]:focus-visible]:outline-accent";
/** Border + 12px + a 32px button (40px on touch): both footers are the same height, text or not. */
const FOOTER = "mt-auto flex min-h-[45px] items-center gap-x-3 gap-y-1 border-t border-line pt-3 pointer-coarse:min-h-[53px]";

function Head({ l, href, value, sub }: { l: LaunchSummary; href: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="mt-3 mb-4 flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={56} />
        <div className="min-w-0">
          <div className="h3 truncate text-ink">
            <Link href={href} data-card-link className="outline-none after:absolute after:inset-0 after:content-['']">
              {l.name}
            </Link>
          </div>
          <div className="small text-ink-3">${l.symbol}</div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="h3 num text-ink">{value}</div>
        <div className="small num text-ink-3">{sub}</div>
      </div>
    </div>
  );
}

function TrendingPanel({ launch: l, kingSince, now }: { launch: LaunchSummary; kingSince: number | null; now: number }) {
  const spark = useDaySpark(l.mint, true, now);
  const vault = vaultOf(l);
  return (
    <article className={PANEL}>
      <div className="label text-ink-3">
        {kingSince !== null ? (
          <>
            #1 trending <span aria-hidden>·</span> held <span className="num normal-case">{fmtHeld(now - kingSince)}</span>
          </>
        ) : (
          "Top live launch"
        )}
      </div>
      <Head
        l={l}
        href={`/launch/${l.mint}`}
        value={<NumberTicker value={l.marketCapSol} format={(v) => `${fmtSolValue(v)} SOL`} />}
        sub={
          <>
            mcap · <Change value={l.change24h} /> 24h
          </>
        }
      />
      <div className={cn(FOOTER, "small text-ink-2")}>
        <ClampGlyph className="shrink-0 text-accent-ink" />
        <span className="num min-w-0 truncate">
          {fmtSolValue(vault.sol)} SOL + {vault.supplyPct.toFixed(2)}% supply in the vault
        </span>
        {l.volume1hSol > 0 ? (
          <span className="num ml-auto shrink-0 text-ink-3">{fmtSolValue(l.volume1hSol)} SOL traded 1h</span>
        ) : null}
        {spark ? <Sparkline values={spark} className={cn("h-6 w-20 shrink-0", l.volume1hSol > 0 ? "" : "ml-auto")} /> : null}
      </div>
    </article>
  );
}

function ClosingPanel({ launch: l }: { launch: LaunchSummary }) {
  const raised = lamportsToSol(l.raised);
  const max = lamportsToSol(l.raiseMax);
  const min = lamportsToSol(l.raiseMin);
  return (
    <article className={PANEL}>
      <div className="label text-ink-3">Closing soonest</div>
      <Head
        l={l}
        href={`/launch/${l.mint}`}
        value={
          <>
            {fmtSolValue(raised)} <span className="text-ink-3">/ {fmtSolValue(max)} SOL</span>
          </>
        }
        sub={`min ${fmtSolValue(min)}`}
      />
      <ProgressBar value={raised} max={max} min={min} className="mb-4" />
      <div className={cn(FOOTER, "justify-between")}>
        <div className="small num min-w-0 truncate text-ink-2">
          <Countdown to={l.raiseDeadline} prefix="Closes" /> · {l.backerCount} {l.backerCount === 1 ? "backer" : "backers"}
        </div>
        <span className="relative z-10">
          <ButtonLink href={`/launch/${l.mint}`} size="sm" variant="secondary" arrow>
            Back
          </ButtonLink>
        </span>
      </div>
    </article>
  );
}

/**
 * Spotlight (§4.4): the trending #1 from `/api/trending` (with how long it has held the spot) and
 * the open raise closing soonest. A panel without a subject is left out rather than filled.
 */
export function Spotlight({ launches, now }: { launches: LaunchSummary[]; now: number }) {
  const qc = useQueryClient();
  const interval = useFallbackInterval(15_000);
  const trending = useQuery({ ...trendingQuery(), refetchInterval: interval });
  useLiveEvents((e) => {
    if (e.type === "trade") void qc.invalidateQueries({ queryKey: trendingQuery().queryKey });
  });

  const king = trending.data?.king;
  const top = king?.launch ?? trending.data?.top[0];
  // Prefer the list's copy: it's refreshed by the websocket more often than /api/trending.
  const topLaunch = top ? (launches.find((l) => l.mint === top.mint) ?? top) : undefined;
  const closing = launches
    .filter((l) => phaseOf(l, now) === "raising")
    .sort((a, b) => a.raiseDeadline - b.raiseDeadline)[0];

  if (!topLaunch && !closing) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {topLaunch ? <TrendingPanel launch={topLaunch} kingSince={king ? king.kingSince : null} now={now} /> : null}
      {closing ? <ClosingPanel launch={closing} /> : null}
    </div>
  );
}
