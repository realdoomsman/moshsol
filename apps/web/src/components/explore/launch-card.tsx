"use client";

import { lamportsToSol, tokensToUi } from "@moshsol/sdk";
import { Bot, Clock, Lock, ShieldCheck, Users } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { phaseOf, type Phase } from "@/lib/launch";
import { useCandles, usePlatform } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { Countdown, Sparkline, TokenAvatar } from "../ui/interactive";
import { Badge, Skeleton } from "../ui/primitives";
import { ChangeText, PhasePill } from "../ui/status";
import { RaiseBar } from "../launch/raise-bar";

function LiveBody({ l }: { l: LaunchSummary }) {
  const candles = useCandles(l.mint, 60);
  const recent = (candles.data?.candles ?? []).slice(-60);
  // Start from the first candle's open so a single bucket still draws a line.
  const points = recent.length ? [recent[0].open, ...recent.map((c) => c.close)] : [];
  const up = (l.change24h ?? 0) >= 0;
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-dim">Market cap</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            {fmtSolValue(l.marketCapSol)} <span className="text-xs font-medium text-dim">SOL</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wider text-dim">24h</div>
          <ChangeText value={l.change24h} className="mt-0.5 block text-lg font-semibold" />
        </div>
      </div>
      <div className="mt-2 h-8">
        {points.length >= 2 ? (
          <Sparkline values={points} up={up} />
        ) : candles.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <div className="flex h-8 items-center text-xs text-dim">No trades yet</div>
        )}
      </div>
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

export function LaunchCard({ launch: l, now, index = 0 }: { launch: LaunchSummary; now: number; index?: number }) {
  const platform = usePlatform();
  const phase = phaseOf(l, now);
  const windowSecs = platform.data?.params.agentWindowSecs ?? 0;
  const agentsActive =
    phase === "live" &&
    windowSecs > 0 &&
    now < l.windowStart + windowSecs &&
    (BigInt(l.windowSolSpent) > 0n || BigInt(l.windowTokensSold) > 0n);
  const vaultValue = lamportsToSol(l.vaultSol) + tokensToUi(l.vaultTokens) * l.priceSol;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay: Math.min(index, 12) * 0.03 }}
      whileHover={{ y: -3 }}
    >
      <Link
        href={`/launch/${l.mint}`}
        className="card group block h-full p-4 transition-colors duration-200 hover:border-line-strong hover:bg-white/[0.045] focus-visible:border-lime/50"
      >
        <div className="flex items-start gap-3">
          <TokenAvatar src={l.image} symbol={l.symbol} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold leading-tight group-hover:text-lime">{l.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
                  <span className="font-medium">${l.symbol}</span>
                  {l.whitelisted ? (
                    <Lock className="size-3 text-warn" aria-label="Whitelist raise" />
                  ) : null}
                </div>
              </div>
              <PhasePill phase={phase} />
            </div>
          </div>
        </div>

        {phase === "live" ? <LiveBody l={l} /> : <RaisingBody l={l} phase={phase} />}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
          {phase === "live" ? (
            <Badge tone="lime" title="SOL + tokens locked in the vault forever">
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
              className={cn(
                "inline-flex items-center gap-1.5 text-[11.5px] font-medium",
                agentsActive ? "text-cyan" : "text-dim",
              )}
              title={`Vault value ≈ ${fmtSolValue(vaultValue)} SOL · ${l.agentBuys} agent buys / ${l.agentSells} sells`}
            >
              <Bot className="size-3.5" aria-hidden />
              {agentsActive ? (
                <>
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-cyan text-cyan" />
                  active
                </>
              ) : (
                `${l.agentBuys + l.agentSells} trades`
              )}
            </span>
          ) : null}
        </div>
      </Link>
    </motion.div>
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
