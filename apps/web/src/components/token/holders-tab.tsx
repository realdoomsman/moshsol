"use client";

import { tokensToUi } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { useHolders } from "@/lib/queries";
import { CONCENTRATION_WARN } from "@/lib/thresholds";
import type { LaunchSummary } from "@/lib/types";
import { Address } from "../ui/address";
import { Chip, RoleChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { WalletLink } from "../wallet-peek/wallet-peek";
import { fmtPct, shareDetail, type LaunchRoles } from "./shared";
import { HOLDERS_LIMIT } from "./limits";
import { useHolderStats } from "./token-info";
import { LoadingRows } from "./trades-tab";

const MAX_HOLDERS = 1_000;

/** 48px distribution bar (§4.5): vault (accent), curve (ink-3), top 10 wallets (ink), everyone else (sunken). */
function DistributionBar({ launch: l }: { launch: LaunchSummary }) {
  const h = useHolderStats(l);
  const others = Math.max(0, 100 - h.vaultPct - h.curvePct - h.top10Pct);
  const segments = [
    { label: "Vault", pct: h.vaultPct, className: "bg-accent" },
    { label: "Curve", pct: h.curvePct, className: "bg-ink-3" },
    { label: "Top 10", pct: h.top10Pct, className: "bg-ink" },
    { label: "Others", pct: others, className: "bg-sunken" },
  ];
  return (
    <div className="grid gap-2">
      <div
        role="img"
        aria-label={segments.map((s) => `${s.label} ${fmtPct(s.pct)}`).join(", ")}
        className="flex h-12 overflow-hidden rounded-sm border border-line bg-sunken"
      >
        {segments.map((s) =>
          s.pct > 0 ? (
            <div key={s.label} className={cn("h-full min-w-px", s.className)} style={{ width: `${s.pct}%` }} />
          ) : null,
        )}
      </div>
      <ul className="small num flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
        {segments.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-[2px] border border-line", s.className)} />
            {s.label} <span className="text-ink">{h.loaded || s.label === "Vault" || s.label === "Curve" ? fmtPct(s.pct) : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Holders tab (§4.5): distribution bar, a top-holder concentration warning above 10%, and the table
 * with labels computed here — vault and curve from the indexer, creator and backers from the launch.
 */
export function HoldersTab({
  launch: l,
  roles,
  onFilterMaker,
}: {
  launch: LaunchSummary;
  roles: LaunchRoles;
  onFilterMaker: (wallet: string) => void;
}) {
  const [limit, setLimit] = useState(HOLDERS_LIMIT);
  const q = useHolders(l.mint, limit);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const rows = q.data?.holders ?? [];
  const top = l.topHolderPct;
  const cols = 5;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 px-4">
        <DistributionBar launch={l} />
        {top !== null && top > CONCENTRATION_WARN.topHolderPct ? (
          <p className="small text-warn">Top holder owns {fmtPct(top)} of the supply.</p>
        ) : null}
      </div>
      <Table density="dense" maxHeight={480} label={`$${l.symbol} holders`}>
        <THead>
          <TH className="w-10">#</TH>
          <TH>Holder</TH>
          <TH align="right">% supply</TH>
          <TH align="right" className="max-md:hidden">
            Amount
          </TH>
          <TH align="right">Value</TH>
        </THead>
        <tbody>
          {q.error && !q.data ? (
            <TableMessage colSpan={cols}>
              <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} className="m-3">
                Couldn&apos;t load holders. {q.error.message}
              </ErrorState>
            </TableMessage>
          ) : q.isLoading ? (
            <LoadingRows cols={cols} />
          ) : rows.length === 0 ? (
            <TableMessage colSpan={cols}>
              <EmptyState>No holders yet. Buy on the curve to be the first.</EmptyState>
            </TableMessage>
          ) : (
            rows.map((h, i) => {
              const share = roles.shares.get(h.owner);
              return (
                <TR key={h.owner}>
                  <TD className="text-ink-3">{i + 1}</TD>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      {h.label ? (
                        <Address address={h.owner} label={h.label === "vault" ? "Holdfast vault" : "Bonding curve"} />
                      ) : (
                        <WalletLink wallet={h.owner} onFilter={() => onFilterMaker(h.owner)} />
                      )}
                      {h.label === "vault" ? <Chip tone="accent">Vault · locked forever</Chip> : null}
                      {h.label === "curve" ? <Chip tone="muted">Curve</Chip> : null}
                      {h.owner === roles.creator ? <RoleChip role="creator" /> : null}
                      {share !== undefined ? <RoleChip role="backer" detail={shareDetail(share)} /> : null}
                      {h.owner === me ? <Chip tone="ink">You</Chip> : null}
                    </span>
                  </TD>
                  <TD align="right">{fmtPct(h.pct)}</TD>
                  <TD align="right" className="text-ink-2 max-md:hidden">
                    {fmtTokens(h.amount)}
                  </TD>
                  <TD align="right" className="text-ink-2">
                    {fmtSolValue(tokensToUi(h.amount) * l.priceSol)} SOL
                  </TD>
                </TR>
              );
            })
          )}
          {rows.length >= limit && limit < MAX_HOLDERS ? (
            <TableMessage colSpan={cols}>
              <LoadMore
                hasMore
                loading={q.isFetching}
                onLoadMore={() => setLimit((n) => Math.min(MAX_HOLDERS, n * 3))}
              />
            </TableMessage>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
