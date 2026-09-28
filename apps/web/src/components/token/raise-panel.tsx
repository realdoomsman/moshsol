"use client";

import { fmtPrice, lamportsToSol, previewBundle } from "@holdfast/sdk";
import { useMemo, type ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import type { Phase } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";
import { Countdown } from "../ui/countdown";
import { NumberTicker } from "../ui/number-ticker";
import { ProgressBar } from "../ui/progress";
import { RuleTooltip } from "../ui/tooltip";
import { fmtPct } from "./shared";

function Cell({ label, rule, children }: { label: string; rule?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="label truncate text-ink-3">{rule ? <RuleTooltip rule={rule}>{label}</RuleTooltip> : label}</dt>
      <dd className="h3 num mt-1 truncate text-ink">{children}</dd>
    </div>
  );
}

/** What the `launch` instruction would do with the raise as it stands (exact program maths). */
function LaunchedNow({ launch: l }: { launch: LaunchSummary }) {
  const raised = BigInt(l.raised);
  const b = useMemo(
    () =>
      raised > 0n
        ? previewBundle({
            raised,
            virtualSol: BigInt(l.virtualSol),
            launchFeeBps: l.terms.launchFeeBps,
            reserveBps: l.reserveBps,
            bundleSupplyBps: l.bundleSupplyBps,
          })
        : null,
    [raised, l.virtualSol, l.terms.launchFeeBps, l.reserveBps, l.bundleSupplyBps],
  );
  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-2">
        <h3 className="h3 text-ink">If it launched now</h3>
        <span className="small text-ink-3">
          Bundle ≤ {l.bundleSupplyBps / 100}% of supply · {l.reserveBps / 100}% of the raise kept as vault SOL
        </span>
      </div>
      {b ? (
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-3 [&>*]:border-line max-sm:[&>*:nth-child(even)]:border-l max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:not(:nth-child(3n+1))]:border-l sm:[&>*:nth-child(n+4)]:border-t">
          <Cell label="Bundle buys" rule="The first buy, made with the raise before anyone can trade. It goes straight into the vault.">
            {fmtPct(b.supplyPct)} of supply
          </Cell>
          <Cell label="Vault tokens">{fmtTokens(b.bundleTokens)}</Cell>
          <Cell label="Vault SOL" rule="Kept in the vault for the agent to buy dips with.">
            {fmtLamports(b.vaultSol)} SOL
          </Cell>
          <Cell label="SOL into the curve">{fmtLamports(b.bundleSol)} SOL</Cell>
          <Cell label="Start price">{fmtPrice(b.priceAfter)}</Cell>
          <Cell label="Start mcap">{fmtSolValue(b.marketCapAfter)} SOL</Cell>
        </dl>
      ) : (
        <p className="small px-4 pb-4 text-ink-2">The preview fills in with the first deposit.</p>
      )}
    </div>
  );
}

/**
 * Raise panel (§4.5 raising state): raised / max in `num-xl`, the progress bar with its min tick,
 * the text countdown, the raise's terms and the "If it launched now" preview.
 */
export function RaisePanel({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const raised = lamportsToSol(l.raised);
  const max = lamportsToSol(l.raiseMax);
  const min = lamportsToSol(l.raiseMin);
  const minMet = BigInt(l.raised) >= BigInt(l.raiseMin);
  const ended = phase === "failed" || phase === "refunding";
  const cap = BigInt(l.maxPerWallet);

  return (
    <section aria-label="Raise" className="min-w-0 rounded-md border border-line bg-surface">
      <div className="grid gap-5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <div className="label text-ink-3">{ended ? "Raised before it closed" : "Raised"}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <NumberTicker value={raised} format={fmtSolValue} roll className="num-xl text-ink" />
              <span className="num-l text-ink-3">/ {fmtSolValue(max)} SOL</span>
            </div>
          </div>
          <div className="num-l text-right text-ink">
            {phase === "raising" ? (
              <Countdown to={l.raiseDeadline} prefix="Closes in" endedLabel="Closed" />
            ) : phase === "ready" ? (
              <span>Ready to launch</span>
            ) : (
              <span className="text-ink-2">Closed</span>
            )}
          </div>
        </div>

        <div className="pb-6">
          <ProgressBar
            size="md"
            value={raised}
            max={max}
            min={min}
            tone={ended ? "muted" : "default"}
            minLabel={`min ${fmtSolValue(min)}`}
            label={`Raised ${fmtSolValue(raised)} of ${fmtSolValue(max)} SOL, minimum ${fmtSolValue(min)}`}
          />
          <div className="relative">
            <span className="micro num absolute top-2 right-0 text-ink-3">max {fmtSolValue(max)}</span>
          </div>
        </div>

        {phase === "raising" && minMet ? (
          <p className="small text-ink-2">The creator can launch now. Anyone can launch it at the deadline or once the max is hit.</p>
        ) : phase === "ready" ? (
          <p className="small text-ink-2">
            The minimum is met and the raise is closed. Launching buys the bundle before anyone can trade. Any wallet can trigger it.
          </p>
        ) : phase === "raising" ? (
          <p className="small text-ink-2">
            {fmtLamports(BigInt(l.raiseMin) - BigInt(l.raised))} SOL to the minimum. If it isn&apos;t met by the deadline, every
            backer can refund 100%.
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 border-t border-line md:grid-cols-4 [&>*]:border-line max-md:[&>*:nth-child(even)]:border-l max-md:[&>*:nth-child(n+3)]:border-t md:[&>*+*]:border-l">
        <Cell label="Backers">{l.backerCount.toLocaleString("en-US")}</Cell>
        <Cell label="Min" rule="The raise launches only if at least this much is deposited. Otherwise every backer can refund 100%.">
          {fmtSolValue(min)} SOL
        </Cell>
        <Cell label="Per-wallet cap">{cap > 0n ? `${fmtLamports(cap)} SOL` : "None"}</Cell>
        <Cell label="Access">{l.whitelisted ? `Whitelist · ${l.whitelist?.length ?? 0}` : "Open"}</Cell>
      </dl>

      {ended ? null : <LaunchedNow launch={l} />}
    </section>
  );
}
