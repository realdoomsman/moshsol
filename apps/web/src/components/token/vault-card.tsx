"use client";

import { fmtPrice, lamportsToSol, TOTAL_SUPPLY, timeAgo, tokensToUi, type AgentZones } from "@holdfast/sdk";
import type { ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useAgentStatus } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { decisionHeadline, fmtDeviation, windowBudgets } from "../band/model";
import { ClampLock } from "../brand/clamp-lock-animation";
import { Mark } from "../brand/mark";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { formatCountdown } from "../ui/countdown";
import { RuleTooltip } from "../ui/tooltip";
import { BandMeter } from "./band-meter";
import { fmtPct, Panel } from "./shared";

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num text-right text-ink">{children}</dd>
    </div>
  );
}

/**
 * Vault card (§4.5): what's locked and what it's worth, the vault's average cost against spot, the
 * band meter, this window's agent budgets and the agent's latest decision (live from `/status`).
 * `justLaunched` plays the clamp once — the launch happened while this page was open.
 */
export function VaultCard({
  launch: l,
  zones,
  justLaunched,
  onAgentLog,
}: {
  launch: LaunchSummary;
  zones: AgentZones;
  justLaunched?: boolean;
  onAgentLog?: () => void;
}) {
  const now = useNow();
  const status = useAgentStatus();
  const decision = status.data?.decisions.find((d) => d.mint === l.mint);
  const value = lamportsToSol(l.vaultSol) + tokensToUi(l.vaultTokens) * l.priceSol;
  const vsCost = zones.avgCost > 0 ? (l.priceSol / zones.avgCost - 1) * 100 : null;
  const rolled = now >= l.windowStart + l.terms.agentWindowSecs;
  const left = windowBudgets(l, now);
  const buyCap = rolled ? left.buySol : BigInt(l.windowBuyCap);
  const sellCap = rolled ? left.sellTokens : BigInt(l.windowSellCap);
  const buyUsed = rolled ? 0n : BigInt(l.windowSolSpent);
  const sold = rolled ? 0n : BigInt(l.windowTokensSold);
  const windowSecs = l.terms.agentWindowSecs;
  const windowLabel = windowSecs % 3_600 === 0 ? `${windowSecs / 3_600}h` : `${Math.round(windowSecs / 60)}m`;

  return (
    <Panel
      id="vault"
      title={
        <span className="flex items-center gap-2.5">
          {justLaunched ? <ClampLock size={24} title="Vault locked" /> : <Mark size={24} />}
          Vault
        </span>
      }
      aside={<Chip tone="accent">Locked forever</Chip>}
    >
      <div className="grid gap-4 px-4 pb-4">
        <div>
          <div className="num-l text-ink">{fmtSolValue(value)} SOL</div>
          <div className="small num mt-0.5 text-ink-3">
            {fmtLamports(l.vaultSol)} SOL + {fmtTokens(l.vaultTokens)} ${l.symbol} ({fmtPct(pctOf(l.vaultTokens, TOTAL_SUPPLY))})
          </div>
        </div>

        <dl className="small grid gap-2">
          <Row
            label={
              <RuleTooltip rule="What the vault paid per token on average. The vault agent never sells below it plus the band.">
                Avg cost
              </RuleTooltip>
            }
          >
            {fmtPrice(zones.avgCost)}{" "}
            {vsCost !== null ? (
              <span className="text-ink-3">
                (price {vsCost >= 0 ? "+" : ""}
                {vsCost.toFixed(1)}% vs cost)
              </span>
            ) : null}
          </Row>
        </dl>

        <div className="grid gap-1.5">
          <span className="label text-ink-3">
            <RuleTooltip
              rule={`The vault agent may buy when price is ${l.terms.agentBandBps / 100}% or more under the EMA (and at or below its cost), and sell ${l.terms.agentBandBps / 100}% or more above it.`}
            >
              Band
            </RuleTooltip>
          </span>
          <BandMeter
            price={l.priceSol}
            ema={zones.ema}
            buyBelow={zones.buyBelow}
            sellAbove={zones.sellAbove}
            avgCost={zones.avgCost}
          />
        </div>

        <dl className="small grid gap-2 border-t border-line pt-3">
          <Row
            label={
              <RuleTooltip
                rule={`Per ${windowLabel} window the agent may spend ${l.terms.agentBuyBpsPerWindow / 100}% of the vault's SOL and sell ${l.terms.agentSellBpsPerWindow / 100}% of its tokens.`}
              >
                Window buy
              </RuleTooltip>
            }
          >
            {fmtLamports(buyUsed)} / {fmtLamports(buyCap)} SOL
          </Row>
          <Row label="Window sell">
            {fmtTokens(sold)} / {fmtTokens(sellCap)} ${l.symbol}
          </Row>
          <Row label="Resets">{rolled ? "on the next agent trade" : `in ${formatCountdown(left.resetsAt - now)}`}</Row>
        </dl>

        <div className="small grid gap-1 border-t border-line pt-3" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label text-ink-3">Last decision</span>
            {decision ? <span className="num text-ink-3">{timeAgo(decision.at, now)}</span> : null}
          </div>
          {decision ? (
            <p className="text-ink">
              {decisionHeadline(decision)}
              <span className="text-ink-3"> · {fmtDeviation(decision.emaSol > 0 ? decision.priceSol / decision.emaSol - 1 : 0)} vs EMA</span>
            </p>
          ) : (
            <p className="text-ink-2">
              {status.isError
                ? "The agent service isn't answering. The on-chain limits hold regardless."
                : "Waiting for the agent's next tick."}
            </p>
          )}
          {onAgentLog ? (
            <Button variant="ghost" size="sm" arrow className="-ml-3 justify-self-start" onClick={onAgentLog}>
              Agent log
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
