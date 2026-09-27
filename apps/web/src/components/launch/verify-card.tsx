"use client";

import { PROGRAM_ID, TOTAL_SUPPLY, curvePda, shortAddr, vaultPda } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import { CheckCircle2, ExternalLink, FileCheck2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useMintFacts, useTokenAccountAmount } from "@/lib/chain";
import { explorerAddress } from "@/lib/explorer";
import { fmtTokens } from "@/lib/format";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { CopyButton } from "../ui/interactive";
import { Card, CardHeader, Skeleton } from "../ui/primitives";

function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px]">
      {ok === null ? (
        <Skeleton className="mt-0.5 size-4 rounded-full" />
      ) : ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" aria-label="Verified" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-down" aria-label="Failed" />
      )}
      <span className={cn(ok === false ? "text-down" : "text-muted")}>{children}</span>
    </li>
  );
}

function AccountRow({ label, address, extra }: { label: string; address: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span className="text-dim">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {extra}
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[12.5px] text-muted transition hover:text-lime"
          title={address}
        >
          {shortAddr(address, 5)}
          <ExternalLink className="size-3" aria-hidden />
        </a>
        <CopyButton value={address} label={`Copy ${label}`} />
      </span>
    </div>
  );
}

export function VerifyCard({ launch: l }: { launch: LaunchSummary }) {
  const launchKey = new PublicKey(l.address);
  const curve = curvePda(launchKey).toBase58();
  const vault = vaultPda(launchKey).toBase58();
  const mint = useMintFacts(l.mint);
  const vaultBal = useTokenAccountAmount(l.mint, vault);
  const curveBal = useTokenAccountAmount(l.mint, curve);
  const live = l.status === "live";

  return (
    <Card className="@container">
      <CardHeader title="Verify on-chain" icon={<FileCheck2 className="size-3.5 text-lime" aria-hidden />} />
      <div className="grid gap-x-10 px-5 pb-5 @2xl:grid-cols-2">
        <ul className="grid content-start gap-2">
          <Check ok={mint.data ? mint.data.mintAuthority === null : null}>
            Mint authority revoked — supply can never grow
          </Check>
          <Check ok={mint.data ? mint.data.freezeAuthority === null : null}>No freeze authority — tokens can&apos;t be frozen</Check>
          <Check ok={mint.data ? mint.data.supply === TOTAL_SUPPLY : null}>
            Fixed supply {mint.data ? fmtTokens(mint.data.supply) : "…"} tokens
          </Check>
          {live ? (
            <Check ok={vaultBal.data !== undefined ? vaultBal.data === BigInt(l.vaultTokens) : null}>
              Vault token account holds {vaultBal.data !== undefined ? fmtTokens(vaultBal.data) : "…"} — owned by the
              launch PDA, no withdraw instruction
            </Check>
          ) : null}
          <Check ok={curveBal.data !== undefined ? curveBal.data === BigInt(l.tokenReserve) : null}>
            Curve account holds {curveBal.data !== undefined ? fmtTokens(curveBal.data) : "…"} — matches the curve
            reserve; liquidity never migrates
          </Check>
        </ul>
        <div className="mt-4 divide-y divide-line border-t border-line @2xl:mt-0 @2xl:border-t-0">
          <AccountRow label="Mint" address={l.mint} />
          <AccountRow label="Launch PDA" address={l.address} />
          <AccountRow
            label="Curve tokens"
            address={curve}
            extra={curveBal.data !== undefined ? <span className="text-xs text-dim tabular-nums">{fmtTokens(curveBal.data)}</span> : null}
          />
          <AccountRow
            label="Vault tokens"
            address={vault}
            extra={vaultBal.data !== undefined ? <span className="text-xs text-dim tabular-nums">{fmtTokens(vaultBal.data)}</span> : null}
          />
          <AccountRow label="Creator" address={l.creator} />
          <AccountRow label="Program" address={PROGRAM_ID.toBase58()} />
        </div>
      </div>
    </Card>
  );
}
