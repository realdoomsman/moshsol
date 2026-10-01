"use client";

import { agentZones, type LaunchStatus } from "@holdfast/sdk";
import { useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { useMediaQuery, useNow } from "@/lib/hooks";
import { phaseOf, type Phase } from "@/lib/launch";
import { useLaunch } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { RefundGlyph } from "../brand/glyphs";
import { ClampLoader } from "../brand/clamp-lock-animation";
import { Button, ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { Activity, type ActivityTab } from "./activity";
import { BackPanel, LaunchPanel, RefundPanel, useRefundReason } from "./back-panel";
import { CreatorCard } from "./creator-card";
import { PositionPanel } from "./position-panel";
import { PriceChart } from "./price-chart";
import { RaisePanel } from "./raise-panel";
import { useLaunchRoles } from "./shared";
import { StatStrip } from "./stat-strip";
import { TokenHeader } from "./token-header";
import { TokenInfo } from "./token-info";
import { TradePanel, type Side } from "./trade-panel";
import { NO_FILTERS, type TradeFilters } from "./trades-tab";
import { VaultCard } from "./vault-card";
import { VerifyCard } from "./verify-card";
import { AdminWithdrawals, WindDownCard } from "./wind-down";

type Section = "chart" | "trades" | "vault" | "thread" | "holders" | "more";
const SECTIONS: { value: Section; label: string }[] = [
  { value: "chart", label: "Chart" },
  { value: "trades", label: "Trades" },
  { value: "vault", label: "Vault" },
  { value: "thread", label: "Thread" },
  { value: "holders", label: "Holders" },
  { value: "more", label: "More" },
];
const DESKTOP_TABS: ActivityTab[] = ["trades", "thread", "holders", "backers", "traders", "agent"];
const MORE_TABS: ActivityTab[] = ["backers", "traders", "agent"];
const RAISE_TABS: ActivityTab[] = ["deposits", "backers", "thread"];
const noop = () => undefined;

/**
 * Desktop: `main` and `tail` stack in the left column while `rail` (360px) spans both rows; the
 * `1fr` row absorbs the rail's extra height so `tail` starts right under `main`. Panels sit 12px
 * apart, columns 16px (§3.6). Below 1024px: one column in source order — main, rail, tail.
 */
function Columns({ main, rail, tail }: { main: ReactNode; rail: ReactNode; tail: ReactNode }) {
  // Phones: the wrappers dissolve (`contents`) so hidden sections leave no empty gaps.
  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:gap-x-4 [&>*>*]:min-w-0">
      <div className="min-w-0 gap-3 max-lg:contents lg:col-start-1 lg:row-start-1 lg:grid">{main}</div>
      <aside className="min-w-0 gap-3 max-lg:contents lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid">{rail}</aside>
      <div className="min-w-0 gap-3 max-lg:contents lg:col-start-1 lg:row-start-2 lg:grid">{tail}</div>
    </div>
  );
}

/** Phone section switcher (§4.5 mobile): sticky under the app header, one section visible at a time. */
function SectionTabs({ value, onChange }: { value: Section; onChange: (s: Section) => void }) {
  return (
    <div className="sticky top-[52px] z-20 -mx-4 bg-paper px-4 py-2 md:top-14 md:-mx-6 md:px-6 lg:hidden">
      <div role="tablist" aria-label="Token sections" className="flex gap-0.5 rounded-sm bg-sunken p-0.5 ring-1 ring-line ring-inset">
        {SECTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            role="tab"
            aria-selected={value === s.value}
            onClick={() => {
              onChange(s.value);
              window.scrollTo({ top: 0 });
            }}
            className={cn(
              "small h-10 min-w-0 flex-auto rounded-[6px] px-2 whitespace-nowrap [font-weight:560] transition-colors",
              value === s.value ? "bg-raised text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Phone bottom bar (§4.5 mobile): 64px, above the app's tab bar below 768px and above the sticky
 * 32px status strip from 768px; opens the trade/back sheet.
 */
function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 flex h-16 items-center gap-2 border-t border-line bg-surface px-4 md:bottom-8 md:px-6 lg:hidden">
      {children}
    </div>
  );
}

/** Live and wound-down launches: chart, activity and the trade rail (read-only once wound down). */
function LiveLayout({ launch: l, justLaunched }: { launch: LaunchSummary; justLaunched: boolean }) {
  const now = useNow(5_000);
  const zones = useMemo(() => agentZones(l, now), [l, now]);
  const roles = useLaunchRoles(l);
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [section, setSection] = useState<Section>("chart");
  const [tab, setTab] = useState<ActivityTab>("trades");
  const [moreTab, setMoreTab] = useState<ActivityTab>("backers");
  const [filters, setFilters] = useState<TradeFilters>(NO_FILTERS);
  const [side, setSide] = useState<Side>("buy");
  const [sheet, setSheet] = useState(false);
  const woundDown = l.status === "woundDown";

  const reveal = () => requestAnimationFrame(() => document.getElementById("activity")?.scrollIntoView({ block: "start" }));
  const filterMaker = (wallet: string) => {
    setFilters({ ...NO_FILTERS, maker: wallet });
    setTab("trades");
    setSection("trades");
    reveal();
  };
  const openAgentLog = () => {
    setTab("agent");
    setMoreTab("agent");
    setSection("more");
    reveal();
  };
  /** Visible on phones only in these sections; always on desktop. */
  const shownIn = (...s: Section[]) => (s.includes(section) ? "" : "max-lg:hidden");
  const phoneTabs = section === "more" ? MORE_TABS : section === "trades" || section === "thread" || section === "holders" ? [section] : null;
  // Sections without the activity panel hide it with CSS; it keeps showing the desktop tab.
  const activityTabs = narrow && phoneTabs ? phoneTabs : DESKTOP_TABS;
  const activityTab = !narrow || !phoneTabs ? tab : section === "more" ? moreTab : phoneTabs[0];

  return (
    <div className="grid gap-3">
      {woundDown ? (
        <div role="status" className="body rounded-md bg-raised px-4 py-3 text-ink">
          This launch wound down. Trading has ended for good; the curve and vault SOL were credited to the backers, who claim
          it under Your position.
        </div>
      ) : null}
      <SectionTabs value={section} onChange={setSection} />
      <StatStrip launch={l} className="rounded-md border-x bg-surface max-lg:hidden" />
      <Columns
        main={
          <>
            <PriceChart launch={l} zones={zones} className={shownIn("chart")} />
            <StatStrip launch={l} className={cn("rounded-md border-x bg-surface lg:hidden", shownIn("chart"))} />
          </>
        }
        rail={
          <>
            <div className="max-lg:hidden">
              <TradePanel launch={l} side={side} onSideChange={setSide} />
            </div>
            <PositionPanel launch={l} className={shownIn("chart")} />
            <TokenInfo launch={l} now={now} className={shownIn("chart")} />
            {woundDown ? null : (
              <div className={shownIn("vault")}>
                <VaultCard launch={l} zones={zones} justLaunched={justLaunched} onAgentLog={openAgentLog} />
              </div>
            )}
            <WindDownCard launch={l} now={now} className={shownIn("vault")} />
            <AdminWithdrawals launch={l} now={now} className={shownIn("vault")} />
            <VerifyCard launch={l} className={shownIn("vault")} />
            <CreatorCard launch={l} className={shownIn("more")} />
          </>
        }
        tail={
          <Activity
            launch={l}
            roles={roles}
            now={now}
            tabs={activityTabs}
            tab={activityTab}
            onTab={(t) => (narrow ? setMoreTab(t) : setTab(t))}
            filters={filters}
            onFilters={setFilters}
            onFilterMaker={filterMaker}
            className={shownIn("trades", "thread", "holders", "more")}
          />
        }
      />
      <BottomBar>
        {woundDown ? (
          <Button variant="secondary" size="lg" className="flex-1" disabled>
            Trading has ended
          </Button>
        ) : (
          <>
            <Button
              variant="buy"
              size="lg"
              className="flex-1"
              onClick={() => {
                setSide("buy");
                setSheet(true);
              }}
            >
              Buy
            </Button>
            <Button
              variant="sell"
              size="lg"
              className="flex-1"
              onClick={() => {
                setSide("sell");
                setSheet(true);
              }}
            >
              Sell
            </Button>
          </>
        )}
      </BottomBar>
      <Sheet open={sheet} onOpenChange={setSheet} title={`Trade $${l.symbol}`} hideTitle>
        <TradePanel launch={l} side={side} onSideChange={setSide} bare />
      </Sheet>
    </div>
  );
}

function RaiseLayout({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const now = useNow(5_000);
  const roles = useLaunchRoles(l);
  const [tab, setTab] = useState<ActivityTab>("deposits");
  const [sheet, setSheet] = useState(false);
  const ended = phase === "failed" || phase === "refunding";
  const refundReason = useRefundReason(l);

  return (
    <div className="grid gap-3">
      {ended ? (
        <div role="status" className="body flex items-center gap-3 rounded-md bg-warn-wash px-4 py-3 text-ink">
          <RefundGlyph className="shrink-0 text-warn" />
          {refundReason}
        </div>
      ) : null}
      <Columns
        main={<RaisePanel launch={l} phase={phase} />}
        rail={
          <>
            {ended ? (
              <RefundPanel launch={l} phase={phase} />
            ) : (
              <div className="max-lg:hidden">
                <BackPanel launch={l} phase={phase} />
              </div>
            )}
            <LaunchPanel launch={l} phase={phase} />
            <VerifyCard launch={l} className="max-lg:hidden" />
            <CreatorCard launch={l} className="max-lg:hidden" />
          </>
        }
        tail={
          <>
            <Activity
              launch={l}
              roles={roles}
              now={now}
              tabs={RAISE_TABS}
              tab={tab}
              onTab={setTab}
              filters={NO_FILTERS}
              onFilters={noop}
              onFilterMaker={noop}
            />
            <VerifyCard launch={l} className="lg:hidden" />
            <CreatorCard launch={l} className="lg:hidden" />
          </>
        }
      />
      {ended ? null : (
        <>
          <BottomBar>
            <Button variant="accent" size="lg" className="flex-1" onClick={() => setSheet(true)} disabled={phase !== "raising"}>
              {phase === "raising" ? "Back this launch" : "Raise closed"}
            </Button>
          </BottomBar>
          <Sheet open={sheet} onOpenChange={setSheet} title="Back this launch" hideTitle>
            <BackPanel launch={l} phase={phase} bare />
          </Sheet>
        </>
      )}
    </div>
  );
}

function TokenSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading launch">
      <div className="flex items-start gap-4">
        <Skeleton className="size-12 rounded-md md:size-16" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <Skeleton className="h-[72px] w-full" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[320px] rounded-md md:h-[480px]" />
        <Skeleton className="h-[480px] rounded-md max-lg:hidden" />
      </div>
    </div>
  );
}

/**
 * Token page `/launch/[mint]` (§4.5): header, then the live layout (chart, activity, trade rail;
 * read-only once wound down) or the raise layout (raise panel, back/refund rail) by phase. A launch
 * confirmed seconds ago renders an "indexing" state until the indexer has it.
 */
export function TokenView({ mint }: { mint: string }) {
  const { data, error, isLoading } = useLaunch(mint);
  const now = useNow();
  const [openedAt] = useState(() => Math.floor(Date.now() / 1000));
  // The clamp plays only when the launch goes live while this page is open (§3.3 launch moment).
  const [firstStatus, setFirstStatus] = useState<LaunchStatus | null>(null);
  if (data && firstStatus === null) setFirstStatus(data.status);

  if (isLoading && !data) return <TokenSkeleton />;
  if (!data) {
    const notFound = error instanceof ApiError && error.status === 404;
    if (notFound && now - openedAt < 60) {
      return (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <ClampLoader label="Indexing this launch" delayMs={0} />
          <p className="body text-ink-2">Indexing this launch. It&apos;s on-chain; the page fills in once the indexer picks it up.</p>
        </div>
      );
    }
    return (
      <EmptyState
        className="py-16"
        action={
          <ButtonLink href="/app" variant="secondary" size="sm">
            Back to Discover
          </ButtonLink>
        }
      >
        {notFound
          ? "The indexer hasn't picked up this launch yet. Try again in a minute."
          : `Couldn't load this launch. ${error instanceof Error ? error.message : "The indexer is unreachable."}`}
      </EmptyState>
    );
  }

  const phase = phaseOf(data, now);
  return (
    <div className="grid gap-6 max-lg:pb-16">
      <TokenHeader launch={data} phase={phase} now={now} />
      {phase === "live" || phase === "woundDown" ? (
        <LiveLayout key={data.mint} launch={data} justLaunched={firstStatus === "raising"} />
      ) : (
        <RaiseLayout key={data.mint} launch={data} phase={phase} />
      )}
    </div>
  );
}
