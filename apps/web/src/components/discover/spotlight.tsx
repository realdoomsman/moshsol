"use client";

import { lamportsToSol } from "@holdfast/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ClampGlyph } from "@/components/brand/glyphs";
import { ButtonLink } from "@/components/ui/button";
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

const PANEL = "relative min-w-0 rounded-md border border-line bg-surface p-4 transition-colors hover:bg-raised";

function Head({ l, href }: { l: LaunchSummary; href: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={56} />
      <div className="min-w-0">
        <div className="h3 truncate text-ink">
          <Link href={href} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline">
            {l.name}
          </Link>
        </div>
        <div className="small text-ink-3">${l.symbol}</div>
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
      <div className="mt-3 flex items-center justify-between gap-4">
        <Head l={l} href={`/launch/${l.mint}`} />
        <div className="shrink-0 text-right">
          <div className="small text-ink-3">Mcap</div>
          <NumberTicker value={l.marketCapSol} format={(v) => `${fmtSolValue(v)} SOL`} className="ui text-ink" />
          <div>
            <Change value={l.change24h} className="small" />
          </div>
        </div>
      </div>
      <div className="small mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-ink-2">
        <ClampGlyph className="shrink-0 text-accent-ink" />
        <span className="num">
          Vault {fmtSolValue(vault.sol)} SOL + {vault.supplyPct.toFixed(2)}% supply
        </span>
        {l.volume1hSol > 0 ? (
          <span className="num ml-auto shrink-0 text-ink-3">{fmtSolValue(l.volume1hSol)} SOL traded 1h</span>
        ) : null}
        {spark ? <Sparkline values={spark} className="h-6 w-20 shrink-0" /> : null}
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
      <div className="mt-3 flex items-center justify-between gap-4">
        <Head l={l} href={`/launch/${l.mint}`} />
        <div className="shrink-0 text-right">
          <div className="ui num text-ink">
            {fmtSolValue(raised)} <span className="text-ink-3">/ {fmtSolValue(max)} SOL</span>
          </div>
          <div className="small num text-ink-3">min {fmtSolValue(min)}</div>
        </div>
      </div>
      <ProgressBar value={raised} max={max} min={min} className="mt-3" />
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
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
