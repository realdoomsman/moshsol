"use client";

import { fmtPrice, lamportsToSol, timeAgo, tokensToUi } from "@holdfast/sdk";
import { ArrowRight, Bot, Coins, Flame, Lock, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { fmtLamports, fmtSolValue } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { phaseOf } from "@/lib/launch";
import { useAgents, useAgentStatus, useCandles, useLaunches, usePlatform, useStats } from "@/lib/queries";
import { useTokenColor } from "@/lib/token-color";
import type { LaunchSummary } from "@/lib/types";
import { RaiseBar } from "../launch/raise-bar";
import { ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { AnimatedNumber, Countdown, Sparkline, TokenAvatar } from "../ui/interactive";
import { Skeleton } from "../ui/primitives";
import { ChangePill } from "../ui/status";
import { VaultScene } from "./vault-scene";

/** The top trending live launch: price, chart, what's locked, and what its agent is doing. */
function FeaturedLaunch({ launch: l }: { launch: LaunchSummary }) {
  const tc = useTokenColor(l.image, l.mint);
  const candles = useCandles(l.mint, 60);
  const status = useAgentStatus();
  const now = useNow(5_000);
  const recent = (candles.data?.candles ?? []).slice(-60);
  // Start from the first candle's open so a single bucket still draws a line.
  const points = recent.length ? [recent[0].open, ...recent.map((c) => c.close)] : [];
  const vault = lamportsToSol(l.vaultSol) + tokensToUi(l.vaultTokens) * l.priceSol;
  const decision = status.data?.decisions.find((d) => d.mint === l.mint);

  return (
    <Link
      href={`/launch/${l.mint}`}
      className="card-hover tc-ease group relative block overflow-hidden rounded-2xl border border-line bg-black/40 p-4"
      style={{ "--tc": tc } as CSSProperties}
    >
      <div className="pointer-events-none absolute -top-20 -right-12 size-56 rounded-full bg-(--tc)/15 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenAvatar src={l.image} symbol={l.symbol} size={44} />
          <div className="min-w-0">
            <div className="type-eyebrow flex items-center gap-1.5 text-(--tc)">
              <Flame className="size-3" aria-hidden /> Trending #1
            </div>
            <div className="mt-1 flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[15px] font-semibold transition-colors group-hover:text-lime">{l.name}</span>
              <span className="shrink-0 text-xs font-medium text-muted">${l.symbol}</span>
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg leading-tight font-semibold tracking-tight">
            <AnimatedNumber value={l.priceSol} format={fmtPrice} flash />
            <span className="ml-1 text-xs font-medium text-dim">SOL</span>
          </div>
          <ChangePill value={l.change24h} size="sm" label="24h" className="mt-1" />
        </div>
      </div>

      <div className="relative mt-3">
        {points.length >= 2 ? (
          <Sparkline values={points} up={(l.change24h ?? 0) >= 0} color={tc} dot className="h-14" />
        ) : candles.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <div className="grid h-14 place-items-center rounded-xl border border-dashed border-line text-xs text-dim">
            Chart starts with the first trade
          </div>
        )}
      </div>

      <dl className="relative mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
        <div className="min-w-0">
          <dt className="text-dim">Vault locked</dt>
          <dd className="mt-0.5 flex items-center gap-1 truncate text-[13px] font-semibold text-ink tabular-nums sm:text-sm">
            <Lock className="hidden size-3 shrink-0 text-lime sm:block" aria-hidden />
            {fmtSolValue(vault)} SOL
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-dim">Market cap</dt>
          <dd className="mt-0.5 truncate text-[13px] font-semibold text-ink tabular-nums sm:text-sm">{fmtSolValue(l.marketCapSol)} SOL</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-dim">Backers</dt>
          <dd className="mt-0.5 truncate text-[13px] font-semibold text-ink tabular-nums sm:text-sm">{l.backerCount}</dd>
        </div>
      </dl>

      <div className="relative mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-3 py-2 text-xs">
        <span className="relative grid size-5 shrink-0 place-items-center">
          <Bot className="size-3.5 text-cyan" aria-hidden />
        </span>
        {decision ? (
          <>
            <span className="shrink-0 font-semibold text-ink capitalize">{decision.action}</span>
            <span className="min-w-0 truncate text-muted">{decision.reason}</span>
            <span className="ml-auto shrink-0 text-dim tabular-nums">{timeAgo(decision.at, now)}</span>
          </>
        ) : (
          <span className="truncate text-muted">
            {status.isError ? "Agent offline — the vault's on-chain limits still hold" : "Agent watching the EMA band…"}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Shown in the featured slot when nothing is live yet but a raise is open. */
function FeaturedRaise({ launch: l }: { launch: LaunchSummary }) {
  return (
    <Link href={`/launch/${l.mint}`} className="card-hover group block rounded-2xl border border-line bg-black/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenAvatar src={l.image} symbol={l.symbol} size={40} />
          <div className="min-w-0">
            <div className="type-eyebrow flex items-center gap-1.5 text-[#c2a6ff]">
              <Sparkles className="size-3" aria-hidden /> Raising now
            </div>
            <div className="mt-1 truncate font-semibold group-hover:text-lime">
              {l.name} <span className="text-xs font-medium text-muted">${l.symbol}</span>
            </div>
          </div>
        </div>
        <span className="text-xs text-muted tabular-nums">
          <Countdown to={l.raiseDeadline} /> left
        </span>
      </div>
      <RaiseBar raised={l.raised} raiseMin={l.raiseMin} raiseMax={l.raiseMax} className="mt-4" />
      <div className="mt-2 flex justify-between text-xs text-dim tabular-nums">
        <span>
          <span className="font-semibold text-ink">{fmtLamports(l.raised)}</span> / {fmtLamports(l.raiseMax)} SOL
        </span>
        <span>min {fmtLamports(l.raiseMin)}</span>
      </div>
    </Link>
  );
}

function VaultShowcase() {
  const stats = useStats();
  const agents = useAgents();
  const { data, isLoading } = useLaunches({ status: "all", sort: "trending" });
  const now = useNow(5_000);
  const launches = data?.launches ?? [];
  const live = launches.filter((l) => phaseOf(l, now) === "live");
  const raising = launches.filter((l) => phaseOf(l, now) === "raising");
  const recent = agents.data?.recent.slice(0, 3) ?? [];
  const locked = stats.data ? stats.data.lockedVaultSol + stats.data.lockedVaultTokensValueSol : null;

  return (
    <div className="relative">
      <div className="absolute -inset-px rounded-[26px] bg-gradient-to-br from-violet/55 via-white/5 to-cyan/40 opacity-80" />
      <div className="card relative overflow-hidden rounded-[26px] bg-[#090b0e]/90 p-4 sm:p-5">
        <div className="pointer-events-none absolute -top-28 -right-20 size-72 rounded-full bg-violet/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4 px-1 pt-1">
          <div className="min-w-0">
            <div className="type-eyebrow flex items-center gap-2 text-muted">
              <Lock className="size-3.5 text-lime" aria-hidden /> Locked in vaults
            </div>
            <div className="type-display mt-2 text-[40px] sm:text-5xl">
              {locked === null ? (
                <Skeleton className="h-12 w-48" />
              ) : (
                <>
                  <AnimatedNumber value={locked} format={fmtSolValue} />
                  <span className="ml-2 text-lg font-medium tracking-normal text-dim">SOL</span>
                </>
              )}
            </div>
            {stats.data ? (
              <div className="mt-1.5 text-sm text-muted tabular-nums">
                {fmtSolValue(stats.data.lockedVaultSol)} SOL reserve + {fmtSolValue(stats.data.lockedVaultTokensValueSol)} SOL in
                bundle tokens
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-lime/25 bg-lime/10 px-2.5 text-[11px] font-semibold text-lime">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-lime text-lime" /> forever
            </span>
            {stats.data ? (
              <span className="text-xs text-dim tabular-nums">
                {stats.data.liveLaunches} vault{stats.data.liveLaunches === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>

        <VaultScene
          className="-mt-2 sm:-mt-4"
          orbiters={live.map((l) => ({ key: l.mint, image: l.image, symbol: l.symbol }))}
        />

        <div className="relative -mt-1 grid gap-2.5">
          {isLoading ? (
            <Skeleton className="h-[212px] w-full rounded-2xl" />
          ) : live[0] ? (
            <FeaturedLaunch launch={live[0]} />
          ) : raising[0] ? (
            <FeaturedRaise launch={raising[0]} />
          ) : (
            <Link
              href="/create"
              className="card-hover flex items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong bg-black/30 p-4"
            >
              <span>
                <span className="block font-semibold">No launches yet</span>
                <span className="block text-sm text-muted">Open the first raise — its bundle lands in a vault like this one.</span>
              </span>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lime text-black">
                <Plus className="size-5" aria-hidden />
              </span>
            </Link>
          )}

          {recent.length ? (
            <div className="rounded-2xl border border-line bg-black/25 p-3">
              <div className="flex items-center justify-between px-1 text-dim">
                <span className="type-eyebrow inline-flex items-center gap-1.5">
                  <Bot className="size-3.5 text-cyan" aria-hidden /> Latest agent trades
                </span>
                <Link href="/agents" className="inline-flex min-h-10 items-center px-1 text-xs text-muted hover:text-lime">
                  Rules →
                </Link>
              </div>
              <div className="mt-1.5 grid gap-1">
                {recent.map((t) => (
                  <Link
                    key={t.signature}
                    href={`/launch/${t.mint}`}
                    className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 text-sm transition hover:bg-white/[0.04]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase",
                          t.isBuy ? "bg-up/15 text-up" : "bg-down/15 text-down",
                        )}
                      >
                        {t.isBuy ? "buy" : "sell"}
                      </span>
                      <span className="truncate font-medium">${t.symbol}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 tabular-nums">
                      <span>{fmtSolValue(lamportsToSol(t.solAmount))} SOL</span>
                      <span className="w-14 text-right text-xs text-dim">{timeAgo(t.timestamp, now)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  const platform = usePlatform();
  const stats = useStats();
  const p = platform.data?.params;
  const points = [
    { icon: Lock, text: "Bundle locked forever — no withdraw instruction exists" },
    {
      icon: Bot,
      text: p
        ? `Agents buy ${p.agentBandBps / 100}%+ under the EMA and sell ${p.agentBandBps / 100}%+ over it — never at a loss, max ${p.agentSellBpsPerWindow / 100}% of the vault per ${Math.round(p.agentWindowSecs / 60)} min`
        : "Agents trade it only inside hard on-chain limits",
    },
    {
      icon: Coins,
      text: p
        ? `Backers earn ${(p.tradeFeeBps * p.backerFeeShareBps) / 1_000_000}% of every trade, forever`
        : "Backers earn a cut of every trade, forever",
    },
  ];

  return (
    <section className="relative grid items-center gap-10 pt-6 pb-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pt-12 lg:pb-14">
      <div className="animate-in">
        <div className="inline-flex h-8 items-center gap-2.5 rounded-full border border-line bg-white/[0.04] pr-3 pl-1 text-xs font-medium text-muted">
          <span className="rounded-full bg-gradient-brand px-2 py-0.5 text-[11px] font-bold text-black">NEW</span>
          <span>Bundle-locked launches on Solana</span>
          {stats.data ? (
            <span className="hidden items-center gap-1.5 border-l border-line pl-2.5 text-ink tabular-nums sm:inline-flex">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-up text-up" />
              {stats.data.liveLaunches} live · {stats.data.raisingLaunches} raising
            </span>
          ) : null}
        </div>
        <h1 className="type-display mt-6 text-[44px] text-balance sm:text-6xl lg:text-[72px]">
          Launches that{" "}
          <span className="relative whitespace-nowrap text-lime">
            can&apos;t be dumped
            <svg
              aria-hidden
              viewBox="0 0 300 12"
              preserveAspectRatio="none"
              className="absolute -bottom-2 left-0 h-2.5 w-full text-lime/50 sm:-bottom-3"
            >
              <path d="M2 9C60 3 150 1 298 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted text-pretty sm:text-xl">
          The bundle is locked forever and <span className="text-gradient font-semibold">trades for the market</span>.
          Backers fund it, agents defend it, everyone can verify it on-chain.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ButtonLink href="/create" variant="primary" size="lg">
            Launch a token <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href="/how-it-works" variant="secondary" size="lg">
            How it works
          </ButtonLink>
        </div>
        <ul className="mt-9 grid gap-3">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-[15px] leading-relaxed text-muted">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.04]">
                <Icon className="size-3.5 text-lime" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="animate-in [animation-delay:60ms]">
        <VaultShowcase />
      </div>
    </section>
  );
}
