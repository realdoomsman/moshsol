"use client";

import { backerClaimable, lamportsToSol, seedKeyOf, TOTAL_SUPPLY, tokensToUi } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { ReactNode } from "react";
import { useBackerAccount, useMoshClient, useTokenBalance } from "@/lib/chain";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { launchId } from "@/lib/launch";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
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
 * Your position (§4.5): holdings, backer share + claimable earnings (fee share, the backers' share of
 * vault agent profit, wind-down payout — one accumulator, one claim), creator fees if you created it
 * (Holdfast launches only: pump launches have no creator share). Hidden while disconnected — no
 * "connect to see" wall.
 */
export function PositionPanel({ launch: l, className }: { launch: LaunchSummary; className?: string }) {
  const { publicKey } = useWallet();
  const client = useMoshClient();
  const tx = useTx();
  const tokens = useTokenBalance(l, publicKey);
  const backer = useBackerAccount(l, publicKey);
  if (!publicKey) return null;

  const deposited = backer.data?.deposited ?? 0n;
  const claimable = backer.data ? backerClaimable(backer.data.deposited, BigInt(l.accFeePerShare), backer.data.feesClaimed) : 0n;
  const share = pctOf(deposited, l.raised);
  const isCreator = publicKey.toBase58() === l.creator && l.terms.creatorFeeShareBps > 0;
  const creatorFees = BigInt(l.creatorFeesUnclaimed);
  const seedKey = seedKeyOf(l);
  const pump = l.venue === "pump";
  const held = tokens.data ?? 0n;
  const busy = (label: string) => tx.pending === label;
  const claim = (label: string, amount: bigint, build: (payer: PublicKey) => Promise<TransactionInstruction>) =>
    void tx.run({
      label,
      successMessage: `Claimed ${fmtLamports(amount)} SOL`,
      build: async (payer) => [await build(payer)],
      invalidate: [["backer", launchId(l)]],
    });

  return (
    <Panel title="Your position" className={className}>
      <div className="grid gap-4 px-4 pb-4">
        <div>
          {tokens.isLoading ? (
            <Skeleton className="h-7 w-40" />
          ) : (
            <div className="num-l text-ink">
              {fmtTokens(held)} <span className="ui text-ink-2">${l.symbol}</span>
            </div>
          )}
          <div className="small num mt-0.5 text-ink-3">
            ≈ {fmtSolValue(tokensToUi(held) * l.priceSol)} SOL · {fmtPct(pctOf(held, TOTAL_SUPPLY))} of supply
          </div>
        </div>

        {deposited > 0n ? (
          <div className="grid gap-3 border-t border-line pt-3">
            <dl className="small grid gap-2">
              <Row label="Backer share">{fmtPct(share)} of backer payouts</Row>
              <Row label="Deposited">{fmtLamports(deposited)} SOL</Row>
              <Row label="Your vault slice">
                {fmtSolValue((lamportsToSol(l.vaultSol) * share) / 100)} SOL + {fmtTokens((BigInt(l.vaultTokens) * BigInt(Math.round(share * 10_000))) / 1_000_000n)}
              </Row>
              <Row label="Claimed">{fmtLamports(backer.data?.feesClaimed ?? 0n)} SOL</Row>
            </dl>
            <p className="small text-ink-3">
              {pump
                ? `${100 - l.terms.burnShareBps / 100}% of the vault agent's realized profit and any wind-down payout add up here (the rest buys and burns the Holdfast token). One claim collects all of it.`
                : "Your fee share, your share of the vault agent's profit and any wind-down payout add up here. One claim collects all of it."}
            </p>
            <Button
              variant="accent"
              size="sm"
              className="justify-self-start"
              disabled={claimable === 0n}
              busy={busy("Claim backer earnings")}
              onClick={() => claim("Claim backer earnings", claimable, (payer) => client.claimBackerFeesIx(payer, seedKey))}
            >
              {busy("Claim backer earnings") && tx.stage
                ? TX_STAGE_LABEL[tx.stage]
                : claimable === 0n
                  ? "Nothing to claim yet"
                  : `Claim ${fmtLamports(claimable)} SOL`}
            </Button>
          </div>
        ) : null}

        {isCreator ? (
          <div className="grid gap-3 border-t border-line pt-3">
            <dl className="small grid gap-2">
              <Row label="Creator fees claimed">{fmtLamports(l.creatorFeesClaimed)} SOL</Row>
              <Row label="Creator fees unclaimed">{fmtLamports(creatorFees)} SOL</Row>
            </dl>
            <Button
              variant="secondary"
              size="sm"
              className="justify-self-start"
              disabled={creatorFees === 0n}
              busy={busy("Claim creator fees")}
              onClick={() => claim("Claim creator fees", creatorFees, (payer) => client.claimCreatorFeesIx(payer, seedKey))}
            >
              {busy("Claim creator fees") && tx.stage
                ? TX_STAGE_LABEL[tx.stage]
                : creatorFees > 0n
                  ? `Claim ${fmtLamports(creatorFees)} SOL`
                  : "No creator fees to claim"}
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
