"use client";

import { fmtLamports } from "@/lib/format";
import { useDepositFeed } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { RoleChip } from "../ui/chip";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { WalletLink } from "../wallet-peek/wallet-peek";
import { RelativeTime, TxLink, useFreshKeys } from "./shared";
import { LoadingRows } from "./trades-tab";

/** Deposits into the raise, newest first, live (row wash on arrival) with infinite scroll. */
export function DepositsTab({ launch: l, now }: { launch: LaunchSummary; now: number }) {
  const feed = useDepositFeed(l.mint);
  const fresh = useFreshKeys(feed.headKeys);
  const cols = 5;
  return (
    <Table density="dense" maxHeight={480} label={`$${l.symbol} deposits`}>
      <THead>
        <TH>Time</TH>
        <TH>Backer</TH>
        <TH align="right">Amount</TH>
        <TH align="right" className="max-md:hidden">
          Raised after
        </TH>
        <TH>
          <span className="sr-only">Transaction</span>
        </TH>
      </THead>
      <tbody>
        {feed.error ? (
          <TableMessage colSpan={cols}>
            <ErrorState onRetry={feed.retry} className="m-3">
              Couldn&apos;t load deposits. {feed.error}
            </ErrorState>
          </TableMessage>
        ) : feed.isLoading ? (
          <LoadingRows cols={cols} rows={3} />
        ) : feed.rows.length === 0 ? (
          <TableMessage colSpan={cols}>
            <EmptyState>
              No deposits yet. Back it first: backers fund the first buy, earn a share of every trade and all of the vault agent&apos;s profit.
            </EmptyState>
          </TableMessage>
        ) : (
          feed.rows.map((d) => {
            const key = `${d.signature}:${d.amount}`;
            return (
              <TR key={key} flash={fresh.has(key) ? "agent" : undefined}>
                <TD className="text-ink-2">
                  <RelativeTime ts={d.timestamp} now={now} />
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-2">
                    <WalletLink wallet={d.backer} />
                    {d.backer === l.creator ? <RoleChip role="creator" /> : null}
                  </span>
                </TD>
                <TD align="right">+{fmtLamports(d.amount)} SOL</TD>
                <TD align="right" className="text-ink-2 max-md:hidden">
                  {fmtLamports(d.raised)} SOL
                </TD>
                <TD>
                  <TxLink signature={d.signature} />
                </TD>
              </TR>
            );
          })
        )}
        {feed.hasMore || feed.loadError ? (
          <TableMessage colSpan={cols}>
            {feed.loadError ? (
              <ErrorState onRetry={feed.loadMore} retrying={feed.loadingMore} className="m-3">
                Couldn&apos;t load older deposits. {feed.loadError}
              </ErrorState>
            ) : (
              <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onLoadMore={feed.loadMore} />
            )}
          </TableMessage>
        ) : null}
      </tbody>
    </Table>
  );
}
