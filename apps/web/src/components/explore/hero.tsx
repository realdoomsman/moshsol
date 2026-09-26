"use client";

import { lamportsToSol, timeAgo } from "@moshsol/sdk";
import { ArrowRight, Bot, Coins, Lock } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { fmtSolValue } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useAgents, usePlatform, useStats } from "@/lib/queries";
import { ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { AnimatedNumber } from "../ui/interactive";
import { Skeleton } from "../ui/primitives";

function VaultPanel() {
  const stats = useStats();
  const agents = useAgents();
  const now = useNow(5_000);
  const recent = agents.data?.recent.slice(0, 4) ?? [];
  const locked = stats.data ? stats.data.lockedVaultSol + stats.data.lockedVaultTokensValueSol : null;

  return (
    <div className="relative">
      <div className="absolute -inset-px rounded-[22px] bg-gradient-to-br from-violet/50 via-transparent to-cyan/40 opacity-70 blur-[1px]" />
      <div className="card relative overflow-hidden rounded-[22px] bg-[#0b0d10]/90 p-5 sm:p-6">
        <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-violet/20 blur-3xl" />
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <Lock className="size-3.5 text-lime" aria-hidden /> Locked in vaults
          </div>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-dim">forever</span>
        </div>
        <div className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          {locked === null ? (
            <Skeleton className="h-12 w-48" />
          ) : (
            <>
              <AnimatedNumber value={locked} format={fmtSolValue} />
              <span className="ml-2 text-lg font-medium text-dim">SOL</span>
            </>
          )}
        </div>
        {stats.data ? (
          <div className="mt-1.5 text-sm text-muted tabular-nums">
            {fmtSolValue(stats.data.lockedVaultSol)} SOL reserve + {fmtSolValue(stats.data.lockedVaultTokensValueSol)} SOL
            in bundle tokens
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          <span className="inline-flex items-center gap-1.5">
            <Bot className="size-3.5 text-cyan" aria-hidden /> Latest agent trades
          </span>
          <Link href="/agents" className="normal-case tracking-normal text-muted hover:text-lime">
            Rules →
          </Link>
        </div>
        <div className="mt-3 grid gap-1.5">
          {agents.isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)
          ) : recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-dim">
              No agent trades yet — agents only act when price leaves the EMA band.
            </div>
          ) : (
            recent.map((t) => (
              <Link
                key={t.signature}
                href={`/launch/${t.mint}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-black/30 px-3 py-2.5 text-sm transition hover:border-line-strong"
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  const platform = usePlatform();
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
    <section className="relative grid items-center gap-10 pt-8 pb-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:pt-14 lg:pb-14">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] py-1 pr-3 pl-1 text-xs font-medium text-muted">
          <span className="rounded-full bg-gradient-brand px-2 py-0.5 text-[11px] font-bold text-black">NEW</span>
          Bundle-locked launches on Solana
        </div>
        <h1 className="mt-5 text-[40px] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-[68px]">
          Launches that <span className="text-lime">can&apos;t be dumped</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted text-pretty sm:text-xl">
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
            <li key={text} className="flex items-start gap-3 text-[15px] text-muted">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.04]">
                <Icon className="size-3.5 text-lime" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.1 }}
      >
        <VaultPanel />
      </motion.div>
    </section>
  );
}
