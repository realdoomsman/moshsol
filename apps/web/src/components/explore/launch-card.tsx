"use client";

import { fmtPrice, lamportsToSol, tokensToUi } from "@holdfast/sdk";
import { ArrowRight, Bot, Clock, Lock, Plus, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { phaseOf, type Phase } from "@/lib/launch";
import { useCandles, usePlatform } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { AnimatedNumber, Countdown, Sparkline, TokenAvatar } from "../legacy/interactive";
import { Badge, Skeleton } from "../legacy/primitives";
import { ChangePill, ChangeText, PhasePill } from "../legacy/status";
import { RaiseBar } from "../launch/raise-bar";

export type CardSize = "md" | "lg";

function LiveBody({ l, size }: { l: LaunchSummary; size: CardSize }) {
  const candles = useCandles(l.mint, 60);
  const recent = (candles.data?.candles ?? []).slice(-60);
  // Start from the first candle's open so a single bucket still draws a line.
  const points = recent.length ? [recent[0].open, ...recent.map((c) => c.close)] : [];
  const up = (l.change24h ?? 0) >= 0;
  const lg = size === "lg";
  const chartHeight = lg ? "h-20" : "h-8";
  return (
    <>
      {lg ? (
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium tracking-wider text-dim uppercase">Price · SOL</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              <AnimatedNumber value={l.priceSol} format={fmtPrice} flash />
            </div>
          </div>
          <ChangePill value={l.change24h} label="24h" />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-medium tracking-wider text-dim uppercase">Market cap</div>
            <div className="mt-0.5 text-lg font-semibold">
              <AnimatedNumber value={l.marketCapSol} format={fmtSolValue} flash />{" "}
              <span className="text-xs font-medium text-dim">SOL</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium tracking-wider text-dim uppercase">24h</div>
            <ChangeText value={l.change24h} className="mt-0.5 block text-lg font-semibold" />
          </div>
        </div>
      )}
      <div className={cn("mt-3", chartHeight)}>
        {points.length >= 2 ? (
          <Sparkline values={points} up={up} dot={lg} className={chartHeight} />
        ) : candles.isLoading ? (
          <Skeleton className={cn("w-full", chartHeight)} />
        ) : (
          <div className={cn("flex items-center text-xs text-dim", chartHeight)}>No trades yet</div>
        )}
      </div>
      {lg ? (
        <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-dim">Market cap</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">{fmtSolValue(l.marketCapSol)} SOL</dd>
          </div>
          <div>
            <dt className="text-dim">Volume 24h</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">{fmtSolValue(l.volume24hSol)} SOL</dd>
          </div>
          <div>
            <dt className="text-dim">Holders</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">{l.holders.toLocaleString("en-US")}</dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}

function RaisingBody({ l, phase }: { l: LaunchSummary; phase: Phase }) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-lg font-semibold tabular-nums">
          {fmtLamports(l.raised)}
          <span className="text-sm font-medium text-dim"> / {fmtLamports(l.raiseMax)} SOL</span>
        </div>
        <div className="text-xs text-dim tabular-nums">min {fmtLamports(l.raiseMin)}</div>
      </div>
      <RaiseBar
        raised={l.raised}
        raiseMin={l.raiseMin}
        raiseMax={l.raiseMax}
        failed={phase === "failed" || phase === "refunding"}
        className="mt-2.5"
      />
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5 text-dim" aria-hidden />
          {phase === "raising" ? (
            <>
              <Countdown to={l.raiseDeadline} /> left
            </>
          ) : phase === "ready" ? (
            <span className="text-lime">Ready to launch</span>
          ) : phase === "refunding" ? (
            <span className="text-warn">Refunds open</span>
          ) : (
            <span className="text-down">Missed minimum</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5 text-dim" aria-hidden />
          {l.backerCount} backer{l.backerCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

export function LaunchCard({ launch: l, now, size = "md" }: { launch: LaunchSummary; now: number; size?: CardSize }) {
  const platform = usePlatform();
  const phase = phaseOf(l, now);
  const windowSecs = platform.data?.params.agentWindowSecs ?? 0;
  const agentsActive =
    phase === "live" &&
    windowSecs > 0 &&
    now < l.windowStart + windowSecs &&
    (BigInt(l.windowSolSpent) > 0n || BigInt(l.windowTokensSold) > 0n);
  const vaultValue = lamportsToSol(l.vaultSol) + tokensToUi(l.vaultTokens) * l.priceSol;
  const lg = size === "lg";

  return (
    <Link
      href={`/launch/${l.mint}`}
      className={cn(
        "card card-hover group block h-full animate-in overflow-hidden focus-visible:border-lime/50",
        lg ? "p-5 sm:p-6" : "p-4",
      )}
    >
      {lg ? <div className="pointer-events-none absolute -top-24 -right-20 size-56 rounded-full bg-up/[0.07] blur-3xl" /> : null}
      <div className="relative flex items-start gap-3">
        <TokenAvatar src={l.image} symbol={l.symbol} size={lg ? 56 : 48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className={cn(
                  "truncate leading-tight font-semibold transition-colors group-hover:text-lime",
                  lg ? "text-lg tracking-tight" : "text-[15px]",
                )}
              >
                {l.name}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
                <span className="font-medium">${l.symbol}</span>
                {l.whitelisted ? <Lock className="size-3 text-warn" aria-label="Whitelist raise" /> : null}
              </div>
            </div>
            <PhasePill phase={phase} />
          </div>
        </div>
      </div>

      {phase === "live" ? <LiveBody l={l} size={size} /> : <RaisingBody l={l} phase={phase} />}

      <div className="relative mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        {phase === "live" ? (
          <Badge tone="lime" title={`SOL + tokens locked in the vault forever · ≈ ${fmtSolValue(vaultValue)} SOL`}>
            <ShieldCheck className="size-3" aria-hidden />
            {fmtLamports(l.vaultSol)} SOL + {fmtTokens(l.vaultTokens)}
          </Badge>
        ) : (
          <Badge tone="neutral">
            Bundle {l.bundleSupplyBps / 100}% · Reserve {l.reserveBps / 100}%
          </Badge>
        )}
        {phase === "live" ? (
          <span
            className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-medium", agentsActive ? "text-cyan" : "text-dim")}
            title={`${l.agentBuys} agent buys / ${l.agentSells} sells`}
          >
            <Bot className="size-3.5" aria-hidden />
            {agentsActive ? (
              <>
                <span className="size-1.5 animate-pulse-dot rounded-full bg-cyan text-cyan" />
                active
              </>
            ) : (
              `${l.agentBuys + l.agentSells} agent trades`
            )}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/** Last grid tile: an invitation to open a raise, styled as an empty slot. */
export function LaunchYoursCard({ className }: { className?: string }) {
  return (
    <Link
      href="/create"
      className={cn(
        "card-hover group @container relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-dashed border-line-strong bg-white/[0.015] p-6 text-center transition-colors hover:border-lime/40 hover:bg-lime/[0.03]",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(198_255_61/0.08),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex flex-col items-center gap-4 @lg:flex-row @lg:gap-6 @lg:text-left">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime shadow-[0_0_40px_-10px_rgb(198_255_61/0.6)] transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
          <Plus className="size-6" aria-hidden />
        </span>
        <span className="block">
          <span className="block text-lg font-semibold tracking-tight">Launch yours</span>
          <span className="mt-1 block max-w-xs text-sm leading-relaxed text-muted">
            Open a raise — the bundle your backers fund gets locked in a vault like these.
          </span>
          <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-lime">
            Create a launch <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </span>
      </div>
    </Link>
  );
}

export function LaunchCardSkeleton() {
  return (
    <div className="card p-4">
      <div className="flex gap-3">
        <Skeleton className="size-12 rounded-2xl" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-5 h-5 w-1/2" />
      <Skeleton className="mt-3 h-8 w-full" />
      <Skeleton className="mt-4 h-6 w-2/3" />
    </div>
  );
}
