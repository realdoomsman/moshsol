"use client";

import { agentZones, fmtPrice, lamportsToSol, previewBundle, previewPumpBundle, timeAgo, TOTAL_SUPPLY } from "@holdfast/sdk";
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { fmtMult } from "@/lib/pump-terms";
import { useNow } from "@/lib/hooks";
import { launchHref, launchId } from "@/lib/launch";
import { useAgentStatus, useBackers, useLaunches } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { Mark } from "../brand/mark";
import { decisionDeviation, decisionHeadline, fmtDeviation } from "../band/model";
import { BandMeter } from "../token/band-meter";
import { Address } from "../ui/address";
import { formatCountdown } from "../ui/countdown";
import { EmptyState } from "../ui/empty-state";
import { ProgressBar } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { TokenAvatar } from "../ui/token-avatar";
import { useFeatured } from "./use-featured";

/**
 * Live stand-ins for the four product-loop recordings (§3.9) until the files exist: each shows the
 * same moment from real on-chain data — an open raise, a launch's vault, the agent's latest call, the
 * backer fee ledger.
 */

function Head({ launch: l, right }: { launch: LaunchSummary; right?: ReactNode }) {
  return (
    <Link
      href={launchHref(l)}
      className="flex items-center gap-3 border-b border-line px-5 py-3 transition-colors hover:bg-raised"
    >
      <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={32} />
      <span className="ui min-w-0 flex-1 truncate text-ink">
        {l.name} <span className="text-ink-3">${l.symbol}</span>
      </span>
      {right}
    </Link>
  );
}

