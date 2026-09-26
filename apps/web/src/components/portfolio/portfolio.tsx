"use client";

import { lamportsToSol } from "@moshsol/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { Briefcase, Coins, Crown, Layers, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMoshClient } from "@/lib/chain";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { useMounted, useNow } from "@/lib/hooks";
import { phaseOf } from "@/lib/launch";
import { usePortfolio } from "@/lib/queries";
import { useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Button, ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { AnimatedNumber, TokenAvatar } from "../ui/interactive";
import { Card, CardHeader, EmptyState, Skeleton } from "../ui/primitives";
import { ChangeText, PhasePill } from "../ui/status";

/** Claim instructions per transaction; each claim is small, this keeps well inside size/CU limits. */
const CLAIMS_PER_TX = 6;

const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-dim first:pl-5 last:pr-5";
const td = "px-3 py-3 first:pl-5 last:pr-5";

function LaunchCell({ l, now }: { l: LaunchSummary; now: number }) {
  return (
    <Link href={`/launch/${l.mint}`} className="group flex min-w-0 items-center gap-3">
      <TokenAvatar src={l.image} symbol={l.symbol} size={36} />
      <span className="min-w-0">
        <span className="block truncate font-semibold group-hover:text-lime">{l.name}</span>
        <span className="flex items-center gap-2 text-xs text-dim">
          ${l.symbol} <PhasePill phase={phaseOf(l, now)} className="h-5 px-1.5 text-[10.5px]" />
        </span>
      </span>
    </Link>
  );
}

function Section({ title, icon, right, children }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} icon={icon} right={right} />
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

export function PortfolioView() {
  const mounted = useMounted();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey?.toBase58() ?? null;
  const { data, isLoading, isError } = usePortfolio(wallet);
  const client = useMoshClient();
  const tx = useTx();
  const now = useNow(10_000);

  if (!mounted || !publicKey) {
    return (
      <Card className="mx-auto mt-6 max-w-xl">
        <EmptyState
          icon={<Wallet className="size-5" aria-hidden />}
          title="Connect a wallet to see your portfolio"
          action={
            <Button variant="primary" onClick={() => setVisible(true)} icon={<Wallet className="size-4" aria-hidden />}>
              Connect wallet
            </Button>
          }
        >
          Backed launches, claimable fees, refunds, launches you created and your token holdings — all in one place.
        </EmptyState>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <EmptyState icon={<Briefcase className="size-5" aria-hidden />} title="Portfolio unavailable">
          The indexer is unreachable right now. It will retry automatically.
        </EmptyState>
      </Card>
    );
  }

  const backed = data.backed.filter((b) => !b.refundable);
  const refundable = data.backed.filter((b) => b.refundable && BigInt(b.deposited) > 0n);
  const claimableBacker = data.backed.filter((b) => BigInt(b.claimable) > 0n);
  const claimableCreator = data.created.filter((c) => BigInt(c.creatorFeesUnclaimed) > 0n);
  const totalClaimable =
    claimableBacker.reduce((a, b) => a + BigInt(b.claimable), 0n) +
    claimableCreator.reduce((a, c) => a + BigInt(c.creatorFeesUnclaimed), 0n);
  const totalDeposited = backed.reduce((a, b) => a + BigInt(b.deposited), 0n);
  const holdingsValue = data.holdings.reduce((a, h) => a + h.valueSol, 0);
  const claimCount = claimableBacker.length + claimableCreator.length;

  const claimAll = async () => {
    const jobs: ((payer: PublicKey) => Promise<TransactionInstruction>)[] = [
      ...claimableBacker.map((b) => (payer: PublicKey) => client.claimBackerFeesIx(payer, new PublicKey(b.launch.mint))),
      ...claimableCreator.map((c) => (payer: PublicKey) => client.claimCreatorFeesIx(payer, new PublicKey(c.launch.mint))),
    ];
    const batches = Math.ceil(jobs.length / CLAIMS_PER_TX);
    for (let i = 0; i < batches; i++) {
      const chunk = jobs.slice(i * CLAIMS_PER_TX, (i + 1) * CLAIMS_PER_TX);
      const sig = await tx.run({
        label: batches > 1 ? `Claim all fees (${i + 1}/${batches})` : "Claim all fees",
        successMessage:
          batches > 1 ? `Claimed batch ${i + 1} of ${batches}` : `Claimed ${fmtLamports(totalClaimable)} SOL in fees`,
        computeUnits: 400_000,
        build: async (payer) => Promise.all(chunk.map((make) => make(payer))),
        invalidate: [["backer"]],
      });
      if (!sig) break;
    }
  };

  const empty = data.backed.length === 0 && data.created.length === 0 && data.holdings.length === 0;

  return (
    <div className="grid grid-cols-1 gap-5">
      <Card className="grid grid-cols-2 gap-5 p-5 sm:p-6 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto] lg:items-center">
        <div className="col-span-2 lg:col-span-1">
          <div className="text-xs font-medium text-dim">Claimable fees</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-up sm:text-4xl">
            <AnimatedNumber value={lamportsToSol(totalClaimable)} format={fmtSolValue} />
            <span className="ml-1.5 text-base font-medium text-dim">SOL</span>
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim">Backing</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtLamports(totalDeposited)} SOL</div>
          <div className="text-xs text-dim">{backed.length} launches</div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim">Holdings value</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtSolValue(holdingsValue)} SOL</div>
          <div className="text-xs text-dim">{data.holdings.length} tokens</div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim">Created</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{data.created.length}</div>
          <div className="text-xs text-dim">launches</div>
        </div>
        <Button
          variant="up"
          size="lg"
          className="col-span-2 lg:col-span-1"
          icon={<Coins className="size-4" aria-hidden />}
          disabled={claimCount === 0}
          loading={!!tx.pending && tx.pending.startsWith("Claim all")}
          onClick={() => void claimAll()}
        >
          {claimCount === 0 ? "Nothing to claim" : `Claim all · ${claimCount} launch${claimCount === 1 ? "" : "es"}`}
        </Button>
      </Card>

      {empty ? (
        <Card>
          <EmptyState
            icon={<Layers className="size-5" aria-hidden />}
            title="Nothing here yet"
            action={
              <div className="flex gap-2">
                <ButtonLink href="/" variant="primary">
                  Explore launches
                </ButtonLink>
                <ButtonLink href="/create" variant="secondary">
                  Create one
                </ButtonLink>
              </div>
            }
          >
            Back a raise to earn trading fees forever, or buy a live token.
          </EmptyState>
        </Card>
      ) : null}

      {refundable.length ? (
        <Section title="Refunds available" icon={<Undo2 className="size-3.5 text-warn" aria-hidden />}>
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Launch</th>
                <th className={cn(th, "text-right")}>Your deposit</th>
                <th className={cn(th, "text-right")}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {refundable.map((b) => (
                <tr key={b.launch.mint}>
                  <td className={td}>
                    <LaunchCell l={b.launch} now={now} />
                  </td>
                  <td className={cn(td, "text-right font-semibold tabular-nums")}>{fmtLamports(b.deposited)} SOL</td>
                  <td className={cn(td, "text-right")}>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={tx.pending === `Refund $${b.launch.symbol}`}
                      onClick={() =>
                        void tx.run({
                          label: `Refund $${b.launch.symbol}`,
                          successMessage: `Refunded ${fmtLamports(b.deposited)} SOL`,
                          build: async (payer) => [await client.refundIx(payer, new PublicKey(b.launch.mint))],
                          invalidate: [["backer", b.launch.mint]],
                        })
                      }
                    >
                      Refund
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {backed.length ? (
        <Section title="Backed launches" icon={<Coins className="size-3.5 text-[#c2a6ff]" aria-hidden />}>
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Launch</th>
                <th className={cn(th, "text-right")}>Deposited</th>
                <th className={cn(th, "text-right")}>Fee share</th>
                <th className={cn(th, "text-right")}>Vault slice (locked)</th>
                <th className={cn(th, "text-right")}>Earned</th>
                <th className={cn(th, "text-right")}>Claimable</th>
                <th className={cn(th, "text-right")}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {backed.map((b) => {
                const claimable = BigInt(b.claimable);
                return (
                  <tr key={b.launch.mint} className="hover:bg-white/[0.02]">
                    <td className={td}>
                      <LaunchCell l={b.launch} now={now} />
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>{fmtLamports(b.deposited)} SOL</td>
                    <td className={cn(td, "text-right tabular-nums text-muted")}>{(b.shareBps / 100).toFixed(2)}%</td>
                    <td className={cn(td, "text-right tabular-nums text-muted")}>
                      {b.launch.status === "live"
                        ? `${fmtSolValue(b.vaultShareSol)} SOL + ${fmtTokens(b.vaultShareTokens * 1e6)}`
                        : "—"}
                    </td>
                    <td className={cn(td, "text-right tabular-nums text-muted")}>
                      {fmtLamports(BigInt(b.feesClaimed) + claimable)} SOL
                    </td>
                    <td className={cn(td, "text-right font-semibold tabular-nums", claimable > 0n ? "text-up" : "text-dim")}>
                      {fmtLamports(claimable)} SOL
                    </td>
                    <td className={cn(td, "text-right")}>
                      <Button
                        size="sm"
                        variant={claimable > 0n ? "up" : "secondary"}
                        disabled={claimable === 0n}
                        loading={tx.pending === `Claim $${b.launch.symbol} fees`}
                        onClick={() =>
                          void tx.run({
                            label: `Claim $${b.launch.symbol} fees`,
                            successMessage: `Claimed ${fmtLamports(claimable)} SOL`,
                            build: async (payer) => [await client.claimBackerFeesIx(payer, new PublicKey(b.launch.mint))],
                            invalidate: [["backer", b.launch.mint]],
                          })
                        }
                      >
                        {b.launch.status === "raising" ? "Raising" : claimable > 0n ? "Claim" : "Nothing yet"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.created.length ? (
        <Section title="Created by you" icon={<Crown className="size-3.5 text-lime" aria-hidden />}>
          <table className="w-full min-w-[620px] text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Launch</th>
                <th className={cn(th, "text-right")}>Raised</th>
                <th className={cn(th, "text-right")}>Claimed</th>
                <th className={cn(th, "text-right")}>Unclaimed</th>
                <th className={cn(th, "text-right")}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.created.map((c) => {
                const fees = BigInt(c.creatorFeesUnclaimed);
                return (
                  <tr key={c.launch.mint} className="hover:bg-white/[0.02]">
                    <td className={td}>
                      <LaunchCell l={c.launch} now={now} />
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>{fmtLamports(c.launch.raised)} SOL</td>
                    <td className={cn(td, "text-right tabular-nums text-muted")}>{fmtLamports(c.creatorFeesClaimed)} SOL</td>
                    <td className={cn(td, "text-right font-semibold tabular-nums", fees > 0n ? "text-lime" : "text-dim")}>
                      {fmtLamports(fees)} SOL
                    </td>
                    <td className={cn(td, "text-right")}>
                      <Button
                        size="sm"
                        variant={fees > 0n ? "primary" : "secondary"}
                        disabled={fees === 0n}
                        loading={tx.pending === `Claim $${c.launch.symbol} creator fees`}
                        onClick={() =>
                          void tx.run({
                            label: `Claim $${c.launch.symbol} creator fees`,
                            successMessage: `Claimed ${fmtLamports(fees)} SOL`,
                            build: async (payer) => [await client.claimCreatorFeesIx(payer, new PublicKey(c.launch.mint))],
                          })
                        }
                      >
                        {fees > 0n ? "Claim" : "Nothing yet"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.holdings.length ? (
        <Section title="Token holdings" icon={<Wallet className="size-3.5" aria-hidden />}>
          <table className="w-full min-w-[520px] text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Token</th>
                <th className={cn(th, "text-right")}>Amount</th>
                <th className={cn(th, "text-right")}>Value</th>
                <th className={cn(th, "text-right")}>24h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.holdings.map((h) => (
                <tr key={h.launch.mint} className="hover:bg-white/[0.02]">
                  <td className={td}>
                    <LaunchCell l={h.launch} now={now} />
                  </td>
                  <td className={cn(td, "text-right tabular-nums")}>{fmtTokens(h.amount)}</td>
                  <td className={cn(td, "text-right font-semibold tabular-nums")}>{fmtSolValue(h.valueSol)} SOL</td>
                  <td className={cn(td, "text-right")}>
                    <ChangeText value={h.launch.change24h} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
    </div>
  );
}
