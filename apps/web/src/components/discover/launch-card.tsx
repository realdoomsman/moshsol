"use client";

import { lamportsToSol, timeAgo } from "@holdfast/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ClampGlyph } from "@/components/brand/glyphs";
import { ButtonLink } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import { cn } from "@/components/ui/cn";
import { Countdown } from "@/components/ui/countdown";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { WalletLink } from "@/components/wallet-peek/wallet-peek";
import { fmtSolValue } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { candlesQuery } from "@/lib/query-options";
import { SPARKLINE_MIN_POINTS } from "@/lib/thresholds";
import type { LaunchSummary } from "@/lib/types";
import type { Flash } from "./live";
import { chipStatus, vaultOf } from "./model";

const fmtSol = (v: number) => `${fmtSolValue(v)} SOL`;

/** 24h price change: ▲/▼ in the direction colour, "—" when there's no reference price. */
export function Change({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("num text-ink-3", className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={cn("num whitespace-nowrap", flat ? "text-ink-2" : value > 0 ? "text-up" : "text-down", className)}>
      {flat ? "" : value > 0 ? "▲ " : "▼ "}
      {Math.abs(value).toFixed(Math.abs(value) >= 100 ? 0 : 1)}%
    </span>
  );
}

/**
 * Closing prices over the last 24 h (15-minute candles, starting from the first bucket's open).
 * Fewer than 12 points → `null`, so cards omit the line and tables show "—" (§6.10).
 */
export function useDaySpark(mint: string, enabled: boolean, now: number): number[] | null {
  const candles = useQuery({ ...candlesQuery(mint, 900), enabled, staleTime: 60_000 });
  const recent = (candles.data?.candles ?? []).filter((c) => c.time >= now - 86_400);
  if (!recent.length) return null;
  const values = [recent[0].open, ...recent.map((c) => c.close)];
  return values.length >= SPARKLINE_MIN_POINTS ? values : null;
}

/** "Mcap 31.43 SOL". */
function Mcap({ l, className }: { l: LaunchSummary; className?: string }) {
  return <NumberTicker value={l.marketCapSol} format={fmtSol} className={className} />;
}

function Byline({ l, now }: { l: LaunchSummary; now: number }) {
  return (
    <div className="small mt-0.5 flex min-w-0 items-center gap-1 text-ink-3">
      <span className="shrink-0 text-ink-2">${l.symbol}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0">by</span>
      <span className="relative z-10 min-w-0">
        <WalletLink wallet={l.creator} name={l.creatorName} identicon={false} />
      </span>
      <span aria-hidden>·</span>
      <span className="num shrink-0">{timeAgo(l.createdAt, now).replace(" ago", "")}</span>
    </div>
  );
}

function LiveBody({ l, now }: { l: LaunchSummary; now: number }) {
  const spark = useDaySpark(l.mint, true, now);
  const vault = vaultOf(l);
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="label text-ink-3">Mcap</span>
        <Mcap l={l} className="ui text-ink" />
        <Change value={l.change24h} className="small" />
        {spark ? <Sparkline values={spark} className="ml-auto h-6 w-20" /> : null}
      </div>
      <div className="small mt-2 flex min-w-0 items-center gap-1.5 text-ink-2">
        <ClampGlyph className="shrink-0 text-accent-ink" />
        <span className="num truncate">
          {fmtSolValue(vault.sol)} SOL + {vault.supplyPct.toFixed(vault.supplyPct >= 10 ? 1 : 2)}% supply locked
        </span>
      </div>
      <div className="small num mt-1 text-ink-3">
        {l.backerCount} {l.backerCount === 1 ? "backer" : "backers"} · {l.holders} {l.holders === 1 ? "holder" : "holders"}
      </div>
    </>
  );
}

function RaisingBody({ l, now }: { l: LaunchSummary; now: number }) {
  const phase = phaseOf(l, now);
  const raised = lamportsToSol(l.raised);
  const max = lamportsToSol(l.raiseMax);
  const min = lamportsToSol(l.raiseMin);
  const open = phase === "raising";
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="ui num text-ink">
          {fmtSolValue(raised)} <span className="text-ink-3">/ {fmtSolValue(max)} SOL</span>
        </span>
        <span className="small num text-ink-3">min {fmtSolValue(min)}</span>
      </div>
      <ProgressBar value={raised} max={max} min={min} tone={open || phase === "ready" ? "default" : "muted"} className="mt-2" />
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="small num min-w-0 truncate text-ink-3">
          {open ? (
            <Countdown to={l.raiseDeadline} prefix="Closes" />
          ) : phase === "ready" ? (
            BigInt(l.raised) >= BigInt(l.raiseMax) ? "Max reached" : "Raise closed"
          ) : phase === "refunding" ? (
            "Raise cancelled"
          ) : (
            "Min not reached"
          )}
          {" · "}
          {l.backerCount} {l.backerCount === 1 ? "backer" : "backers"}
          {open || phase === "ready" ? ` · bundle ≤ ${l.bundleSupplyBps / 100}%` : ""}
        </div>
        {open ? (
          <span className="relative z-10">
            <ButtonLink href={`/launch/${l.mint}`} size="sm" variant="secondary" aria-label={`Back $${l.symbol}`}>
              Back
            </ButtonLink>
          </span>
        ) : (
          <span className="small shrink-0 text-ink-2">{phase === "ready" ? "Ready to launch" : "Refunds open"}</span>
        )}
      </div>
    </>
  );
}

