"use client";

import { fmtPrice } from "@moshsol/sdk";
import { Bot, Loader2, SearchX } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { fmtLamports, fmtSolValue } from "@/lib/format";
import { useMediaQuery, useNow } from "@/lib/hooks";
import { phaseOf, type Phase } from "@/lib/launch";
import { useLaunch } from "@/lib/queries";
import { agentZones } from "@moshsol/sdk";
import type { LaunchSummary } from "@/lib/types";
import { ButtonLink } from "../ui/button";
import { Segmented } from "../ui/interactive";
import { Card, EmptyState, Skeleton, Stat } from "../ui/primitives";
import { ChangeText } from "../ui/status";
import { LaunchHeader } from "./launch-header";
import { PositionCard } from "./position-card";
import { PriceChart } from "./price-chart";
import { BundleNowCard, DepositPanel, RaiseActions, RaiseHero, RefundPanel } from "./raise-panels";
import { AgentFeed, BackersTable, DepositsFeed, HoldersTable, TradesTable } from "./tables";
import { TradePanel } from "./trade-panel";
import { VaultCard } from "./vault-card";
import { VerifyCard } from "./verify-card";

function KeyStats({ launch: l }: { launch: LaunchSummary }) {
  return (
    <Card className="grid grid-cols-3 gap-x-4 gap-y-4 p-4 sm:p-5 lg:grid-cols-6">
      <Stat label="Price" value={fmtPrice(l.priceSol)} sub="SOL / token" />
      <Stat label="Market cap" value={`${fmtSolValue(l.marketCapSol)} SOL`} sub="fully diluted" />
      <Stat label="24h volume" value={`${fmtSolValue(l.volume24hSol)} SOL`} sub={`${l.tradeCount} trades total`} />
      <Stat label="24h change" value={<ChangeText value={l.change24h} />} />
      <Stat label="Holders" value={l.holders.toLocaleString("en-US")} />
      <Stat label="Curve SOL" value={`${fmtLamports(l.realSol)} SOL`} sub="never withdrawable" />
    </Card>
  );
}

function TabbedCard<T extends string>({ tabs, initial }: { tabs: { value: T; label: ReactNode; render: () => ReactNode }[]; initial: T }) {
  const [tab, setTab] = useState<T>(initial);
  const current = tabs.find((t) => t.value === tab) ?? tabs[0];
  return (
    <Card className="overflow-hidden">
      <div className="no-scrollbar overflow-x-auto border-b border-line px-4 py-3 sm:px-5">
        <Segmented size="sm" value={tab} onChange={setTab} options={tabs.map((t) => ({ value: t.value, label: t.label }))} />
      </div>
      {current.render()}
    </Card>
  );
}

function LiveTabs({ launch: l }: { launch: LaunchSummary }) {
  return (
    <TabbedCard
      initial="trades"
      tabs={[
        { value: "trades", label: "Trades", render: () => <TradesTable launch={l} /> },
        {
          value: "agents",
          label: (
            <>
              <Bot className="size-3.5 text-cyan" aria-hidden /> Agent activity
            </>
          ),
          render: () => <AgentFeed launch={l} />,
        },
        { value: "holders", label: `Holders · ${l.holders}`, render: () => <HoldersTable launch={l} /> },
        { value: "backers", label: `Backers · ${l.backerCount}`, render: () => <BackersTable launch={l} /> },
      ]}
    />
  );
}

function RaiseTabs({ launch: l }: { launch: LaunchSummary }) {
  return (
    <TabbedCard
      initial="deposits"
      tabs={[
        { value: "deposits", label: "Deposits", render: () => <DepositsFeed launch={l} /> },
        { value: "backers", label: `Backers · ${l.backerCount}`, render: () => <BackersTable launch={l} /> },
      ]}
    />
  );
}

function TwoColumn({ main, side, tail }: { main: ReactNode; side: ReactNode; tail: ReactNode }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
        {main}
        {desktop ? tail : null}
      </div>
      <aside className="grid min-w-0 gap-5 [&>*]:min-w-0">{side}</aside>
      {desktop ? null : <div className="grid min-w-0 gap-5 [&>*]:min-w-0">{tail}</div>}
    </div>
  );
}

function LiveLayout({ launch: l }: { launch: LaunchSummary }) {
  const now = useNow(5_000);
  const zones = useMemo(() => agentZones(l, now), [l, now]);
  return (
    <TwoColumn
      main={
        <>
          <KeyStats launch={l} />
          <PriceChart launch={l} bandLow={zones.buyBelow} bandHigh={zones.sellAbove} />
        </>
      }
      side={
        <>
          <TradePanel launch={l} />
          <PositionCard launch={l} />
          <VaultCard launch={l} zones={zones} />
        </>
      }
      tail={
        <>
          <LiveTabs launch={l} />
          <VerifyCard launch={l} />
        </>
      }
    />
  );
}

function RaiseLayout({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const ended = phase === "failed" || phase === "refunding";
  return (
    <TwoColumn
      main={
        <>
          <RaiseHero launch={l} phase={phase} />
          {ended ? null : <BundleNowCard launch={l} />}
        </>
      }
      side={
        <>
          {ended ? <RefundPanel launch={l} phase={phase} /> : <DepositPanel launch={l} phase={phase} />}
          <RaiseActions launch={l} phase={phase} />
          <VerifyCard launch={l} />
        </>
      }
      tail={ended ? <Card className="overflow-hidden"><BackersTable launch={l} /></Card> : <RaiseTabs launch={l} />}
    />
  );
}

function LaunchSkeleton() {
  return (
    <div>
      <div className="flex gap-4 pb-6">
        <Skeleton className="size-[72px] rounded-2xl" />
        <div className="flex-1 space-y-3 pt-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-5">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-[420px] w-full rounded-2xl" />
        </div>
        <div className="grid content-start gap-5">
          <Skeleton className="h-[420px] w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function LaunchView({ mint }: { mint: string }) {
  const { data, error, isLoading } = useLaunch(mint);
  const now = useNow();
  const [openedAt] = useState(() => Math.floor(Date.now() / 1000));

  if (isLoading && !data) return <LaunchSkeleton />;
  if (!data) {
    const notFound = error instanceof ApiError && error.status === 404;
    if (notFound && now - openedAt < 30) {
      return (
        <Card>
          <EmptyState icon={<Loader2 className="size-5 animate-spin" aria-hidden />} title="Indexing this launch…">
            New launches appear a moment after their transaction confirms.
          </EmptyState>
        </Card>
      );
    }
    return (
      <Card>
        <EmptyState
          icon={<SearchX className="size-5" aria-hidden />}
          title={notFound ? "Launch not found" : "Couldn't load this launch"}
          action={
            <ButtonLink href="/" variant="secondary">
              Back to explore
            </ButtonLink>
          }
        >
          {notFound
            ? "No moshsol launch exists for this mint on this cluster."
            : error instanceof Error
              ? error.message
              : "The indexer is unreachable."}
        </EmptyState>
      </Card>
    );
  }

  const phase = phaseOf(data, now);
  return (
    <div className="pb-8">
      <LaunchHeader launch={data} phase={phase} />
      {phase === "live" ? <LiveLayout launch={data} /> : <RaiseLayout launch={data} phase={phase} />}
    </div>
  );
}
