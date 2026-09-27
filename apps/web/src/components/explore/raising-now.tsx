"use client";

import { ArrowRight, CheckCircle2, Clock, Coins, Rocket, ShieldCheck, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { fmtLamports, pctOf } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { usePlatform } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { RaiseBar } from "../launch/raise-bar";
import { cn } from "../ui/cn";
import { Countdown, TokenAvatar } from "../legacy/interactive";
import { PhasePill } from "../legacy/status";

/** Horizontal raise card: identity on the left, a big progress bar and the call to action on the right. */
function RaiseSpotlight({
  launch: l,
  now,
  wide,
  className,
}: {
  launch: LaunchSummary;
  now: number;
  wide: boolean;
  className?: string;
}) {
  const phase = phaseOf(l, now);
  const funded = pctOf(l.raised, l.raiseMax);
  const minAt = pctOf(l.raiseMin, l.raiseMax);
  const minMet = BigInt(l.raised) >= BigInt(l.raiseMin);
  return (
    <Link
      href={`/launch/${l.mint}`}
      className={cn(
        "card card-hover group @container relative flex shrink-0 snap-start flex-col overflow-hidden p-5 sm:p-6 md:w-auto",
        wide ? "w-full lg:col-span-2" : "w-[min(86vw,400px)]",
        className,
      )}
    >
      <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-violet/15 blur-3xl" />
      <div className="relative grid gap-5 @xl:grid-cols-[1fr_1.35fr] @xl:items-center @xl:gap-8">
        <div className="min-w-0">
          <div className="flex items-start gap-3.5">
            <TokenAvatar src={l.image} symbol={l.symbol} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-lg leading-tight font-semibold tracking-tight transition-colors group-hover:text-lime">
                    {l.name}
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-muted">${l.symbol}</div>
                </div>
                <PhasePill phase={phase} className="@xl:hidden" />
              </div>
            </div>
          </div>
          {l.description ? (
            <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted @max-xl:hidden">{l.description}</p>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex items-end justify-between gap-3">
            <div className="text-2xl font-semibold tracking-tight tabular-nums">
              {fmtLamports(l.raised)}
              <span className="ml-1.5 text-sm font-medium tracking-normal text-dim">/ {fmtLamports(l.raiseMax)} SOL</span>
            </div>
            <div className="text-right text-xs text-muted tabular-nums">
              <span className="font-semibold text-ink">{funded < 1 && funded > 0 ? "<1" : Math.floor(funded)}%</span> funded
            </div>
          </div>
          <RaiseBar raised={l.raised} raiseMin={l.raiseMin} raiseMax={l.raiseMax} size="lg" className="mt-3" />
          <div className="relative mt-2 h-4 text-[11px] text-dim tabular-nums">
            {minAt > 10 && minAt < 80 ? (
              <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${minAt}%` }}>
                {minMet ? "min met ✓" : `min ${fmtLamports(l.raiseMin)}`}
              </span>
            ) : (
              <span>min {fmtLamports(l.raiseMin)}</span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
              <Clock className="size-4 text-dim" aria-hidden />
              {phase === "raising" ? (
                <>
                  <Countdown to={l.raiseDeadline} className="font-semibold text-ink" /> left
                </>
              ) : (
                <span className="font-semibold text-lime">Ready to launch</span>
              )}
            </span>
            <span className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-lime px-4 text-sm font-semibold text-black shadow-[0_8px_30px_-10px_rgb(198_255_61/0.6)] transition group-hover:bg-lime-soft">
              {phase === "raising" ? "Back it" : "Launch it"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </div>
        </div>
      </div>
      <dl className="relative mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-xs @xl:mt-auto @xl:grid-cols-4">
        {[
          { icon: Users, k: "Backers", v: String(l.backerCount) },
          {
            icon: CheckCircle2,
            k: "Minimum",
            v: minMet ? "met" : `${fmtLamports(BigInt(l.raiseMin) - BigInt(l.raised))} SOL to go`,
          },
          { icon: ShieldCheck, k: "Bundle", v: `≤ ${l.bundleSupplyBps / 100}% of supply` },
          { icon: Coins, k: "Per wallet", v: BigInt(l.maxPerWallet) > 0n ? `${fmtLamports(l.maxPerWallet)} SOL max` : "No cap" },
        ].map((s) => (
          <div key={s.k} className="flex min-w-0 items-start gap-2">
            <s.icon className="mt-0.5 size-3.5 shrink-0 text-dim" aria-hidden />
            <div className="min-w-0">
              <dt className="text-dim">{s.k}</dt>
              <dd className={cn("mt-0.5 truncate text-[13px] font-semibold tabular-nums", s.k === "Minimum" && minMet ? "text-lime" : "text-ink")}>
                {s.v}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </Link>
  );
}

/** Fills the row when only one or two raises are open: what backing actually gets you. */
function RaiseExplainer({ className }: { className?: string }) {
  const platform = usePlatform();
  const p = platform.data?.params;
  const backerPct = p ? `${(p.tradeFeeBps * p.backerFeeShareBps) / 1_000_000}%` : "a share";
  const steps = [
    { icon: Coins, title: "Back it", body: "Deposit SOL before the deadline. Deposits are clipped to the cap so nobody overpays." },
    { icon: Rocket, title: "It launches", body: "The pool buys the bundle before any public trade — then it's locked in the vault." },
    { icon: Sparkles, title: "You earn", body: `Backers split ${backerPct} of every trade, pro-rata, forever.` },
  ];
  return (
    <div className={cn("card relative hidden shrink-0 overflow-hidden p-5 sm:p-6 md:w-auto", className)}>
      <div className="pointer-events-none absolute -right-16 -bottom-20 size-56 rounded-full bg-lime/10 blur-3xl" />
      <div className="type-eyebrow text-dim">How backing works</div>
      <ol className="relative mt-4 grid gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.04] text-lime">
              <s.icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                <span className="mr-1.5 font-mono text-xs text-dim">0{i + 1}</span>
                {s.title}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="relative mt-4 border-t border-line pt-3 text-xs text-dim">Minimum missed or raise cancelled → 100% refund.</p>
    </div>
  );
}

export function RaisingNow({ raises, now, onSeeAll }: { raises: LaunchSummary[]; now: number; onSeeAll: () => void }) {
  if (raises.length === 0) return null;
  const few = raises.length <= 2;
  return (
    <section className="mt-14" aria-labelledby="raising-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="type-eyebrow flex items-center gap-2 text-[#c2a6ff]">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-violet text-violet" /> Raising now
          </div>
          <h2 id="raising-heading" className="type-title mt-2 text-2xl sm:text-[28px]">
            Back a bundle before it locks
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-muted">
            Deposits buy the launch bundle before anyone can trade. Miss the minimum and everyone refunds in full.
          </p>
        </div>
        {!few ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted transition hover:bg-white/[0.05] hover:text-ink"
          >
            See all {raises.length} <ArrowRight className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="no-scrollbar -mx-4 mt-5 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pt-1 pb-3 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
        {/* Phones swipe through up to six; wider screens show a row (two, then three) and link to the full tab. */}
        {raises.slice(0, 6).map((l, i) => (
          <RaiseSpotlight
            key={l.mint}
            launch={l}
            now={now}
            wide={raises.length === 1}
            className={i === 2 ? "md:hidden lg:flex" : i > 2 ? "md:hidden" : undefined}
          />
        ))}
        {/* Fills the row beside one raise (from md) or two (from lg). */}
        {few ? <RaiseExplainer className={raises.length === 1 ? "md:block" : "lg:block"} /> : null}
      </div>
    </section>
  );
}
