"use client";

import { PROGRAM_ID, TOTAL_SUPPLY, curvePda, timeAgo, vaultPda } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useMintFacts, useTokenAccountAmount } from "@/lib/chain";
import { fmtTokens } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { LaunchSummary } from "@/lib/types";
import { VerifyGlyph } from "../brand/glyphs";
import { Address } from "../ui/address";
import { cn } from "../ui/cn";
import { Skeleton } from "../ui/skeleton";

interface Check {
  label: string;
  /** null while the chain read is in flight. */
  ok: boolean | null;
  value: ReactNode;
  /** Plain-English reason shown when the check fails. */
  failure: string;
}

function CheckRow({ c }: { c: Check }) {
  return (
    <li className="small grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 border-t border-line py-2.5">
      {c.ok === null ? (
        <Skeleton className="mt-0.5 size-4" />
      ) : (
        <VerifyGlyph className={c.ok ? "mt-0.5 text-accent-ink" : "mt-0.5 text-warn"} title={c.ok ? "Verified" : "Failed"} />
      )}
      <span className="flex flex-wrap justify-between gap-x-3">
        <span className={c.ok === false ? "text-warn" : "text-ink-2"}>{c.label}</span>
        <span className={cn("num text-right", c.ok === false ? "text-warn" : "text-ink")}>{c.ok === false ? c.failure : c.value}</span>
      </span>
    </li>
  );
}

function AccountRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="small flex items-center justify-between gap-3 border-t border-line py-2">
      <span className="text-ink-2">{label}</span>
      <Address address={address} chars={5} />
    </div>
  );
}

/**
 * Verify on-chain (§4.5, Jupiter risk scan): the launch's guarantees read straight from the chain —
 * collapsed to "5 checks passed · checked 5s ago". A failed check turns the summary and its row
 * `warn` with the reason, and opens the card; it is never hidden.
 */
export function VerifyCard({ launch: l, className }: { launch: LaunchSummary; className?: string }) {
  const launchKey = new PublicKey(l.address);
  const curve = curvePda(launchKey).toBase58();
  const vault = vaultPda(launchKey).toBase58();
  const mint = useMintFacts(l.mint);
  const vaultBal = useTokenAccountAmount(l.mint, vault);
  const curveBal = useTokenAccountAmount(l.mint, curve);
  const now = useNow(5_000);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const live = l.status === "live";

  const checks: Check[] = [
    {
      label: "Mint authority",
      ok: mint.data ? mint.data.mintAuthority === null : null,
      value: "Revoked",
      failure: "Still set: more tokens could be minted.",
    },
    {
      label: "Freeze authority",
      ok: mint.data ? mint.data.freezeAuthority === null : null,
      value: "None",
      failure: "Set: token accounts could be frozen.",
    },
    {
      label: "Supply",
      ok: mint.data ? mint.data.supply === TOTAL_SUPPLY : null,
      value: `${Number(TOTAL_SUPPLY / 1_000_000n).toLocaleString("en-US")} fixed`,
      failure: `Supply is ${mint.data ? fmtTokens(mint.data.supply) : "?"}, not 1,000,000,000.`,
    },
    ...(live
      ? [
          {
            label: "Vault tokens",
            ok: vaultBal.data !== undefined ? vaultBal.data === BigInt(l.vaultTokens) : null,
            value: `${fmtTokens(l.vaultTokens)} in a program-owned PDA`,
            failure: `The vault account holds ${vaultBal.data !== undefined ? fmtTokens(vaultBal.data) : "?"}, not the indexed ${fmtTokens(l.vaultTokens)}.`,
          },
        ]
      : []),
    {
      label: "Liquidity",
      ok: curveBal.data !== undefined ? curveBal.data === BigInt(l.tokenReserve) : null,
      value: "Curve, never migrates",
      failure: `The curve account holds ${curveBal.data !== undefined ? fmtTokens(curveBal.data) : "?"}, not the indexed reserve.`,
    },
  ];
  const settled = checks.every((c) => c.ok !== null);
  const failed = checks.filter((c) => c.ok === false);
  const passed = checks.filter((c) => c.ok === true).length;
  const checkedAt = Math.max(mint.dataUpdatedAt, vaultBal.dataUpdatedAt, curveBal.dataUpdatedAt);
  const expanded = open || failed.length > 0;

  return (
    <section className={cn("min-w-0 rounded-md border border-line bg-surface", className)} aria-label="Verify on-chain">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="h3 text-ink">Verify on-chain</span>
          <span className={cn("small num", failed.length ? "text-warn" : "text-ink-2")}>
            {!settled && !failed.length
              ? "Checking…"
              : failed.length
                ? `${failed.length} check${failed.length > 1 ? "s" : ""} failed`
                : `${passed} checks passed ✓`}
            {settled && checkedAt > 0 ? (
              <span className="text-ink-3"> · checked {timeAgo(Math.floor(checkedAt / 1000), now)}</span>
            ) : null}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-2)", expanded && "rotate-180")}
          strokeWidth={1.5}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div id={bodyId} className="px-4 pb-3">
          <ul>
            {checks.map((c) => (
              <CheckRow key={c.label} c={c} />
            ))}
            <li className="small grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 border-t border-line py-2.5">
              <VerifyGlyph className="mt-0.5 text-accent-ink" />
              <span className="flex flex-wrap justify-between gap-x-3">
                <span className="text-ink-2">Fees &amp; limits</span>
                <span className="text-ink">Frozen at creation</span>
              </span>
            </li>
          </ul>
          <div className="mt-2">
            <AccountRow label="Mint" address={l.mint} />
            <AccountRow label="Launch account" address={l.address} />
            <AccountRow label="Curve tokens" address={curve} />
            <AccountRow label="Vault tokens" address={vault} />
            <AccountRow label="Creator" address={l.creator} />
            <AccountRow label="Program" address={PROGRAM_ID.toBase58()} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
