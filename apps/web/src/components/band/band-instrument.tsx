"use client";

import { shortAddr, timeAgo, TOTAL_SUPPLY } from "@holdfast/sdk";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { fmtChange, fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { launchHref, launchId } from "@/lib/launch";
import { useAgentStatus, useCandles, useLaunch, useTrades } from "@/lib/queries";
import { clearsHeadline } from "@/lib/thresholds";
import type { LaunchSummary } from "@/lib/types";
import { Button, ButtonLink } from "../ui/button";
import { StatusChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { NumberTicker } from "../ui/number-ticker";
import { Skeleton } from "../ui/skeleton";
import { TokenAvatar } from "../ui/token-avatar";
import { AgentSimulator } from "./agent-simulator";
import { BandChart } from "./band-chart";
import {
  agentMarkers,
  bandSeries,
  candlesSince,
  decisionHeadline,
  describeAgentTrade,
  HERO_TF,
  pctFromBps,
} from "./model";
import { agentTradesQuery } from "./queries";
import { useHeroPick } from "./use-hero-pick";

const CHART_HEIGHT = { desktop: 340, mobile: 240 };

/**
 * The hero's Band instrument (§4.2 §1): the trending launch drawn live — price, on-chain EMA, the
 * agent band from its frozen terms and vault-agent trades. With fewer than 12 candles in the last
 * 24h (king, then the most-traded live launch) no line is drawn; the agent simulator takes its place.
 */
export function BandInstrument() {
  const { nowSec, seed, chartLaunch, deciding, loading, failed, retry, retrying } = useHeroPick();
  if (!seed) {
    if (failed) {
      return (
        <Frame>
          <ErrorState onRetry={retry} retrying={retrying}>
            Couldn&rsquo;t load launches. Indexer unreachable.
          </ErrorState>
        </Frame>
      );
    }
    if (loading) return <InstrumentSkeleton />;
    return (
      <Frame>
        <EmptyState action={<ButtonLink href="/create" size="sm" variant="secondary">Launch a token</ButtonLink>}>
          No live launch yet. The first one draws here.
        </EmptyState>
      </Frame>
    );
  }
  if (deciding) return <InstrumentSkeleton />;
  return <Instrument id={launchId(seed)} initial={seed} chart={chartLaunch !== null} nowSec={nowSec} />;
}

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-md border border-line bg-surface", className)}>{children}</div>;
}

function InstrumentSkeleton() {
  return (
    <Frame>
      <div className="flex items-center gap-3 border-b border-line p-4">
        <Skeleton className="size-9 rounded-sm" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="m-4 h-[208px] md:h-[308px]" />
      <div className="grid grid-cols-3 border-t border-line">
        {[0, 1, 2].map((i) => (
          <div key={i} className="p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-5 w-24" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Instrument({ id, initial, chart, nowSec }: { id: string; initial: LaunchSummary; chart: boolean; nowSec: number }) {
  const launchQ = useLaunch(id);
  const l = launchQ.data ?? initial;
  const href = launchHref(l);
  const up = (l.change24h ?? 0) >= 0;

  return (
    <Frame>
      <Link
        href={href}
        className="flex items-center gap-3 border-b border-line px-4 py-3 transition-colors hover:bg-raised md:px-5"
        aria-label={`Open ${l.name} ($${l.symbol})`}
      >
        <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={36} />
        <div className="min-w-0 flex-1">
          <p className="h3 truncate text-ink">
            {l.name} <span className="text-ink-3">${l.symbol}</span>
          </p>
          <p className="mono flex items-center gap-2 text-ink-3">
            {shortAddr(l.mint)}
            <StatusChip status="live" />
          </p>
        </div>
        <div className="shrink-0 text-right">
          <NumberTicker value={l.marketCapSol} format={(v) => `${fmtSolValue(v)} SOL`} roll className="num-l text-ink" />
          <p className="micro num text-ink-3">
            {l.change24h === null ? null : (
              <span className={up ? "text-up" : "text-down"}>{fmtChange(l.change24h)} </span>
            )}
            {l.change24h === null ? "mcap" : "24h mcap"}
          </p>
        </div>
      </Link>
      {chart ? <ChartArea launch={l} nowSec={nowSec} href={href} /> : <AgentSimulator launch={l} compact />}
      <Footer launch={l} href={href} />
    </Frame>
  );
}

function ChartArea({ launch: l, nowSec, href }: { launch: LaunchSummary; nowSec: number; href: string }) {
  const [drawKey, setDrawKey] = useState(0);
  const candles = useCandles(launchId(l), HERO_TF);
  const trades = useTrades(launchId(l), 200);
  const agent = useQuery(agentTradesQuery(launchId(l)));
  const points = bandSeries({
    candles: candlesSince(candles.data?.candles, nowSec),
    tf: HERO_TF,
    trades: trades.data?.trades ?? [],
    emaPeriodSecs: l.terms.emaPeriodSecs,
    now: { nowSec, launch: l },
  });
  const t0 = points[0]?.time ?? 0;
  const markers = agentMarkers(agent.data ?? [], l.virtualSol).filter((m) => m.time >= t0);
  const latest = markers[markers.length - 1];
  return (
    <div className="relative px-2 pt-3 md:px-3">
      <Link href={href} aria-label={`${l.name} price, EMA and agent band — open the token page`} className="block">
        <BandChart
          points={points}
          bandBps={l.terms.agentBandBps}
          markers={markers}
          callout={latest ? describeAgentTrade(latest, l.symbol) : null}
          height={CHART_HEIGHT.desktop}
          drawKey={drawKey}
          className="hidden md:block"
        />
        <BandChart
          points={points}
          bandBps={l.terms.agentBandBps}
          markers={markers}
          callout={latest ? describeAgentTrade(latest, l.symbol) : null}
          height={CHART_HEIGHT.mobile}
          drawKey={drawKey}
          className="md:hidden"
        />
      </Link>
      <div className="absolute right-3 top-2">
        <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" strokeWidth={1.5} />} onClick={() => setDrawKey((k) => k + 1)}>
          Replay
        </Button>
      </div>
    </div>
  );
}

function Footer({ launch: l, href }: { launch: LaunchSummary; href: string }) {
  const agent = useAgentStatus();
  const decision = agent.data?.decisions.find((d) => d.mint === l.mint);
  const nowSec = useNow(5_000);
  const backerFees = Number(BigInt(l.backerFeesAccrued)) / 1e9;
  const supplyPct = pctOf(l.vaultTokens, TOTAL_SUPPLY);

  let agentText: ReactNode;
  if (agent.isError) agentText = <span className="text-warn">Agent status unavailable</span>;
  else if (!agent.data) agentText = <Skeleton className="h-5 w-32" />;
  else if (!decision) agentText = <span className="text-ink-2">No decision for ${l.symbol} yet</span>;
  else
    agentText = (
      <span className="text-accent-ink" title={decision.reason}>
        {decisionHeadline(decision)}
        <span className="text-ink-3"> · {timeAgo(decision.at, nowSec)}</span>
      </span>
    );

  return (
    <Link href={href} className="grid border-t border-line transition-colors hover:bg-raised md:grid-cols-3">
      <Cell label="Held in vault">
        <span className="num text-ink">
          {fmtTokens(l.vaultTokens)} <span className="text-ink-3">+ {fmtLamports(l.vaultSol)} SOL</span>
        </span>
        <span className="micro num block text-ink-3">{supplyPct.toFixed(2)}% of supply</span>
      </Cell>
      <Cell label="Vault agent" className="md:border-x md:border-line">
        <div className="truncate">{agentText}</div>
      </Cell>
      {clearsHeadline("backerFeesSol", backerFees) ? (
        <Cell label="Backers earned">
          <span className="num text-ink">{fmtSolValue(backerFees)} SOL</span>
        </Cell>
      ) : (
        <Cell label="Backer share of fees">
          <span className="num text-ink">{pctFromBps(l.terms.backerFeeShareBps)}</span>
        </Cell>
      )}
    </Link>
  );
}

function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 border-b border-line px-4 py-3 last:border-b-0 md:border-b-0 md:px-5 md:py-4", className)}>
      <p className="label text-ink-3">{label}</p>
      <div className="ui mt-1.5">{children}</div>
    </div>
  );
}
