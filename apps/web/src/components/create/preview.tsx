"use client";

import { fmtPrice, shortAddr } from "@holdfast/sdk";
import type { ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens, fmtUsd } from "@/lib/format";
import { useStats } from "@/lib/queries";
import { ClampGlyph } from "../brand/glyphs";
import { StatusChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { ProgressBar } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { TokenAvatar } from "../ui/token-avatar";
import { RuleTooltip } from "../ui/tooltip";
import type { BundleRange, CreateCost } from "./math";
import { fmtDuration, previewLamports, type CreateDraft } from "./validate";

const pct = (v: number) => `${v.toFixed(v >= 10 ? 1 : 2)}%`;

/** The Discover card (§4.4, raising state) as the launch will first appear. */
export function DraftCard({
  draft,
  bundleSupplyBps,
  imageUrl,
  creator,
  durationSecs,
}: {
  draft: CreateDraft;
  /** The cap the launch will carry (the platform max without a custom cap), as Discover shows it. */
  bundleSupplyBps: number;
  imageUrl: string | null;
  creator: string | null;
  durationSecs: number | null;
}) {
  const symbol = draft.symbol.trim() || "TICKER";
  const min = previewLamports(draft.raiseMin);
  const max = previewLamports(draft.raiseMax);
  return (
    <article className="rounded-md border border-line bg-surface p-4">
      <div className="flex gap-3">
        <TokenAvatar src={imageUrl} symbol={symbol} mint={symbol} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn("h3 min-w-0 truncate", draft.name.trim() ? "text-ink" : "text-ink-3")}>
              {draft.name.trim() || "Token name"}
            </h3>
            <StatusChip status="raising" className="shrink-0" />
          </div>
          <div className="small mt-0.5 flex min-w-0 items-center gap-1 text-ink-3">
            <span className="shrink-0 text-ink-2">${symbol}</span>
            <span aria-hidden>·</span>
            <span className="truncate">by {creator ? <span className="mono">{shortAddr(creator)}</span> : "you"}</span>
          </div>
        </div>
      </div>
      {draft.description.trim() ? <p className="small mt-3 line-clamp-2 text-ink-2">{draft.description.trim()}</p> : null}
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="ui num text-ink">
            0 <span className="text-ink-3">/ {max !== null ? fmtLamports(max) : "—"} SOL</span>
          </span>
          <span className="small num text-ink-3">min {min !== null ? fmtLamports(min) : "—"}</span>
        </div>
        <ProgressBar
          value={0}
          max={max !== null ? Number(max) : 1}
          min={min !== null && max !== null && max >= min ? Number(min) : undefined}
          className="mt-2"
        />
        <p className="small num mt-3 truncate text-ink-3">
          {durationSecs ? `Closes ${fmtDuration(durationSecs)} after creation` : "Set a duration"} · bundle ≤ {bundleSupplyBps / 100}%
          {draft.access === "whitelist" ? " · whitelist" : draft.access === "self" ? " · self-funded" : ""}
        </p>
      </div>
    </article>
  );
}

