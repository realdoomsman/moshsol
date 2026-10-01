"use client";

import type { LaunchSummary } from "@/lib/types";
import { Tabs, type TabItem } from "../ui/tabs";
import { AgentActivity } from "./agent-activity";
import { BackersTab } from "./backers-tab";
import { DepositsTab } from "./deposits-tab";
import { HoldersTab } from "./holders-tab";
import type { LaunchRoles } from "./shared";
import { Thread } from "./thread";
import { TradersTab } from "./traders-tab";
import { TradesTab, type TradeFilters } from "./trades-tab";

export type ActivityTab = "trades" | "thread" | "holders" | "backers" | "traders" | "agent" | "deposits";

/** Tab labels with counts (brief: "Thread (23) · Holders (48) · Backers (12) · Agent (9)"). */
export function activityItems(l: LaunchSummary, tabs: readonly ActivityTab[]): TabItem<ActivityTab>[] {
  const all: Record<ActivityTab, TabItem<ActivityTab>> = {
    trades: { value: "trades", label: "Trades" },
    thread: { value: "thread", label: "Thread", count: l.comments },
    holders: { value: "holders", label: "Holders", count: l.holders },
    backers: { value: "backers", label: "Backers", count: l.backerCount },
    traders: { value: "traders", label: "Top traders" },
    agent: { value: "agent", label: "Agent", count: l.agentBuys + l.agentSells },
    deposits: { value: "deposits", label: "Deposits" },
  };
  return tabs.map((t) => all[t]);
}

/**
 * The token page's activity panel: an underline tab bar (hidden when only one tab is offered, e.g.
 * a phone's "Trades" section) over the selected table or thread.
 */
export function Activity({
  launch: l,
  roles,
  now,
  tabs,
  tab,
  onTab,
  filters,
  onFilters,
  onFilterMaker,
  className,
}: {
  launch: LaunchSummary;
  roles: LaunchRoles;
  now: number;
  tabs: readonly ActivityTab[];
  tab: ActivityTab;
  onTab: (t: ActivityTab) => void;
  filters: TradeFilters;
  onFilters: (f: TradeFilters) => void;
  onFilterMaker: (wallet: string) => void;
  className?: string;
}) {
  const current = tabs.includes(tab) ? tab : tabs[0];
  return (
    <section id="activity" aria-label="Activity" className={["min-w-0 scroll-mt-28 rounded-md border border-line bg-surface", className].join(" ")}>
      {tabs.length > 1 ? (
        <Tabs label="Activity" items={activityItems(l, tabs)} value={current} onChange={onTab} className="mb-3 px-4" />
      ) : (
        <div className="h-3" />
      )}
      <div role="tabpanel" aria-label={activityItems(l, [current])[0].label as string}>
        {current === "trades" ? (
          <TradesTab launch={l} roles={roles} now={now} filters={filters} onFilters={onFilters} />
        ) : current === "thread" ? (
          <Thread launch={l} roles={roles} now={now} />
        ) : current === "holders" ? (
          <HoldersTab launch={l} roles={roles} onFilterMaker={onFilterMaker} />
        ) : current === "backers" ? (
          <BackersTab launch={l} onFilterMaker={onFilterMaker} />
        ) : current === "traders" ? (
          <TradersTab launch={l} roles={roles} onFilterMaker={onFilterMaker} />
        ) : current === "agent" ? (
          <AgentActivity launch={l} now={now} />
        ) : (
          <DepositsTab launch={l} now={now} />
        )}
      </div>
    </section>
  );
}
