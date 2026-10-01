"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { fmtLamports, fmtSolValue } from "@/lib/format";
import { useBackers } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { Chip, RoleChip } from "../ui/chip";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { WalletLink } from "../wallet-peek/wallet-peek";
import { fmtPct } from "./shared";
import { LoadingRows } from "./trades-tab";

const PAGE = 50;

/**
 * Backers tab (§4.5, bags "fees shared"): who funded the first buy and what each has earned — deposit,
 * pool share, claimed, claimable, total — with everything paid to backers underneath (fee share,
 * vault agent profit, wind-down payout: one accumulator, one claim).
 */
export function BackersTab({ launch: l, onFilterMaker }: { launch: LaunchSummary; onFilterMaker?: (wallet: string) => void }) {
  const q = useBackers(l.mint);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const [shown, setShown] = useState(PAGE);
  const all = q.data?.backers ?? [];
  // Launched (live or wound down): backers earn and claim.
  const live = l.status === "live" || l.status === "woundDown";
  const cols = live ? 6 : 3;

  return (
    <div>
      <Table density="dense" maxHeight={480} label={`$${l.symbol} backers`}>
        <THead>
          <TH>Backer</TH>
          <TH align="right">Deposited</TH>
          <TH align="right">Share</TH>
          {live ? (
            <>
              <TH align="right" className="max-md:hidden">
                Claimed
              </TH>
              <TH align="right" className="max-md:hidden">
                Claimable
              </TH>
              <TH align="right">Total earned</TH>
            </>
          ) : null}
        </THead>
        <tbody>
          {q.error && !q.data ? (
            <TableMessage colSpan={cols}>
              <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} className="m-3">
                Couldn&apos;t load backers. {q.error.message}
              </ErrorState>
            </TableMessage>
          ) : q.isLoading ? (
            <LoadingRows cols={cols} rows={3} />
          ) : all.length === 0 ? (
            <TableMessage colSpan={cols}>
              <EmptyState>
                {l.status === "refunding"
                  ? "Every deposit has been refunded. Refunded backer accounts close on-chain."
                  : "No backers yet. Deposits fund the first buy and earn a share of every trade plus all of the vault agent's profit."}
              </EmptyState>
            </TableMessage>
          ) : (
            all.slice(0, shown).map((b) => {
              const claimed = BigInt(b.feesClaimed);
              const claimable = BigInt(b.claimable);
              return (
                <TR key={b.owner}>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      <WalletLink wallet={b.owner} onFilter={live && onFilterMaker ? () => onFilterMaker(b.owner) : undefined} />
                      {b.owner === l.creator ? <RoleChip role="creator" /> : null}
                      {b.owner === me ? <Chip tone="ink">You</Chip> : null}
                    </span>
                  </TD>
                  <TD align="right">{fmtLamports(b.deposited)} SOL</TD>
                  <TD align="right" className="text-ink-2">
                    {fmtPct(b.shareBps / 100)}
                  </TD>
                  {live ? (
                    <>
                      <TD align="right" className="text-ink-2 max-md:hidden">
                        {fmtLamports(claimed)}
                      </TD>
                      <TD align="right" className="text-ink-2 max-md:hidden">
                        {fmtLamports(claimable)}
                      </TD>
                      <TD align="right">{fmtLamports(claimed + claimable)} SOL</TD>
                    </>
                  ) : null}
                </TR>
              );
            })
          )}
          {all.length > shown ? (
            <TableMessage colSpan={cols}>
              <LoadMore hasMore loading={false} onLoadMore={() => setShown((n) => n + PAGE)} />
            </TableMessage>
          ) : null}
        </tbody>
      </Table>
      {live ? (
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line px-4 py-3">
          <span className="small text-ink-2">
            Paid to backers
            {l.profitSharedSol > 0 ? ` (${fmtSolValue(l.profitSharedSol)} SOL from vault profit)` : ""}
          </span>
          <span className="num-l text-ink">{fmtLamports(l.backerFeesAccrued)} SOL</span>
        </div>
      ) : null}
    </div>
  );
}
