"use client";

import { lamportsToSol, PUMP_VENUE_FEE_BPS } from "@holdfast/sdk";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { pumpTradeUrl, VENUE_LABEL, venueKindOf } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";
import { ButtonAnchor } from "../ui/button";
import { Chip } from "../ui/chip";
import { RuleTooltip } from "../ui/tooltip";
import { Panel, RelativeTime, TxLink } from "./shared";

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num text-right text-ink">{children}</dd>
    </div>
  );
}

/** Where the launch trades: "Holdfast curve", "pump.fun curve" or "PumpSwap" (once graduated). */
export function VenueChip({ launch: l, className }: { launch: LaunchSummary; className?: string }) {
  return (
    <Chip tone="muted" className={className} title="Where public trades happen">
      {VENUE_LABEL[venueKindOf(l)]}
    </Chip>
  );
}

/**
 * Trade rail of a pump launch (§4.5): public trades happen on pump.fun's bonding curve (PumpSwap
 * after graduation), never on this site — the panel links out and says what the launch collects
 * from every trade.
 */
export function TradeOnPumpPanel({ launch: l, bare, className }: { launch: LaunchSummary; bare?: boolean; className?: string }) {
  const venue = VENUE_LABEL[venueKindOf(l)];
  const woundDown = l.status === "woundDown";
  return (
    <Panel title={bare ? undefined : `Trade on ${venue}`} className={className}>
      <div className="grid gap-4 px-4 pb-4">
        {bare ? <h2 className="h3 text-ink">Trade on {venue}</h2> : null}
        <p className="small text-ink-2">
          ${l.symbol} is a pump.fun token: buys and sells happen on {venue}, with its {PUMP_VENUE_FEE_BPS / 100}% venue fee.
          pump.fun pays this launch the creator share of every trade; {l.terms.burnShareBps / 100}% of it buys and burns the Holdfast
          token, {100 - l.terms.burnShareBps / 100}% goes to the vault. The vault agent trades the vault on the same venue under the
          same rules as every Holdfast launch.
        </p>
        <ButtonAnchor
          href={pumpTradeUrl(l)}
          variant={woundDown ? "secondary" : "accent"}
          size="lg"
          className="w-full"
          icon={<ArrowUpRight className="size-4" strokeWidth={1.5} aria-hidden />}
        >
          Trade ${l.symbol} on {venue}
        </ButtonAnchor>
        {woundDown ? (
          <p className="small text-ink-3">The vault was wound down; the token keeps trading on {venue}, but the agent is out.</p>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Buyback & burn (§4.5 rail, pump launches): the launch's buyback pool, what it already burned,
 * the pump.fun creator fees collected so far and the graduation state — the permissionless cranks
 * (`collect_pump_fees`, `buyback_burn`, `graduate_pump`) the indexer counts for us.
 */
export function BuybackCard({ launch: l, now, className }: { launch: LaunchSummary; now: number; className?: string }) {
  const burn = l.terms.burnShareBps / 100;
  const graduated = l.pump.graduated;
  return (
    <Panel title="Buyback & burn" aside={<VenueChip launch={l} />} className={className}>
      <div className="grid gap-4 px-4 pb-4">
        <div>
          <div className="num-l text-ink">{fmtLamports(l.buybackPoolSol)} SOL</div>
          <div className="small mt-0.5 text-ink-3">
            <RuleTooltip
              rule={`${burn}% of the pump.fun creator fees this launch collects and ${burn}% of the vault agent's realized profit. Any wallet can spend it on the Holdfast token and burn what it buys (buyback_burn), at most once a minute and 5% of the token's venue liquidity per crank.`}
            >
              in the buyback pool
            </RuleTooltip>
          </div>
        </div>
        <dl className="small grid gap-2">
          <Row label="Burned so far">
            {fmtSolValue(lamportsToSol(l.burnedSol))} SOL
            {BigInt(l.burnedTokens) > 0n ? <span className="text-ink-3"> → {fmtTokens(l.burnedTokens)} burned</span> : null}
          </Row>
          {l.lastBuybackTs > 0 ? (
            <Row label="Last buyback">
              <RelativeTime ts={l.lastBuybackTs} now={now} /> ago · {l.cranks.buybacks.toLocaleString("en-US")} so far
            </Row>
          ) : null}
          <Row
            label={
              <RuleTooltip
                rule={`pump.fun pays the token's creator a share of every trade; this launch is the creator. Any wallet can collect it (collect_pump_fees): ${burn}% to the buyback pool, ${100 - burn}% to the vault SOL (to backers once wound down). The creator wallet earns nothing from trades on pump launches.`}
              >
                Creator fees collected
              </RuleTooltip>
            }
          >
            {fmtLamports(l.creatorFeesCollected)} SOL
            {l.cranks.lastCollectedAt !== null ? (
              <span className="text-ink-3">
                {" "}
                · <RelativeTime ts={l.cranks.lastCollectedAt} now={now} /> ago
              </span>
            ) : null}
          </Row>
          <Row
            label={
              <RuleTooltip rule="pump.fun migrates a completed bonding curve into a PumpSwap pool; graduate_pump (permissionless) records the pool so the agent, fee collection and wind-down use it from then on.">
                Graduation
              </RuleTooltip>
            }
          >
            {graduated ? (
              <span className="inline-flex items-center gap-2">
                PumpSwap
                {l.graduation ? (
                  <>
                    <span className="text-ink-3">
                      · <RelativeTime ts={l.graduation.timestamp} now={now} /> ago
                    </span>
                    <TxLink signature={l.graduation.signature} />
                  </>
                ) : null}
              </span>
            ) : (
              "Not yet · on the bonding curve"
            )}
          </Row>
        </dl>
      </div>
    </Panel>
  );
}
