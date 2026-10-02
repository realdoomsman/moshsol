"use client";

import { LIMITS, previewBundle, previewPumpBundle, solToLamports } from "@holdfast/sdk";
import { useState } from "react";
import { fmtSolValue, fmtTokens, fmtUsd } from "@/lib/format";
import { pumpSplit } from "@/lib/pump-terms";
import { usePlatform, useStats } from "@/lib/queries";
import { INITIAL_DRAFT } from "../create/validate";
import { pctFromBps } from "../band/model";
import { ButtonLink } from "../ui/button";
import { Field, Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";

/** SOL input → lamports, or null when empty/invalid. */
function lamportsOf(v: string): bigint | null {
  try {
    const l = solToLamports(v);
    return l > 0n ? l : null;
  } catch {
    return null;
  }
}

/**
 * §8 For creators: three facts and a bundle preview mini-form — min raise, max raise, an optional
 * bundle cap (empty = no cap, the platform max) — computed with the SDK's `previewPumpBundle` (the
 * exact `launch_pump` maths; `previewBundle` while the platform still allows the Holdfast curve, as
 * the create wizard does) at both ends of the raise. The CTA opens the create wizard prefilled with
 * the same numbers.
 */
export function Creators() {
  const platform = usePlatform();
  const p = platform.data?.params;
  const solUsd = useStats().data?.solUsd ?? null;
  const mcap = (sol: number) => (solUsd ? `${fmtUsd(sol * solUsd)} (${fmtSolValue(sol)} SOL)` : `${fmtSolValue(sol)} SOL`);
  const [min, setMin] = useState(INITIAL_DRAFT.raiseMin);
  const [max, setMax] = useState(INITIAL_DRAFT.raiseMax);
  /** Empty = no cap: the bundle buys as much as the raise can, up to the platform max. */
  const [bundle, setBundle] = useState("");
  const reservePct = INITIAL_DRAFT.reservePct;

  const s = pumpSplit(p);
  const facts = [
    "Fixed 1B supply on pump.fun, mint authority revoked",
    "Your backers' bundle is the first buy; only the vault agent can sell it, slowly, into strength",
    `0% of fees to you: pump.fun’s creator fee goes ${s.vaultPct}% into your vault, ${s.burnPct}% to the buyback pool, ${s.backerPct}% to your backers`,
  ];

  const lo = lamportsOf(min);
  const hi = lamportsOf(max);
  const bundleBps = bundle.trim() ? Math.round(Number(bundle) * 100) : (p?.maxBundleSupplyBps ?? LIMITS.maxBundleSupplyBps);
  const minRaise = p ? BigInt(p.minRaiseLamports) : 0n;
  // Platform beta cap on the max raise ("0" or absent = none), as the create wizard enforces it.
  const raiseCap = p?.maxRaiseLamports ? BigInt(p.maxRaiseLamports) : 0n;
  const errors = {
    min: lo === null ? "Enter an amount" : p && lo < minRaise ? `At least ${fmtSolValue(Number(minRaise) / 1e9)} SOL` : null,
    max:
      hi === null
        ? "Enter an amount"
        : lo !== null && hi < lo
          ? "At least the minimum"
          : raiseCap > 0n && hi > raiseCap
            ? `At most ${fmtSolValue(Number(raiseCap) / 1e9)} SOL (beta cap)`
            : null,
    bundle:
      !Number.isFinite(bundleBps) || !p || bundleBps < LIMITS.minBundleSupplyBps || bundleBps > p.maxBundleSupplyBps
        ? p
          ? `Between ${LIMITS.minBundleSupplyBps / 100}% and ${p.maxBundleSupplyBps / 100}%`
          : null
        : null,
  };
  const valid = p && lo !== null && hi !== null && !errors.min && !errors.max && !errors.bundle;
  const run = (raised: bigint) => {
    const terms = { raised, launchFeeBps: p!.launchFeeBps, reserveBps: reservePct * 100, bundleSupplyBps: bundleBps };
    return p!.holdfastCurveEnabled ? previewBundle({ ...terms, virtualSol: BigInt(p!.virtualSolReserves) }) : previewPumpBundle(terms);
  };
  const atMin = valid ? run(lo!) : null;
  const atMax = valid ? run(hi!) : null;
  const href = `/create?${new URLSearchParams({ min, max, ...(bundle.trim() ? { bundle } : {}), reserve: String(reservePct) })}`;

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-5">
        <h2 className="display-l text-ink">Launch in one transaction.</h2>
        <ul className="mt-8 border-t border-line">
          {facts.map((f) => (
            <li key={f} className="body-l border-b border-line py-4 text-ink">
              {f}
            </li>
          ))}
        </ul>
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <div className="rounded-md border border-line bg-surface p-5 md:p-6">
          <h3 className="h3 text-ink">Bundle preview</h3>
          {!p ? (
            platform.isError ? (
              <p className="small mt-4 border-l-2 border-warn pl-3 text-ink-2">Couldn&rsquo;t load platform limits. Indexer unreachable.</p>
            ) : (
              <Skeleton className="mt-4 h-40 w-full" />
            )
          ) : (
            <>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Field label="Min raise" error={errors.min}>
                  {(id) => (
                    <Input id={id} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} suffix="SOL" invalid={!!errors.min} />
                  )}
                </Field>
                <Field label="Max raise" error={errors.max}>
                  {(id) => (
                    <Input id={id} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} suffix="SOL" invalid={!!errors.max} />
                  )}
                </Field>
                <Field label="Bundle cap" error={errors.bundle}>
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="decimal"
                      value={bundle}
                      placeholder="No cap"
                      onChange={(e) => setBundle(e.target.value)}
                      suffix="%"
                      invalid={!!errors.bundle}
                    />
                  )}
                </Field>
              </div>
              <table className="mt-6 w-full">
                <thead>
                  <tr className="label text-ink-3">
                    <th scope="col" className="pb-2 text-left font-[inherit]">
                      <span className="sr-only">Figure</span>
                    </th>
                    <th scope="col" className="pb-2 text-right font-[inherit]">
                      At minimum
                    </th>
                    <th scope="col" className="pb-2 text-right font-[inherit]">
                      At maximum
                    </th>
                  </tr>
                </thead>
                <tbody className="small num">
                  <PreviewRow label="Bundle" a={atMin && `${atMin.supplyPct.toFixed(2)}% of supply`} b={atMax && `${atMax.supplyPct.toFixed(2)}% of supply`} />
                  <PreviewRow
                    label="Tokens"
                    a={atMin && fmtTokens(atMin.bundleTokens)}
                    b={atMax && fmtTokens(atMax.bundleTokens)}
                  />
                  <PreviewRow
                    label="SOL kept in vault"
                    a={atMin && `${fmtSolValue(Number(atMin.vaultSol) / 1e9)} SOL`}
                    b={atMax && `${fmtSolValue(Number(atMax.vaultSol) / 1e9)} SOL`}
                  />
                  <PreviewRow
                    label="Start market cap"
                    a={atMin && mcap(atMin.marketCapAfter)}
                    b={atMax && mcap(atMax.marketCapAfter)}
                  />
                </tbody>
              </table>
              <p className="micro mt-3 text-ink-3">
                With a {reservePct}% SOL reserve (adjustable in the wizard), the {pctFromBps(p.launchFeeBps)} launch fee
                {p.holdfastCurveEnabled ? "" : " and pump.fun's create cost"}. With no cap the bundle buys as much as the raise can, up to{" "}
                {pctFromBps(p.maxBundleSupplyBps)} of supply
                {p.holdfastCurveEnabled ? "" : ", and never completes the pump.fun curve at launch"}. The reserve plus the bundle is what went in at
                launch.
              </p>
              <div className="mt-6">
                <ButtonLink href={href} variant="accent" arrow>
                  Launch a token
                </ButtonLink>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ label, a, b }: { label: string; a: string | null; b: string | null }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2.5 text-left font-[inherit] text-ink-3">
        {label}
      </th>
      <td className="py-2.5 text-right text-ink">{a ?? "—"}</td>
      <td className="py-2.5 text-right text-ink">{b ?? "—"}</td>
    </tr>
  );
}
