"use client";

import type { LaunchTermsJson } from "@holdfast/sdk";
import { useState, type ReactNode } from "react";
import type { LaunchSummary, PlatformInfo } from "@/lib/types";
import { Address } from "../ui/address";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { RuleTooltip } from "../ui/tooltip";

const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`;

function span(secs: number): string {
  if (secs % 3_600 === 0) return `${secs / 3_600} h`;
  if (secs % 60 === 0) return `${secs / 60} min`;
  return `${secs} s`;
}

type AgentTerms = Pick<
  LaunchTermsJson,
  "agentBandBps" | "agentBuyBpsPerWindow" | "agentSellBpsPerWindow" | "agentMaxImpactBps" | "agentWindowSecs" | "emaPeriodSecs"
>;

interface RuleRow {
  rule: ReactNode;
  value: ReactNode;
  by: string;
}

function rows(t: AgentTerms, platform: PlatformInfo, scope: string): RuleRow[] {
  const terms = `Program · ${scope}`;
  return [
    {
      rule: <RuleTooltip rule="The EMA is a slow moving average of price; the band is measured from it.">Buy band</RuleTooltip>,
      value: `Spot ≥ ${pct(t.agentBandBps)} under the EMA`,
      by: terms,
    },
    { rule: "Sell band", value: `Spot ≥ ${pct(t.agentBandBps)} over the EMA`, by: terms },
    {
      rule: <RuleTooltip rule="The vault's average cost: SOL it spent per token it holds.">Cost basis</RuleTooltip>,
      value: `Buys fill at or below the vault's average cost (buy-backs ${pct(t.agentBandBps)} under its average sell); sells fill ≥ ${pct(t.agentBandBps)} above it`,
      by: terms,
    },
    {
      rule: "Window budget",
      value: `Buy ≤ ${pct(t.agentBuyBpsPerWindow)} of vault SOL · sell ≤ ${pct(t.agentSellBpsPerWindow)} of vault tokens per ${span(t.agentWindowSecs)}`,
      by: terms,
    },
    {
      rule: <RuleTooltip rule="How far one agent trade may move the curve price.">Max impact per trade</RuleTooltip>,
      value: pct(t.agentMaxImpactBps),
      by: terms,
    },
    { rule: "EMA period", value: span(t.emaPeriodSecs), by: terms },
    { rule: "Trade fee", value: "None on agent trades", by: "Program" },
    { rule: "Sell profit", value: "100% to backers: fill minus the sold tokens' average cost, paid through the fee accumulator", by: "Program" },
    { rule: "Withdraw", value: "The agent can't. The platform admin can, with admin_withdraw_vault; every withdrawal is public", by: "Program" },
    {
      rule: "Agent signer",
      value: <Address address={platform.agentAuthority} className="justify-start" />,
      by: "Platform account",
    },
    {
      rule: "Agents paused",
      value: platform.params.agentsPaused ? "Yes: no agent trades until the admin resumes them" : "No",
      by: "Platform admin",
    },
  ];
}

/**
 * The agent's rules as a spec sheet (§4.10): Rule · Value · Enforced by. Values are the platform
 * defaults from `/api/platform`, or — picked from the menu — a live launch's own frozen terms.
 */
export function RulesSheet({ platform, launches }: { platform: PlatformInfo | undefined; launches: LaunchSummary[] }) {
  const [scope, setScope] = useState<string>("platform");
  if (!platform) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  const launch = launches.find((l) => l.address === scope);
  const list = launch
    ? rows(launch.terms, platform, `$${launch.symbol} terms`)
    : rows(platform.params, platform, "launch terms");

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="small text-ink-2">
          {launch
            ? `$${launch.symbol}'s terms, frozen when it was created.`
            : "Platform defaults. Each launch copies them into its own terms at creation, and they never change after."}
        </p>
        <Select
          label="Show terms for"
          prefix="Terms"
          size="sm"
          align="end"
          value={scope}
          onChange={setScope}
          options={[
            { value: "platform", label: "Platform defaults" },
            ...launches.map((l) => ({ value: l.address, label: `$${l.symbol}`, hint: l.name })),
          ]}
        />
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <table className="small w-full border-collapse">
          <thead className="max-md:sr-only">
            <tr>
              <th scope="col" className="label h-9 px-4 text-left text-ink-3">
                Rule
              </th>
              <th scope="col" className="label h-9 px-4 text-left text-ink-3">
                Value
              </th>
              <th scope="col" className="label h-9 px-4 text-left text-ink-3">
                Enforced by
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} className="border-t border-line first:border-t-0 md:first:border-t max-md:grid max-md:gap-1 max-md:px-4 max-md:py-3">
                <th scope="row" className="text-left [font-weight:inherit] text-ink-2 md:w-[200px] md:px-4 md:py-3 md:align-top">
                  {r.rule}
                </th>
                <td className="num text-ink md:px-4 md:py-3 md:align-top">{r.value}</td>
                <td className="text-ink-3 md:w-[200px] md:px-4 md:py-3 md:align-top">{r.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
