"use client";

import { lamportsToSol } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { Coins, Crown, Undo2, Wallet } from "lucide-react";
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

/** What the connected view holds, shown while no wallet is connected. */
const PREVIEW = [
  { icon: Coins, tone: "text-[#c2a6ff]", title: "Backer fees", body: "Your share of every trade on launches you backed — claim any time." },
  { icon: Undo2, tone: "text-warn", title: "Refunds", body: "Raises that missed their minimum, with one-click full refunds." },
  { icon: Crown, tone: "text-lime", title: "Created launches", body: "Creator fees from every trade on the launches you opened." },
  { icon: Wallet, tone: "text-cyan", title: "Holdings", body: "Tokens you hold, valued at the live curve price." },
];

function LaunchCell({ l, now }: { l: LaunchSummary; now: number }) {
  return (
    <Link href={`/launch/${l.mint}`} className="group flex min-w-0 items-center gap-3">
      <TokenAvatar src={l.image} symbol={l.symbol} size={36} />
      <span className="min-w-0">
        <span className="block truncate font-semibold group-hover:text-lime">{l.name}</span>
        <span className="flex items-center gap-2 text-xs text-dim">
          ${l.symbol} <PhasePill phase={phaseOf(l, now)} className="hidden h-5 px-1.5 text-[10.5px] sm:inline-flex" />
        </span>
      </span>
    </Link>
  );
}

function Section({ title, icon, right, children }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} icon={icon} right={right} />
      <div className="overflow-x-auto border-t border-line">{children}</div>
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
      <div className="grid items-stretch gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Card className="grid place-items-center overflow-hidden">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-violet/15 blur-3xl" />
          <EmptyState
            art="wallet"
            className="relative py-14"
            title="Connect a wallet to see your portfolio"
            action={
              <Button variant="primary" size="lg" onClick={() => setVisible(true)} icon={<Wallet className="size-4" aria-hidden />}>
                Connect wallet
              </Button>
            }
          >
            Read-only until you sign: this page only looks up your wallet&apos;s positions from the indexer.
          </EmptyState>
        </Card>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {PREVIEW.map((p) => (
            <li key={p.title} className="card flex items-start gap-3.5 p-4 sm:p-5">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04]", p.tone)}>
                <p.icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{p.title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
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
        <EmptyState art="offline" title="Portfolio unavailable">
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
            <AnimatedNumber value={lamportsToSol(totalClaimable)} format={fmtSolValue} flash />
            <span className="ml-1.5 text-base font-medium text-dim">SOL</span>
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim">Backing</div>
          <div className="mt-1 text-xl font-semibold">{fmtLamports(totalDeposited)} SOL</div>
          <div className="text-xs text-dim">
            {backed.length} launch{backed.length === 1 ? "" : "es"}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim">Holdings value</div>
          <div className="mt-1 text-xl font-semibold">{fmtSolValue(holdingsValue)} SOL</div>
          <div className="text-xs text-dim">
            {data.holdings.length} token{data.holdings.length === 1 ? "" : "s"}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim">Created</div>
          <div className="mt-1 text-xl font-semibold">{data.created.length}</div>
          <div className="text-xs text-dim">launch{data.created.length === 1 ? "" : "es"}</div>
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
          {claimCount === 0 ? "Nothing to claim" : `Claim all · ${fmtLamports(totalClaimable)} SOL`}
        </Button>
      </Card>

      {empty ? (
        <Card>
          <EmptyState
            art="deposits"
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
          <table className="data-table">
            <thead>
              <tr>
                <th>Launch</th>
                <th className="text-right">Your deposit</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {refundable.map((b) => (
                <tr key={b.launch.mint}>
                  <td>
                    <LaunchCell l={b.launch} now={now} />
                  </td>
                  <td className="text-right font-semibold tabular-nums">{fmtLamports(b.deposited)} SOL</td>
                  <td className="text-right">
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
          <table className="data-table">
            <thead>
              <tr>
                <th>Launch</th>
                <th className="hidden text-right sm:table-cell">Deposited</th>
                <th className="hidden text-right lg:table-cell">Fee share</th>
                <th className="hidden text-right md:table-cell">Vault slice (locked)</th>
                <th className="hidden text-right md:table-cell">Earned</th>
                <th className="text-right">Claimable</th>
                <th className="text-right">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {backed.map((b) => {
                const claimable = BigInt(b.claimable);
                return (
                  <tr key={b.launch.mint}>
                    <td>
                      <LaunchCell l={b.launch} now={now} />
                    </td>
                    <td className="hidden text-right sm:table-cell">{fmtLamports(b.deposited)} SOL</td>
                    <td className="hidden text-right text-muted lg:table-cell">{(b.shareBps / 100).toFixed(2)}%</td>
                    <td className="hidden text-right text-muted md:table-cell">
                      {b.launch.status === "live"
                        ? `${fmtSolValue(b.vaultShareSol)} SOL + ${fmtTokens(b.vaultShareTokens * 1e6)}`
                        : "—"}
                    </td>
                    <td className="hidden text-right text-muted md:table-cell">
                      {fmtLamports(BigInt(b.feesClaimed) + claimable)} SOL
                    </td>
                    <td className={cn("text-right font-semibold tabular-nums", claimable > 0n ? "text-up" : "text-dim")}>
                      {fmtLamports(claimable)} SOL
                    </td>
                    <td className="text-right">
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
          <table className="data-table">
            <thead>
              <tr>
                <th>Launch</th>
                <th className="hidden text-right sm:table-cell">Raised</th>
                <th className="hidden text-right sm:table-cell">Claimed</th>
                <th className="text-right">Unclaimed</th>
                <th className="text-right">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.created.map((c) => {
                const fees = BigInt(c.creatorFeesUnclaimed);
                return (
                  <tr key={c.launch.mint}>
                    <td>
                      <LaunchCell l={c.launch} now={now} />
                    </td>
                    <td className="hidden text-right sm:table-cell">{fmtLamports(c.launch.raised)} SOL</td>
                    <td className="hidden text-right text-muted sm:table-cell">{fmtLamports(c.creatorFeesClaimed)} SOL</td>
                    <td className={cn("text-right font-semibold tabular-nums", fees > 0n ? "text-lime" : "text-dim")}>
                      {fmtLamports(fees)} SOL
                    </td>
                    <td className="text-right">
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
          <table className="data-table">
            <thead>
              <tr>
                <th>Token</th>
                <th className="hidden text-right sm:table-cell">Amount</th>
                <th className="text-right">Value</th>
                <th className="text-right">24h</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.launch.mint}>
                  <td>
                    <LaunchCell l={h.launch} now={now} />
                  </td>
                  <td className="hidden text-right sm:table-cell">{fmtTokens(h.amount)}</td>
                  <td className="text-right font-semibold">
                    {fmtSolValue(h.valueSol)} SOL
                    <span className="block text-xs font-normal text-dim sm:hidden">
                      {fmtTokens(h.amount)} ${h.launch.symbol}
                    </span>
                  </td>
                  <td className="text-right">
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