/** Outline flash (§3.8.3) layered over the card, restarted per trade. */
function FlashOutline({ flash }: { flash: Flash | undefined }) {
  if (!flash) return null;
  return (
    <span
      key={flash.n}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 rounded-md",
        flash.dir === "up" ? "animate-outline-up" : "animate-outline-down",
      )}
    />
  );
}

/**
 * Discover card (§4.4): surface, 12px radius, 1px line, 16px padding, hover `raised`. The name is a
 * stretched link over the whole card; the creator peek and "Back" sit above it.
 */
export function LaunchCard({
  launch: l,
  now,
  flash,
  fresh,
}: {
  launch: LaunchSummary;
  now: number;
  flash?: Flash;
  /** Just inserted by a live update: expand in. */
  fresh?: boolean;
}) {
  const status = chipStatus(l, now);
  const live = status === "live";
  return (
    <article
      className={cn(
        "relative rounded-md border border-line bg-surface p-4 transition-colors hover:border-line-2 hover:bg-raised",
        "has-[a[data-card-link]:focus-visible]:outline-2 has-[a[data-card-link]:focus-visible]:outline-offset-2 has-[a[data-card-link]:focus-visible]:outline-accent",
        fresh && "animate-expand-in overflow-hidden [--expand-to:240px]",
      )}
    >
      <FlashOutline flash={flash} />
      <div className="flex gap-3">
        <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="h3 min-w-0 truncate text-ink">
              <Link href={`/launch/${l.mint}`} data-card-link className="outline-none after:absolute after:inset-0 after:content-['']">
                {l.name}
              </Link>
            </h3>
            <StatusChip status={status} className="shrink-0" />
          </div>
          <Byline l={l} now={now} />
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-3">{live ? <LiveBody l={l} now={now} /> : <RaisingBody l={l} now={now} />}</div>
    </article>
  );
}

export function LaunchCardSkeleton() {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="flex gap-3">
        <Skeleton className="size-14 rounded-md" />
        <div className="flex-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-44" />
        </div>
      </div>
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-3 h-4 w-2/3" />
    </div>
  );
}

/** Mobile list row (§4.4): 72px, image 48, name + ticker, mcap + change or progress + time left. */
export function LaunchRow({ launch: l, now, flash, fresh }: { launch: LaunchSummary; now: number; flash?: Flash; fresh?: boolean }) {
  const status = chipStatus(l, now);
  const live = status === "live";
  const phase = phaseOf(l, now);
  return (
    <Link
      href={`/launch/${l.mint}`}
      className={cn(
        "relative flex h-[72px] items-center gap-3 border-b border-line px-1 transition-colors last:border-b-0 hover:bg-raised",
        fresh && "animate-expand-in overflow-hidden [--expand-to:72px]",
      )}
    >
      <FlashOutline flash={flash} />
      <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={48} />
      <div className="min-w-0 flex-1">
        <div className="ui truncate text-ink">{l.name}</div>
        <div className="small truncate text-ink-3">${l.symbol}</div>
      </div>
      {live ? (
        <div className="shrink-0 text-right">
          <Mcap l={l} className="ui block text-ink" />
          <Change value={l.change24h} className="small" />
        </div>
      ) : (
        <div className="w-28 shrink-0 text-right">
          <div className="small num text-ink">
            {fmtSolValue(lamportsToSol(l.raised))} / {fmtSolValue(lamportsToSol(l.raiseMax))}
          </div>
          <ProgressBar
            value={lamportsToSol(l.raised)}
            max={lamportsToSol(l.raiseMax)}
            min={lamportsToSol(l.raiseMin)}
            tone={phase === "raising" || phase === "ready" ? "default" : "muted"}
            className="my-1.5"
          />
          <div className="small num text-ink-3">
            {phase === "raising" ? (
              <Countdown to={l.raiseDeadline} endedLabel="Closed" />
            ) : phase === "ready" ? (
              "Ready to launch"
            ) : (
              "Refunds open"
            )}
            {phase === "raising" ? " left" : ""}
          </div>
        </div>
      )}
    </Link>
  );
}
