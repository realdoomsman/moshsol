"use client";

import { fmtPrice, lamportsToSol, TOTAL_SUPPLY, timeAgo, tokensToUi, type AgentZones } from "@holdfast/sdk";
import type { ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { VENUE_LABEL, venueKindOf } from "@/lib/launch";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import { useAgentStatus } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { decisionHeadline, fmtDeviation, windowBudgets } from "../band/model";
import { ClampLock } from "../brand/clamp-lock-animation";
import { Mark } from "../brand/mark";
import { Term } from "../glossary";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { formatCountdown } from "../ui/countdown";
import { ProgressBar } from "../ui/progress";
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
 * The payback fields the indexer added in October 2026, read tolerantly: an indexer that predates
 * them serves the launch without these keys and every row below falls back to "—" instead of
 * crashing the panel. (`initialVaultSol` / `lastPayoutTs` are `LaunchJson` fields; spelled out so
 * the intersection with `LaunchSummary` is the same type before and after the SDK carries them.)
 */
type PaybackFields = Partial<Pick<LaunchSummary, "backersRepaidSol" | "backerPayoutsSol" | "payoutTargetSol" | "payoutMultiple" | "payoutIntervalSecs" | "minVaultSol" | "creatorFeeSplit" | "payouts">> & {
  initialVaultSol?: string;
  lastPayoutTs?: number;
};

interface Payback {
  /** What went into the vault at launch (bundle + reserve), in SOL; undefined until the indexer serves it. */
  initial: number | undefined;
  liquid: number;
  target: number | undefined;
  /** Liquid SOL ÷ initial. */
  multiple: number | undefined;
  repaid: number | undefined;
  dividends: number | undefined;
  /** Unix seconds when the interval since the last payout is over; `now` or earlier = a payout may happen. */
  nextAt: number | undefined;
  floorSol: number | undefined;
  state: string;
}

function payback(l: LaunchSummary, now: number): Payback {
  const f = l as LaunchSummary & PaybackFields;
  const s = pumpSplit(l.terms);
  const liquid = lamportsToSol(l.vaultSol);
  const initial = f.initialVaultSol === undefined ? undefined : lamportsToSol(f.initialVaultSol);
  const target = f.payoutTargetSol ?? (initial === undefined ? undefined : initial * s.payoutMult);
  const multiple = f.payoutMultiple ?? (initial === undefined ? undefined : initial > 0 ? liquid / initial : 0);
  const intervalSecs = f.payoutIntervalSecs ?? s.payoutIntervalHours * 3_600;
  const lastPayout = f.lastPayoutTs ?? (f.payouts ? (f.payouts.lastAt ?? 0) : undefined);
  const nextAt = lastPayout === undefined ? undefined : lastPayout > 0 ? lastPayout + intervalSecs : now;
  const repaid = f.backersRepaidSol;
  const floorSol = f.minVaultSol === undefined ? s.minVaultSol : lamportsToSol(f.minVaultSol);
  const principalPaid = initial !== undefined && repaid !== undefined && initial > 0 && repaid >= initial;

  let state = "—";
  if (multiple !== undefined) {
    if (multiple < s.payoutMult) {
      state = principalPaid
        ? `Paid principal; dividends when ≥ ${fmtMult(s.payoutMult)} and strong`
        : `Not eligible: vault is ${multiple.toFixed(2)}× of start (needs ${fmtMult(s.payoutMult)})`;
    } else if (nextAt !== undefined && nextAt > now) {
      state = `Payout interval not over: next check in ${formatCountdown(nextAt - now)}`;
    } else {
      state = "Eligible — waiting for a strong chart";
    }
  }
  return { initial, liquid, target, multiple, repaid, dividends: f.backerPayoutsSol, nextAt, floorSol, state };
}

const sol = (v: number | undefined) => (v === undefined ? "—" : `${fmtSolValue(v)} SOL`);

/**
 * Vault card (§4.5): what the vault holds (liquid SOL, tokens at spot) against what went in at
 * launch, the backer payback (progress to the payout multiple, principal repaid, dividends, the
 * next possible payout, the floor), creator fees swept in and how they were split, the vault's
 * average cost against spot, vault withdrawals (admin and dev key), the band meter, this window's agent budgets and the
 * agent's latest decision (live from `/status`). `justLaunched` plays the clamp once — the launch
 * happened while this page was open.
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
  const decision = status.data?.decisions.find((d) => d.address === l.address);
  const split = pumpSplit(l.terms);
  const pump = l.venue === "pump";
  const pb = payback(l, now);
  const tokensValue = tokensToUi(l.vaultTokens) * l.priceSol;
  const value = pb.liquid + tokensValue;
  const vsCost = zones.avgCost > 0 ? (l.priceSol / zones.avgCost - 1) * 100 : null;
  const rolled = now >= l.windowStart + l.terms.agentWindowSecs;
  const left = windowBudgets(l, now);
  const { buyCap, sellCap } = left;
  const buyUsed = rolled ? 0n : BigInt(l.windowSolSpent);
  const sold = rolled ? 0n : BigInt(l.windowTokensSold);
  const windowSecs = l.terms.agentWindowSecs;
  const windowLabel = windowSecs % 3_600 === 0 ? `${windowSecs / 3_600}h` : `${Math.round(windowSecs / 60)}m`;
  const feesCollected = lamportsToSol(l.creatorFeesCollected ?? "0");
  const feeSplit = (l as LaunchSummary & PaybackFields).creatorFeeSplit;
  const withdrawnTokens = BigInt(l.vaultWithdrawnTokens ?? "0");

  return (
    <Panel
      id="vault"
      title={
        <span className="flex items-center gap-2.5">
          {justLaunched ? <ClampLock size={24} title="Vault funded" /> : <Mark size={24} />}
          Vault
        </span>
      }
      aside={<Chip tone="neutral">{pump ? `Agent-traded on ${VENUE_LABEL[venueKindOf(l)]}` : "Agent-traded"}</Chip>}
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
              <RuleTooltip rule="SOL the vault holds right now. Everything the vault agent sells stays here; it funds buy-backs and, once the vault is well above its start, the backer payback.">
                Liquid SOL
              </RuleTooltip>
            }
          >
            {fmtLamports(l.vaultSol)} SOL
          </Row>
          <Row label="Tokens at spot">
            {fmtTokens(l.vaultTokens)} ${l.symbol} <span className="text-ink-3">≈ {fmtSolValue(tokensValue)} SOL</span>
          </Row>
          <Row
            label={
              <RuleTooltip rule="What went in at launch: the bundle buy plus the reserve, after the launch fee. The payback multiple is measured against it.">
                Went in at launch
              </RuleTooltip>
            }
          >
            {sol(pb.initial)}
          </Row>
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

        <div className="grid gap-2 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label text-ink-3">
              <Term k="payback" split={split}>
                Payback
              </Term>
            </span>
            <span className="small num text-ink-3">
              {pb.multiple === undefined ? "—" : `${pb.multiple.toFixed(2)}× of start now`}
              {pb.target !== undefined ? ` · target ${fmtSolValue(pb.target)} SOL` : ""}
            </span>
          </div>
          <ProgressBar
            value={pb.liquid}
            max={pb.target ?? 0}
            size="sm"
            tone={pb.target === undefined ? "muted" : "default"}
            label={`Vault SOL against the ${fmtMult(split.payoutMult)} payout target`}
          />
          <p className="small text-ink-2">{pb.state}</p>
          <dl className="small grid gap-2">
            <Row label="Backers repaid">
              {pb.repaid === undefined ? "—" : `${fmtSolValue(pb.repaid)} / ${pb.initial === undefined ? "—" : fmtSolValue(pb.initial)} SOL`}
            </Row>
            <Row
              label={
                <RuleTooltip
                  rule={`After the principal, each payout is ${split.payoutSharePct}% of the vault's SOL, at most once every ${fmtInterval(split.payoutIntervalHours)}, only while the vault stays ${fmtMult(split.payoutMult)} its start and the chart is strong.`}
                >
                  Dividends paid
                </RuleTooltip>
              }
            >
              {sol(pb.dividends)}
            </Row>
            <Row
              label={
                <RuleTooltip rule={`At most one payout every ${fmtInterval(split.payoutIntervalHours)}; the clock starts at launch and restarts with every payout. The vault must also be ${fmtMult(split.payoutMult)} its start and the chart strong.`}>
                  Payout interval
                </RuleTooltip>
              }
            >
              {pb.nextAt === undefined ? "—" : pb.nextAt > now ? `${formatCountdown(pb.nextAt - now)} left` : `elapsed · pays once ${fmtMult(split.payoutMult)} and strong`}
            </Row>
            <Row
              label={
                <Term k="vaultFloor" split={split}>
                  Vault floor
                </Term>
              }
            >
              {pb.floorSol === undefined ? "—" : `${fmtSolValue(pb.floorSol)} SOL kept for fees`}
            </Row>
          </dl>
        </div>

        {pump ? (
          <dl className="small grid gap-2 border-t border-line pt-3">
            <Row
              label={
                <RuleTooltip
                  rule={`pump.fun's creator fee on this token, swept into the launch by collect_pump_fees: ${split.vaultPct}% becomes vault SOL, ${split.burnPct}% goes to the buyback-and-burn pool, ${split.backerPct}% to backers. The creator gets none of it.`}
                >
                  Creator fees collected
                </RuleTooltip>
              }
            >
              {fmtSolValue(feesCollected)} SOL
            </Row>
            <Row label={`${split.vaultPct}% to the vault`}>{sol(feeSplit?.vaultSol)}</Row>
            <Row
              label={
                <Term k="buybackPool" split={split}>
                  {split.burnPct}% to the buyback pool
                </Term>
              }
            >
              {sol(feeSplit?.burnSol)}
            </Row>
            <Row label={`${split.backerPct}% to backers`}>{sol(feeSplit?.backersSol)}</Row>
          </dl>
        ) : null}

        {(l.profitSharedSol ?? 0) > 0 || l.vaultWithdrawnSol > 0 || withdrawnTokens > 0n ? (
          <dl className="small grid gap-2 border-t border-line pt-3">
            {(l.profitSharedSol ?? 0) > 0 ? (
              <Row
                label={
                  <RuleTooltip rule="Before October 2026 the vault paid backers a share of each profitable agent sell. That rule is gone — sell proceeds now stay in the vault — but what was paid under it stays claimable with the rest of the backer earnings.">
                    Paid under the old profit split
                  </RuleTooltip>
                }
              >
                {fmtSolValue(l.profitSharedSol)} SOL
              </Row>
            ) : null}
            {l.vaultWithdrawnSol > 0 || withdrawnTokens > 0n ? (
              <Row
                label={
                  <RuleTooltip rule="Vault SOL and tokens withdrawn by the admin (a 2-of-3 Squads multisig, admin_withdraw_vault) or the single dev key (dev_withdraw_vault, to its own wallet). Every withdrawal is an on-chain event, listed under Vault withdrawals.">
                    Withdrawn
                  </RuleTooltip>
                }
              >
                {fmtSolValue(l.vaultWithdrawnSol)} SOL
                {withdrawnTokens > 0n ? ` + ${fmtTokens(withdrawnTokens)}` : ""}
              </Row>
            ) : null}
          </dl>
        ) : null}

        <div className="grid gap-1.5 border-t border-line pt-3">
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
              Agent activity
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
