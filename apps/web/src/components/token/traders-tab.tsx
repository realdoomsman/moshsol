"use client";

import { useState } from "react";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { launchId } from "@/lib/launch";
import { useTraders } from "@/lib/queries";
import type { LaunchSummary, TraderWindow } from "@/lib/types";
import { RoleChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { Segmented } from "../ui/tabs";
import { RuleTooltip } from "../ui/tooltip";
import { WalletLink } from "../wallet-peek/wallet-peek";
import { shareDetail, type LaunchRoles } from "./shared";
import { LoadingRows } from "./trades-tab";

const WINDOW_LABEL: Record<TraderWindow, string> = { "24h": "last 24 hours", "7d": "last 7 days", all: "all time" };

/**
 * Top traders tab (§4.5): non-agent wallets by SOL volume on this launch in the window. "Net SOL" is
 * cash flow (sold − bought), not PnL: tokens still held aren't valued, so the column says so.
 */
export function TradersTab({
  launch: l,
  roles,
  onFilterMaker,
}: {
  launch: LaunchSummary;
  roles: LaunchRoles;
  onFilterMaker: (wallet: string) => void;
}) {
  const [range, setRange] = useState<TraderWindow>("all");
  const q = useTraders(launchId(l), range);
  const rows = q.data?.traders ?? [];
  const cols = 7;

  return (
    <div>
      <div className="px-4 pb-3">
        <Segmented<TraderWindow>
          size="sm"
          label="Window"
          value={range}
          onChange={setRange}
          items={[
            { value: "24h", label: "24h" },
            { value: "7d", label: "7d" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <Table density="dense" maxHeight={480} label={`Top $${l.symbol} traders`}>
        <THead>
          <TH className="w-10">#</TH>
          <TH>Trader</TH>
          <TH align="right">Bought</TH>
          <TH align="right">Sold</TH>
          <TH align="right">
            <RuleTooltip rule="SOL received from sells minus SOL spent on buys. Not profit: tokens still held aren't counted.">
              Net SOL
            </RuleTooltip>
          </TH>
          <TH align="right" className="max-md:hidden">
            Holding
          </TH>
          <TH align="right">Trades</TH>
        </THead>
        <tbody>
          {q.error && !q.data ? (
            <TableMessage colSpan={cols}>
              <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} className="m-3">
                Couldn&apos;t load top traders. {q.error.message}
              </ErrorState>
            </TableMessage>
          ) : q.isLoading ? (
            <LoadingRows cols={cols} rows={4} />
          ) : rows.length === 0 ? (
            <TableMessage colSpan={cols}>
              <EmptyState>No trades in the {WINDOW_LABEL[range]}.</EmptyState>
            </TableMessage>
          ) : (
            rows.map((t, i) => {
              const share = roles.shares.get(t.wallet);
              const net = BigInt(t.netTokens);
              return (
                <TR key={t.wallet}>
                  <TD className="text-ink-3">{i + 1}</TD>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      <WalletLink wallet={t.wallet} name={t.name} avatar={t.avatar} onFilter={() => onFilterMaker(t.wallet)} />
                      {t.wallet === roles.creator ? <RoleChip role="creator" /> : null}
                      {share !== undefined ? <RoleChip role="backer" detail={shareDetail(share)} /> : null}
                    </span>
                  </TD>
                  <TD align="right">{fmtSolValue(t.buySol)} SOL</TD>
                  <TD align="right">{fmtSolValue(t.sellSol)} SOL</TD>
                  <TD align="right" className={cn(t.netSol > 0 ? "text-up" : t.netSol < 0 ? "text-down" : "text-ink-2")}>
                    {t.netSol > 0 ? "+" : ""}
                    {fmtSolValue(t.netSol)}
                  </TD>
                  <TD align="right" className="text-ink-2 max-md:hidden">
                    {net < 0n ? `−${fmtTokens(-net)}` : fmtTokens(net)}
                  </TD>
                  <TD align="right" className="text-ink-2">
                    {t.trades} <span className="text-ink-3">({t.buys}/{t.sells})</span>
                  </TD>
                </TR>
              );
            })
          )}
        </tbody>
      </Table>
    </div>
  );
}
