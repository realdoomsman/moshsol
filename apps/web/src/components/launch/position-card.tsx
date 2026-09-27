"use client";

import { backerClaimable, lamportsToSol, tokensToUi } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { Coins, Crown, Wallet } from "lucide-react";
import { useBackerAccount, useMoshClient, useTokenBalance } from "@/lib/chain";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { Card, CardHeader, Row, Skeleton } from "../ui/primitives";

export function PositionCard({ launch: l }: { launch: LaunchSummary }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const tx = useTx();
  const tokens = useTokenBalance(l.mint, publicKey);
  const backer = useBackerAccount(l.mint, publicKey);
  const isCreator = publicKey?.toBase58() === l.creator;

  if (!publicKey) {
    return (
      <Card>
        <CardHeader title="Your position" icon={<Wallet className="size-3.5" aria-hidden />} />
        <div className="px-5 pb-5">
          <p className="text-sm text-muted">Connect a wallet to see your balance, backer fees and creator fees.</p>
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setVisible(true)}>
            Connect wallet
          </Button>
        </div>
      </Card>
    );
  }

  const deposited = backer.data?.deposited ?? 0n;
  const claimable = backer.data
    ? backerClaimable(backer.data.deposited, BigInt(l.accFeePerShare), backer.data.feesClaimed)
    : 0n;
  const share = pctOf(deposited, l.raised);
  const creatorFees = BigInt(l.creatorFeesUnclaimed);
  const mint = new PublicKey(l.mint);
  const tokenValue = tokens.data !== undefined ? tokensToUi(tokens.data) * l.priceSol : 0;

  return (
    <Card>
      <CardHeader title="Your position" icon={<Wallet className="size-3.5" aria-hidden />} />
      <div className="grid gap-4 px-5 pb-5">
        <div>
          {tokens.isLoading ? (
            <Skeleton className="h-7 w-40" />
          ) : (
            <div className="text-2xl font-semibold tabular-nums">
              {fmtTokens(tokens.data ?? 0n)} <span className="text-sm font-medium text-dim">${l.symbol}</span>
            </div>
          )}
          <div className="mt-0.5 text-sm text-muted tabular-nums">
            ≈ {fmtSolValue(tokenValue)} SOL · {pctOf(tokens.data ?? 0n, "1000000000000000").toFixed(3)}% of supply
          </div>
        </div>

        {deposited > 0n ? (
          <div className="rounded-xl border border-violet/25 bg-violet/[0.06] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#c2a6ff]">
              <Coins className="size-3.5" aria-hidden /> Backer
            </div>
            <div className="mt-2.5 grid gap-1.5">
              <Row label="Deposited">{fmtLamports(deposited)} SOL</Row>
              <Row label="Fee share">{share.toFixed(2)}%</Row>
              <Row label="Your vault slice">
                {fmtSolValue((lamportsToSol(l.vaultSol) * share) / 100)} SOL + {fmtTokens((Number(l.vaultTokens) * share) / 100)}
              </Row>
              <Row label="Claimed">{fmtLamports(backer.data?.feesClaimed ?? 0n)} SOL</Row>
              <Row label="Claimable">
                <span className="text-[15px] font-semibold text-up">{fmtLamports(claimable)} SOL</span>
              </Row>
            </div>
            <Button
              variant="up"
              className="mt-3 w-full"
              disabled={claimable === 0n}
              loading={tx.pending === "Claim backer fees"}
              onClick={() =>
                void tx.run({
                  label: "Claim backer fees",
                  successMessage: `Claimed ${fmtLamports(claimable)} SOL in backer fees`,
                  build: async (payer) => [await client.claimBackerFeesIx(payer, mint)],
                  invalidate: [["backer", l.mint]],
                })
              }
            >
              {claimable === 0n ? "Nothing to claim yet" : `Claim ${fmtLamports(claimable)} SOL`}
            </Button>
          </div>
        ) : null}

        {isCreator ? (
          <div className="rounded-xl border border-lime/25 bg-lime/[0.05] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-lime">
              <Crown className="size-3.5" aria-hidden /> Creator
            </div>
            <div className="mt-2.5 grid gap-1.5">
              <Row label="Claimed">{fmtLamports(l.creatorFeesClaimed)} SOL</Row>
              <Row label="Unclaimed">
                <span className="text-[15px] font-semibold text-lime">{fmtLamports(creatorFees)} SOL</span>
              </Row>
            </div>
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={creatorFees === 0n}
              loading={tx.pending === "Claim creator fees"}
              onClick={() =>
                void tx.run({
                  label: "Claim creator fees",
                  successMessage: `Claimed ${fmtLamports(creatorFees)} SOL in creator fees`,
                  build: async (payer) => [await client.claimCreatorFeesIx(payer, mint)],
                })
              }
            >
              {creatorFees > 0n
                ? `Claim ${fmtLamports(creatorFees)} SOL`
                : BigInt(l.creatorFeesClaimed) > 0n
                  ? "All creator fees claimed"
                  : "No creator fees yet"}
            </Button>
          </div>
        ) : null}

        {deposited === 0n && !isCreator && !backer.isLoading ? (
          <p className="text-xs text-dim">You didn&apos;t back this raise. Backers earn a share of every trade fee.</p>
        ) : null}
      </div>
    </Card>
  );
}
