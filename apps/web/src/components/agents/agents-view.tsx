"use client";

import { fmtPrice, lamportsToSol, shortAddr, timeAgo } from "@holdfast/sdk";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Bot,
  BrainCircuit,
  Gauge,
  Lock,
  Timer,
  TrendingDown,
  TrendingUp,
  Waves,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { explorerTx } from "@/lib/explorer";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useAgents, useAgentStatus, usePlatform } from "@/lib/queries";
import type { AgentDecision, AgentLaunchRow } from "@/lib/types";
import { cn } from "../ui/cn";
import { AddressLink, AnimatedNumber, TokenAvatar } from "../legacy/interactive";
import { Badge, Card, CardHeader, EmptyState, Meter, Skeleton } from "../legacy/primitives";

const pct = (bps: number) => `${bps / 100}%`;

function Rule({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="grid size-10 place-items-center rounded-xl border border-lime/20 bg-lime/10 text-lime shadow-[0_0_24px_-8px_rgb(198_255_61/0.6)]">
        {icon}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Rules() {
  const { data, isLoading } = usePlatform();
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    );
  }
  const p = data.params;
  const mins = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s}s`);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Rule icon={<TrendingDown className="size-4" aria-hidden />} title="Buys only on dips">
        Agents may buy only when spot is at least {pct(p.agentBandBps)} below the EMA <em>and</em> the fill is at or
        below the vault&apos;s average cost — or a buy-back paid from earlier sell proceeds at {pct(p.agentBandBps)} under
        the average sell price.
      </Rule>
      <Rule icon={<TrendingUp className="size-4" aria-hidden />} title="Sells only into rallies">
        Agents may sell only when spot is at least {pct(p.agentBandBps)} above the EMA <em>and</em> the fill is at least
        {" "}{pct(p.agentBandBps)} above the vault&apos;s average cost. The vault never realizes a loss.
      </Rule>
      <Rule icon={<Timer className="size-4" aria-hidden />} title="Rate-limited every window">
        Per {mins(p.agentWindowSecs)} window, agents can spend at most {pct(p.agentBuyBpsPerWindow)} of the vault&apos;s
        SOL and sell at most {pct(p.agentSellBpsPerWindow)} of its tokens. Budgets reset only when a window rolls.
      </Rule>
      <Rule icon={<Gauge className="size-4" aria-hidden />} title="Tiny footprint per trade">
        A single agent trade can move the price by at most {pct(p.agentMaxImpactBps)}. Agents pay no trading fee and
        always set slippage limits.
      </Rule>
      <Rule icon={<Lock className="size-4" aria-hidden />} title="Nothing can leave the vault">
        The program has no withdraw instruction. The agent key can only call agent_buy and agent_sell — proceeds stay
        inside the vault, forever.
      </Rule>
      <Rule icon={<Waves className="size-4" aria-hidden />} title="Slow, manipulation-resistant EMA">
        The reference price moves as ema += (spot − ema) · dt / (dt + {mins(p.emaPeriodSecs)}) on every trade, so one
        wick can&apos;t drag the band.
      </Rule>
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm sm:col-span-2 lg:col-span-3">
        <span className="flex flex-wrap items-center gap-2 text-muted">
          <Bot className="size-4 text-cyan" aria-hidden /> Agent authority
          <AddressLink address={data.agentAuthority} chars={6} />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {p.agentsPaused ? (
            <Badge tone="warn">
              <Ban className="size-3" aria-hidden /> Agents paused by admin
            </Badge>
          ) : (
            <Badge tone="up">Agents enabled</Badge>
          )}
          <span className="text-xs text-dim">Every launch freezes these limits into its own on-chain terms at creation.</span>
        </span>
      </div>
    </div>
  );
}

function BandMini({ r, wide }: { r: AgentLaunchRow; wide?: boolean }) {
  const lo = Math.min(r.bandLowSol, r.priceSol) * 0.97;
  const hi = Math.max(r.bandHighSol, r.priceSol) * 1.03;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  const zone = r.priceSol <= r.bandLowSol ? "buy zone" : r.priceSol >= r.bandHighSol ? "sell zone" : "in band";
  return (
    <div className={wide ? "w-full" : "w-40"}>
      <div className="relative h-1.5 rounded-full bg-white/[0.07]">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-lime/35" style={{ width: at(r.bandLowSol) }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-pink/40" style={{ left: at(r.bandHighSol) }} />
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-white"
          style={{ left: at(r.priceSol) }}
        />
      </div>
      <div className="mt-1.5 text-[11px] text-dim">
        {zone} · spot {fmtPrice(r.priceSol)}
      </div>
    </div>
  );
}

function LaunchWindows() {
  const { data, isLoading } = useAgents();
  const platform = usePlatform();
  const now = useNow(5_000);
  const windowSecs = platform.data?.params.agentWindowSecs ?? 0;
  const rows = data?.launches ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <>
            Live vaults<span className="hidden sm:inline">{" · window usage & bands"}</span>
          </>
        }
        icon={<Activity className="size-3.5 text-lime" aria-hidden />}
      />
      {isLoading ? (
        <div className="grid gap-2 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState art="vault" title="No live vaults yet">
          Vaults appear here as soon as a launch goes live.
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line border-t border-line md:hidden">
            {rows.map((r) => {
              const rolled = windowSecs > 0 && now >= r.windowStart + windowSecs;
              return (
                <li key={r.mint} className="grid gap-3 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/launch/${r.mint}`} className="group flex min-w-0 items-center gap-3">
                      <TokenAvatar src={r.image} symbol={r.symbol} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold group-hover:text-lime">{r.name}</span>
                        <span className="block text-xs text-dim">${r.symbol}</span>
                      </span>
                    </Link>
                    <div className="text-right text-[13px]">
                      <div className="font-medium">{fmtLamports(r.vaultSol)} SOL</div>
                      <div className="text-xs text-dim">{fmtTokens(r.vaultTokens)} tokens</div>
                    </div>
                  </div>
                  <BandMini r={r} wide />
                  <div className="grid grid-cols-2 gap-4 text-[11px] text-dim">
                    <div>
                      <Meter value={rolled ? 0 : pctOf(r.windowSolSpent, r.windowBuyCap)} tone="lime" label="Buy budget used" />
                      <div className="mt-1.5">
                        buy {rolled ? "0" : fmtLamports(r.windowSolSpent)} / {fmtLamports(r.windowBuyCap)} SOL
                      </div>
                    </div>
                    <div>
                      <Meter value={rolled ? 0 : pctOf(r.windowTokensSold, r.windowSellCap)} tone="pink" label="Sell budget used" />
                      <div className="mt-1.5">
                        sell {rolled ? "0" : fmtTokens(r.windowTokensSold)} / {fmtTokens(r.windowSellCap)}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Launch</th>
                  <th className="text-right">Vault</th>
                  <th>Price vs band</th>
                  <th>Buy budget</th>
                  <th>Sell budget</th>
                  <th className="text-right">Buys / sells</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rolled = windowSecs > 0 && now >= r.windowStart + windowSecs;
                  return (
                    <tr key={r.mint}>
                      <td>
                        <Link href={`/launch/${r.mint}`} className="group flex items-center gap-3">
                          <TokenAvatar src={r.image} symbol={r.symbol} size={32} />
                          <span>
                            <span className="block font-semibold group-hover:text-lime">{r.name}</span>
                            <span className="block text-xs text-dim">${r.symbol}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-right">
                        <div className="font-medium">{fmtLamports(r.vaultSol)} SOL</div>
                        <div className="text-xs text-dim">{fmtTokens(r.vaultTokens)} tokens</div>
                      </td>
                      <td>
                        <BandMini r={r} />
                      </td>
                      <td>
                        <div className="w-36">
                          <Meter value={rolled ? 0 : pctOf(r.windowSolSpent, r.windowBuyCap)} tone="lime" label="Buy budget used" />
                          <div className="mt-1.5 text-[11px] text-dim">
                            {rolled ? "0" : fmtLamports(r.windowSolSpent)} / {fmtLamports(r.windowBuyCap)} SOL
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="w-36">
                          <Meter
                            value={rolled ? 0 : pctOf(r.windowTokensSold, r.windowSellCap)}
                            tone="pink"
                            label="Sell budget used"
                          />
                          <div className="mt-1.5 text-[11px] text-dim">
                            {rolled ? "0" : fmtTokens(r.windowTokensSold)} / {fmtTokens(r.windowSellCap)}
                          </div>
                        </div>
                      </td>
                      <td className="text-right">
                        <span className="text-up">{r.agentBuys}</span> / <span className="text-down">{r.agentSells}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function RecentTrades() {
  const { data, isLoading } = useAgents();
  const now = useNow(5_000);
  const rows = data?.recent ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recent agent trades" icon={<Bot className="size-3.5 text-cyan" aria-hidden />} />
      {isLoading ? (
        <div className="grid gap-2 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState art="agent" title="No agent trades yet">
          Agents stay idle while prices sit inside their bands.
        </EmptyState>
      ) : (
        <div className="max-h-[480px] overflow-auto overscroll-contain border-t border-line">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Launch</th>
                <th>Side</th>
                <th className="text-right">SOL</th>
                <th className="hidden text-right sm:table-cell">Price</th>
                <th className="hidden text-right sm:table-cell">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.signature}:${t.mint}`}>
                  <td className="whitespace-nowrap text-dim">{timeAgo(t.timestamp, now)}</td>
                  <td>
                    <Link href={`/launch/${t.mint}`} className="font-semibold hover:text-lime">
                      ${t.symbol}
                    </Link>
                  </td>
                  <td>
                    <span className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap", t.isBuy ? "text-up" : "text-down")}>
                      {t.isBuy ? <ArrowDownRight className="size-3.5" aria-hidden /> : <ArrowUpRight className="size-3.5" aria-hidden />}
                      {t.isBuy ? "Bought dip" : "Sold rally"}
                    </span>
                  </td>
                  <td className="text-right">{fmtLamports(t.solAmount)}</td>
                  <td className="hidden text-right text-muted sm:table-cell">{fmtPrice(t.priceSol)}</td>
                  <td className="hidden text-right sm:table-cell">
                    <a href={explorerTx(t.signature)} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted hover:text-lime">
                      {shortAddr(t.signature, 4)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const ACTION_TONE: Record<AgentDecision["action"], "up" | "down" | "neutral" | "warn"> = {
  buy: "up",
  sell: "down",
  hold: "neutral",
  skip: "warn",
};

function AgentBrain() {
  const { data, isError, isLoading } = useAgentStatus();
  const now = useNow(1_000);
  const online = !!data && !isError;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <>
            Agent brain<span className="hidden sm:inline"> · live decisions</span>
          </>
        }
        icon={<BrainCircuit className="size-3.5 text-cyan" aria-hidden />}
        right={
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", online ? "text-up" : "text-dim")}>
            <span className={cn("size-1.5 rounded-full", online ? "animate-pulse-dot bg-up text-up" : "bg-dim")} />
            {online ? "online" : isLoading ? "connecting" : "offline"}
          </span>
        }
      />
      {online ? (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-line px-5 py-3 text-xs text-dim">
            <span>
              Signer <span className="font-mono text-muted">{shortAddr(data.agent, 5)}</span>
            </span>
            <span>
              Tick <span className="text-muted tabular-nums">#{data.tick}</span>
            </span>
            <span>
              Last tick{" "}
              <span className="text-muted tabular-nums">{data.lastTickAt ? timeAgo(data.lastTickAt, now) : "pending"}</span>
            </span>
            <span>
              Up since <span className="text-muted">{timeAgo(data.startedAt, now)}</span>
            </span>
            {data.dryRun ? <Badge tone="warn">dry run — no transactions sent</Badge> : null}
          </div>
          {data.decisions.length === 0 ? (
            <EmptyState art="agent" title="No live launches to watch" />
          ) : (
            <ul className="divide-y divide-line">
              {data.decisions.map((d) => (
                <li key={d.mint} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[140px_1fr_auto] sm:items-center">
                  <Link href={`/launch/${d.mint}`} className="flex items-center gap-2 font-semibold hover:text-lime">
                    <Badge tone={ACTION_TONE[d.action]} className="w-12 justify-center uppercase">
                      {d.action}
                    </Badge>
                    ${d.symbol ?? shortAddr(d.mint)}
                  </Link>
                  <div className="min-w-0 text-[13px]">
                    <div className="text-muted">{d.reason}</div>
                    <div className="mt-0.5 text-xs text-dim tabular-nums">
                      spot {fmtPrice(d.priceSol)} · EMA {fmtPrice(d.emaSol)} · band {fmtPrice(d.bandLowSol)}–{fmtPrice(d.bandHighSol)}
                      {d.amount
                        ? ` · ${d.action === "buy" ? `${fmtLamports(d.amount)} SOL` : `${fmtTokens(d.amount)} tokens`}`
                        : ""}
                    </div>
                    {d.error ? <div className="mt-0.5 text-xs text-down">{d.error}</div> : null}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-dim tabular-nums sm:justify-end">
                    {d.signature ? (
                      <a href={explorerTx(d.signature)} target="_blank" rel="noreferrer" className="font-mono text-lime hover:underline">
                        tx {shortAddr(d.signature, 4)}
                      </a>
                    ) : null}
                    {timeAgo(d.at, now)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <EmptyState art={isLoading ? "agent" : "offline"} title={isLoading ? "Connecting to the agent…" : "Agent offline"}>
          The agent service isn&apos;t reachable right now. That changes nothing on-chain: vaults stay locked and every
          limit above is enforced by the program.
        </EmptyState>
      )}
    </Card>
  );
}

function Totals() {
  const { data } = useAgents();
  const stats = [
    { label: "Dip buys", value: data?.totals.buys ?? null, fmt: (n: number) => Math.round(n).toString(), icon: TrendingDown },
    { label: "Rally sells", value: data?.totals.sells ?? null, fmt: (n: number) => Math.round(n).toString(), icon: TrendingUp },
    { label: "SOL spent buying", value: data ? lamportsToSol(data.totals.solSpent) : null, fmt: fmtSolValue, icon: ArrowDownRight },
    { label: "SOL from selling", value: data ? lamportsToSol(data.totals.solReceived) : null, fmt: fmtSolValue, icon: ArrowUpRight },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map(({ label, value, fmt, icon: Icon }) => (
        <div key={label} className="card p-4 sm:p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-dim">
            <Icon className="size-3.5" aria-hidden /> {label}
          </div>
          <div className="mt-1.5 text-2xl font-semibold tracking-tight">
            {value === null ? <Skeleton className="h-7 w-16" /> : <AnimatedNumber value={value} format={fmt} />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentsView() {
  return (
    <div className="grid gap-10">
      <section aria-labelledby="rules-heading">
        <div className="type-eyebrow text-dim">On-chain limits</div>
        <h2 id="rules-heading" className="type-title mt-2 mb-5 text-2xl sm:text-3xl">
          The rules, enforced by the program
        </h2>
        <Rules />
      </section>
      <section className="grid gap-5" aria-labelledby="activity-heading">
        <div>
          <div className="type-eyebrow text-dim">Live</div>
          <h2 id="activity-heading" className="type-title mt-2 text-2xl sm:text-3xl">
            Activity
          </h2>
        </div>
        <Totals />
        <AgentBrain />
        <LaunchWindows />
        <RecentTrades />
      </section>
    </div>
  );
}