/** Bundle at the minimum and maximum raise, from `previewBundle` (the program's own math). */
export function BundleTable({ range, loading }: { range: BundleRange | null; loading: boolean }) {
  const solUsd = useStats().data?.solUsd ?? null;
  const mcap = (sol: number) => (solUsd ? `${fmtUsd(sol * solUsd)} · ${fmtSolValue(sol)} SOL` : `${fmtSolValue(sol)} SOL`);
  if (!range) {
    return loading ? (
      <Skeleton className="h-40 w-full" />
    ) : (
      <p className="small text-ink-3">Enter a valid minimum and maximum raise to see the bundle.</p>
    );
  }
  const rows: { label: ReactNode; min: string; max: string }[] = [
    { label: "Supply bought", min: pct(range.atMin.supplyPct), max: pct(range.atMax.supplyPct) },
    { label: "Held in vault", min: fmtTokens(range.atMin.bundleTokens), max: fmtTokens(range.atMax.bundleTokens) },
    {
      label: <RuleTooltip rule="Fully diluted: 1B supply × the curve price right after the bundle buy.">Start mcap</RuleTooltip>,
      min: mcap(range.atMin.marketCapAfter),
      max: mcap(range.atMax.marketCapAfter),
    },
    { label: "Start price", min: fmtPrice(range.atMin.priceAfter), max: fmtPrice(range.atMax.priceAfter) },
    {
      label: <RuleTooltip rule="SOL kept in the vault as the agent's capital for dip buys: the reserve plus anything the bundle doesn't spend (beyond a custom cap, or what the launch keeps back from the pump.fun curve). What the agent sells later stays in the vault too.">Vault SOL</RuleTooltip>,
      min: fmtLamports(range.atMin.vaultSol),
      max: fmtLamports(range.atMax.vaultSol),
    },
  ];
  return (
    <table className="small num w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className="sr-only">
            Figure
          </th>
          <th scope="col" className="label pb-2 text-right text-ink-3">
            At min · {fmtLamports(range.lo)}
          </th>
          <th scope="col" className="label pb-2 pl-3 text-right text-ink-3">
            At max · {fmtLamports(range.hi)}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            <th scope="row" className="py-2 text-left [font-weight:inherit] text-ink-2">
              {r.label}
            </th>
            <td className={cn("py-2 text-right", i === 0 ? "text-accent-ink" : "text-ink")}>{r.min}</td>
            <td className={cn("py-2 pl-3 text-right", i === 0 ? "text-accent-ink" : "text-ink")}>{r.max}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Vault bundle vs curve share of supply (§4.6 step 3): bars read faster than donuts. */
export function SupplyBar({ label, supplyPct }: { label: string; supplyPct: number }) {
  return (
    <div className="grid gap-1.5">
      <div className="small num flex justify-between gap-3 text-ink-3">
        <span>{label}</span>
        <span>
          <span className="text-accent-ink">{pct(supplyPct)} vault</span> · {pct(100 - supplyPct)} curve
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: vault bundle ${pct(supplyPct)} of supply, curve ${pct(100 - supplyPct)}`}
        className="flex h-2 gap-0.5 overflow-hidden rounded-xs"
      >
        <span className="h-full bg-accent" style={{ width: `${supplyPct}%` }} />
        <span className="h-full flex-1 bg-line-2" />
      </div>
    </div>
  );
}

/** Create fee + rent + network fee, and whether the connected wallet covers it. */
export function CostSummary({
  cost,
  balance,
  connected,
}: {
  cost: CreateCost;
  balance: bigint | undefined;
  connected: boolean;
}) {
  const short = balance !== undefined && cost.total !== null && balance < cost.total;
  return (
    <dl className="small num grid gap-2">
      <div className="flex justify-between gap-3">
        <dt className="text-ink-2">Create fee</dt>
        <dd className="text-ink">{cost.createFee !== null ? `${fmtLamports(cost.createFee)} SOL` : "—"}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-2">
          <RuleTooltip rule="Rent-exempt deposits for the launch account, the mint with its metadata, and the curve and vault token accounts.">
            Account rent
          </RuleTooltip>
        </dt>
        <dd className="text-ink">≈ {fmtLamports(cost.rent)} SOL</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-2">Network fee</dt>
        <dd className="text-ink">≈ {fmtLamports(cost.network)} SOL</dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-line pt-2">
        <dt className="ui text-ink">Total</dt>
        <dd className="ui text-ink">{cost.total !== null ? `≈ ${fmtLamports(cost.total)} SOL` : "—"}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-3">Your balance</dt>
        <dd className={short ? "text-warn" : "text-ink-3"}>
          {!connected ? "Not connected" : balance === undefined ? "…" : `${fmtLamports(balance)} SOL`}
        </dd>
      </div>
    </dl>
  );
}

/** Sticky right column (desktop) / sheet body (mobile). */
export function PreviewPanel({
  card,
  range,
  loading,
  cost,
}: {
  card: ReactNode;
  range: BundleRange | null;
  loading: boolean;
  cost: ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <section aria-labelledby="preview-card" className="grid gap-3">
        <h2 id="preview-card" className="label text-ink-3">
          On Discover
        </h2>
        {card}
      </section>
      <section aria-labelledby="preview-bundle" className="grid gap-3 border-t border-line pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="preview-bundle" className="label flex items-center gap-1.5 text-ink-3">
            <ClampGlyph size={12} className="text-accent-ink" />
            Bundle
          </h2>
          <span className="micro text-ink-3">exact program math</span>
        </div>
        <BundleTable range={range} loading={loading} />
      </section>
      <section aria-labelledby="preview-cost" className="grid gap-3 border-t border-line pt-5">
        <h2 id="preview-cost" className="label text-ink-3">
          Cost to create
        </h2>
        {cost}
      </section>
    </div>
  );
}
