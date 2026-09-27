"use client";

import { agentZones, fmtPrice, lamportsToSol } from "@holdfast/sdk";
import { Bot, Loader2, SearchX } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { fmtSolValue } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { phaseOf, type Phase } from "@/lib/launch";
import { useLaunch } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { Button, ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { AnimatedNumber, Segmented, TokenAvatar } from "../ui/interactive";
import { Card, EmptyState, Stat } from "../ui/primitives";
import { ChangeText } from "../ui/status";
import { LaunchHeader } from "./launch-header";
import { LaunchSkeleton } from "./launch-skeleton";
import { PositionCard } from "./position-card";
import { PriceChart } from "./price-chart";
import { BundleNowCard, DepositPanel, RaiseActions, RaiseHero, RefundPanel } from "./raise-panels";
import { AgentFeed, BackersTable, DepositsFeed, HoldersTable, TradesTable } from "./tables";
import { TradePanel, type Side } from "./trade-panel";
import { VaultCard } from "./vault-card";
import { VerifyCard } from "./verify-card";

function KeyStats({ launch: l }: { launch: LaunchSummary }) {
  return (
    <Card className="grid grid-cols-3 gap-x-4 gap-y-4 px-4 py-4 sm:px-5 lg:grid-cols-6">
      <Stat
        label="Market cap"
        value={
          <>
            <AnimatedNumber value={l.marketCapSol} format={fmtSolValue} flash /> SOL
          </>
        }
      />
      <Stat
        label="24h volume"
        value={
          <>
            <AnimatedNumber value={l.volume24hSol} format={fmtSolValue} /> SOL
          </>
        }
      />
      <Stat label="Liquidity" value={`${fmtSolValue(lamportsToSol(l.realSol))} SOL`} sub="can't be pulled" />
      <Stat label="Holders" value={l.holders.toLocaleString("en-US")} />
      <Stat label="Backers" value={l.backerCount.toLocaleString("en-US")} />
      {/* The program counts the launch's bundle buy in tradeCount; it isn't a market trade. */}
      <Stat
        label="Trades"
        value={Math.max(0, l.tradeCount - (l.launchedAt > 0 ? 1 : 0)).toLocaleString("en-US")}
        sub={`${l.agentBuys + l.agentSells} by agents`}
      />
    </Card>
  );
}

function TabbedCard<T extends string>({
  tabs,
  initial,
  label,
}: {
  tabs: { value: T; label: ReactNode; render: () => ReactNode }[];
  initial: T;
  label: string;
}) {
  const [tab, setTab] = useState<T>(initial);
  const current = tabs.find((t) => t.value === tab) ?? tabs[0];
  return (
    <Card className="overflow-hidden">
      <div className="no-scrollbar overflow-x-auto border-b border-line px-3 py-3 sm:px-4">
        <Segmented
          size="sm"
          ariaLabel={label}
          value={tab}
          onChange={setTab}
          options={tabs.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>
      <div role="tabpanel">{current.render()}</div>
    </Card>
  );
}

function LiveTabs({ launch: l }: { launch: LaunchSummary }) {
  return (
    <TabbedCard
      label="Launch activity"
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
      label="Raise activity"
      initial="deposits"
      tabs={[
        { value: "deposits", label: "Deposits", render: () => <DepositsFeed launch={l} /> },
        { value: "backers", label: `Backers · ${l.backerCount}`, render: () => <BackersTable launch={l} /> },
      ]}
    />
  );
}

/**
 * Desktop: `main` and `tail` stack in the left column while `side` spans both rows on the right
 * (the `1fr` second row absorbs the rail's extra height, so `tail` starts right under `main`).
 * Mobile: one column in source order — main, side, tail.
 */
function Columns({ main, side, tail }: { main: ReactNode; side: ReactNode; tail: ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-start-1 [&>*]:min-w-0">{main}</div>
      <aside className="grid min-w-0 gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 [&>*]:min-w-0">{side}</aside>
      <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-start-2 [&>*]:min-w-0">{tail}</div>
    </div>
  );
}

/** Phone-only bar pinned to the bottom; hides while the trade panel itself is on screen. */
function MobileTradeBar({ launch: l, onPick }: { launch: LaunchSummary; onPick: (s: Side) => void }) {
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const panel = document.getElementById("trade");
    if (!panel) return;
    const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(panel);
    return () => io.disconnect();
  }, []);
  return (
    <div
      inert={panelVisible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl transition-transform duration-200 lg:hidden",
        panelVisible && "translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <TokenAvatar src={l.image} symbol={l.symbol} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-dim">${l.symbol}</div>
          <div className="flex items-baseline gap-2 text-[15px] font-semibold">
            <AnimatedNumber value={l.priceSol} format={fmtPrice} flash />
            <ChangeText value={l.change24h} className="text-xs font-medium" />
          </div>
        </div>
        <Button variant="up" size="lg" className="w-[84px]" onClick={() => onPick("buy")}>
          Buy
        </Button>
        <Button variant="down" size="lg" className="w-[84px]" onClick={() => onPick("sell")}>
          Sell
        </Button>
      </div>
    </div>
  );
}

function LiveLayout({ launch: l }: { launch: LaunchSummary }) {
  const now = useNow(5_000);
  const zones = useMemo(() => agentZones(l, now), [l, now]);
  const [side, setSide] = useState<Side>("buy");
  const reduce = useReducedMotion();
  const pick = (s: Side) => {
    setSide(s);
    document.getElementById("trade")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Focus after the scroll settles so the on-screen keyboard doesn't fight it.
    window.setTimeout(() => document.getElementById("trade-amount")?.focus({ preventScroll: true }), reduce ? 0 : 450);
  };
  return (
    <>
      <Columns
        main={
          <>
            <PriceChart launch={l} zones={zones} />
            <KeyStats launch={l} />
          </>
        }
        side={
          <>
            <TradePanel launch={l} side={side} onSideChange={setSide} />
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
      <MobileTradeBar launch={l} onPick={pick} />
    </>
  );
}

function RaiseLayout({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const ended = phase === "failed" || phase === "refunding";
  return (
    <Columns
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
      tail={
        ended ? (
          <Card className="overflow-hidden">
            <BackersTable launch={l} />
          </Card>
        ) : (
          <RaiseTabs launch={l} />
        )
      }
    />
  );
}

export function LaunchView({ mint }: { mint: string }) {
  const { data, error, isLoading } = useLaunch(mint);
  const now = useNow();
  const [openedAt] = useState(() => Math.floor(Date.now() / 1000));

  if (isLoading && !data) return <LaunchSkeleton />;
  if (!data) {
    const notFound = error instanceof ApiError && error.status === 404;
    if (notFound && now - openedAt < 60) {
      return (
        <Card className="mx-auto mt-6 max-w-xl">
          <EmptyState icon={<Loader2 className="size-5 animate-spin" aria-hidden />} title="Indexing this launch…">
            It&apos;s on-chain; the page fills in a moment after the indexer picks it up.
          </EmptyState>
        </Card>
      );
    }
    return (
      <Card className="mx-auto mt-6 max-w-xl">
        <EmptyState
          icon={<SearchX className="size-5" aria-hidden />}
          title={notFound ? "Launch not indexed" : "Couldn't load this launch"}
          action={
            <ButtonLink href="/" variant="secondary">
              Back to explore
            </ButtonLink>
          }
        >
          {notFound
            ? "The launch exists on-chain but the indexer hasn't picked it up yet. Try again shortly."
            : error instanceof Error
              ? error.message
              : "The indexer is unreachable."}
        </EmptyState>
      </Card>
    );
  }

  const phase = phaseOf(data, now);
  return (
    <div className={cn("pb-8", phase === "live" && "pb-28 lg:pb-8")}>
      <LaunchHeader launch={data} phase={phase} />
      {phase === "live" ? (
        <LiveLayout key={data.mint} launch={data} />
      ) : (
        <RaiseLayout key={data.mint} launch={data} phase={phase} />
      )}
    </div>
  );
}