function Row({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="small text-ink-3">{k}</span>
      <span className="small num text-right text-ink">{children}</span>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-3 p-5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

/** 01 Back the raise: the open raise closing soonest, with what the bundle would be now. */
export function RaiseFallback() {
  const nowSec = useNow(1_000);
  const raising = useLaunches({ status: "raising", sort: "new" });
  const l = (raising.data?.launches ?? [])
    .filter((x) => x.raiseDeadline > nowSec && BigInt(x.raised) < BigInt(x.raiseMax))
    .sort((a, b) => a.raiseDeadline - b.raiseDeadline)[0];
  if (raising.isPending) return <Loading />;
  if (!l) {
    return (
      <EmptyState action={<Link href="/create" className="ui text-ink underline underline-offset-4">Start one →</Link>}>
        No raise is open right now.
      </EmptyState>
    );
  }
  const raised = BigInt(l.raised);
  const min = BigInt(l.raiseMin);
  const basis = raised >= min ? raised : min;
  const terms = { raised: basis, launchFeeBps: l.terms.launchFeeBps, reserveBps: l.reserveBps, bundleSupplyBps: l.bundleSupplyBps };
  const preview = l.venue === "pump" ? previewPumpBundle(terms) : previewBundle({ ...terms, virtualSol: BigInt(l.virtualSol) });
  return (
    <div>
      <Head launch={l} right={<span className="small num text-ink-2">Closes in {formatCountdown(l.raiseDeadline - nowSec)}</span>} />
      <div className="px-5 pb-4 pt-5">
        <ProgressBar
          size="md"
          value={lamportsToSol(l.raised)}
          max={lamportsToSol(l.raiseMax)}
          min={lamportsToSol(l.raiseMin)}
          minLabel={`min ${fmtLamports(l.raiseMin)}`}
          label={`${l.name} raise progress`}
        />
        <div className="mt-9">
          <Row k="Raised">
            {fmtLamports(l.raised)} / {fmtLamports(l.raiseMax)} SOL
          </Row>
          <Row k="Backers">{l.backerCount}</Row>
          <Row k={raised >= min ? "If it launched now" : `At the minimum (${fmtLamports(l.raiseMin)} SOL)`}>
            Bundle {preview.supplyPct.toFixed(2)}% of supply · {fmtLamports(preview.vaultSol)} SOL reserve
          </Row>
        </div>
      </div>
    </div>
  );
}

/** 02 The bundle buys first: a live launch's vault, with what has left it. */
export function LockFallback() {
  const { seed, loading } = useFeatured();
  if (!seed) return loading ? <Loading /> : <EmptyState>No launch has bought its bundle yet.</EmptyState>;
  const l = seed;
  return (
    <div>
      <Head launch={l} right={<span className="small num text-ink-3">Launched {new Date(l.launchedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>} />
      <div className="flex items-center gap-4 px-5 pt-5">
        <Mark size={40} className="text-ink" />
        <div>
          <p className="h3 num text-ink">Bundle in the vault · {pctOf(l.bundleTokens, TOTAL_SUPPLY).toFixed(2)}% of supply</p>
          <p className="small num text-ink-3">
            Withdrawn by the admin: {fmtSolValue(l.vaultWithdrawnSol)} SOL · {fmtTokens(l.vaultWithdrawnTokens)} tokens
          </p>
        </div>
      </div>
      <div className="px-5 pb-4 pt-4">
        <Row k="Vault tokens">{fmtTokens(l.vaultTokens)}</Row>
        <Row k="Vault SOL">
          {fmtLamports(l.vaultSol)} SOL{l.payoutMultiple > 0 ? ` · ${fmtMult(l.payoutMultiple)} its start` : ""}
        </Row>
        <Row k="Bundle bought at">{fmtPrice(lamportsToSol(l.bundleSol) / (Number(BigInt(l.bundleTokens)) / 1e6))} SOL</Row>
        <Row k="Backers repaid">
          {fmtSolValue(l.backersRepaidSol)} SOL{l.backerPayoutsSol > 0 ? ` + ${fmtSolValue(l.backerPayoutsSol)} SOL on top` : ""}
        </Row>
        {l.profitSharedSol > 0 ? <Row k="Profit shared (old model)">{fmtSolValue(l.profitSharedSol)} SOL</Row> : null}
      </div>
    </div>
  );
}

/** 03 The agent defends: the vault agent's latest call on the featured launch, on its band. */
export function AgentFallback() {
  const { seed, loading, nowSec } = useFeatured();
  const status = useAgentStatus();
  if (!seed) return loading ? <Loading /> : <EmptyState>No live launch for the vault agent to trade yet.</EmptyState>;
  const d = status.data?.decisions.find((x) => x.mint === seed.mint);
  const z = agentZones(seed, nowSec);
  return (
    <div>
      <Head launch={seed} />
      <div className="px-5 pb-5 pt-4">
        {status.isError ? (
          <p className="small text-warn">Agent status unavailable.</p>
        ) : !d ? (
          <p className="small text-ink-3">No decision for ${seed.symbol} yet.</p>
        ) : (
          <>
            <p className="ui text-accent-ink">{decisionHeadline(d)}</p>
            {/* The headline already carries a plain hold's clause; longer reasons add the numbers. */}
            {d.action !== "hold" || d.reason.includes(" but ") ? (
              <p className="small mt-1 text-ink-2 first-letter:uppercase">{d.reason}</p>
            ) : null}
            <p className="micro num mt-1 text-ink-3">
              {fmtDeviation(decisionDeviation(d))} vs EMA · {timeAgo(d.at, nowSec)}
            </p>
          </>
        )}
        <BandMeter
          className="mt-5"
          price={d?.priceSol ?? seed.priceSol}
          ema={d?.emaSol ?? z.ema}
          buyBelow={z.buyBelow}
          sellAbove={z.sellAbove}
          avgCost={z.avgCost}
        />
      </div>
    </div>
  );
}

/** 04 Backers get paid: the featured launch's backer ledger — creator-fee share and payback claimed and claimable per backer. */
export function ClaimFallback() {
  const { seed, loading } = useFeatured();
  if (!seed) return loading ? <Loading /> : <EmptyState>No live launch paying backer fees yet.</EmptyState>;
  return <BackerLedger seed={seed} />;
}

function BackerLedger({ seed }: { seed: LaunchSummary }) {
  const backers = useBackers(launchId(seed));
  const rows = (backers.data?.backers ?? []).slice(0, 4);
  return (
    <div>
      <Head launch={seed} right={<span className="small num text-ink-2">{fmtLamports(seed.backerFeesAccrued)} SOL to backers</span>} />
      <div className="px-5 pb-4 pt-3">
        <div className="label grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line pb-2 text-ink-3">
          <span>Backer</span>
          <span className="text-right">Claimed</span>
          <span className="text-right">Claimable</span>
        </div>
        {backers.isPending ? (
          <Skeleton className="mt-3 h-4 w-full" />
        ) : rows.length === 0 ? (
          <p className="small py-3 text-ink-3">No backers on this launch.</p>
        ) : (
          rows.map((b) => (
            <div key={b.owner} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-line py-2 last:border-b-0">
              <span className="min-w-0">
                <Address address={b.owner} identicon href={`/u/${b.owner}`} />
                <span className="micro num ml-2 text-ink-3">{(b.shareBps / 100).toFixed(1)}%</span>
              </span>
              <span className="small num text-right text-ink-2">{fmtSolValue(lamportsToSol(b.feesClaimed))}</span>
              <span className="small num text-right text-accent-ink">{fmtSolValue(lamportsToSol(b.claimable))}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
