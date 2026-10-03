"use client";

import { timeAgo } from "@holdfast/sdk";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OfficialBadge } from "@/components/official/official-token";
import { StatusChip } from "@/components/ui/chip";
import { Sparkline } from "@/components/ui/sparkline";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { fmtMcap, fmtSolValue } from "@/lib/format";
import { launchHref, launchId } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";
import { Change, useDaySpark } from "./launch-card";
import type { Flash } from "./live";
import { chipStatus, vaultOf, type Sort, type SortKey } from "./model";

function Spark({ l, now }: { l: LaunchSummary; now: number }) {
  const values = useDaySpark(launchId(l), l.status === "live", now);
  return values ? <Sparkline values={values} className="h-6 w-20" /> : <Sparkline values={[]} />;
}

const COLUMNS: { label: string; key?: SortKey; align?: "right" }[] = [
  { label: "#" },
  { label: "Token" },
  { label: "Status" },
  { label: "Mcap", key: "mcap", align: "right" },
  { label: "24h", key: "change", align: "right" },
  { label: "Vol 24h", key: "volume", align: "right" },
  { label: "Vault", key: "vault", align: "right" },
  { label: "Backers", key: "backers", align: "right" },
  { label: "Holders", key: "holders", align: "right" },
  { label: "Age", key: "new", align: "right" },
  { label: "24h chart", align: "right" },
];

/** Table view (§4.4): dense 48px rows, sortable headers; rows wash on trades. */
export function LaunchTable({
  launches,
  now,
  sort,
  onSort,
  flashes,
}: {
  launches: LaunchSummary[];
  now: number;
  sort: Sort;
  onSort: (key: SortKey) => void;
  flashes: Record<string, Flash>;
}) {
  const router = useRouter();
  return (
    <section className="rounded-md border border-line bg-surface">
      <Table label="Launches">
        <THead>
          {COLUMNS.map((c) => (
            <TH
              key={c.label}
              align={c.align}
              sortable={!!c.key}
              sort={c.key && sort.key === c.key ? sort.dir : undefined}
              onSort={c.key ? () => onSort(c.key!) : undefined}
            >
              {c.label}
            </TH>
          ))}
        </THead>
        <tbody>
          {launches.map((l, i) => {
            const vault = vaultOf(l);
            const flash = flashes[l.mint];
            const live = l.status === "live";
            return (
              <TR
                key={`${launchId(l)}:${flash?.n ?? 0}`}
                flash={flash?.dir}
                onClick={() => router.push(launchHref(l))}
              >
                <TD className="text-ink-3">{i + 1}</TD>
                <TD>
                  <Link href={launchHref(l)} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={32} />
                    <span className="min-w-0">
                      <span className="block max-w-48 truncate text-ink">{l.name}</span>
                      <span className="block text-ink-3">${l.symbol}</span>
                    </span>
                  </Link>
                </TD>
                <TD>
                  <span className="flex items-center gap-1.5">
                    <StatusChip status={chipStatus(l, now)} />
                    <OfficialBadge mint={l.mint} />
                  </span>
                </TD>
                <TD align="right">
                  {live ? (
                    <>
                      {fmtMcap(l)}
                      {l.marketCapUsd != null ? <span className="text-ink-3"> {fmtSolValue(l.marketCapSol)} SOL</span> : null}
                    </>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </TD>
                <TD align="right">
                  <Change value={live ? l.change24h : null} />
                </TD>
                <TD align="right">{live ? `${fmtSolValue(l.volume24hSol)} SOL` : <span className="text-ink-3">—</span>}</TD>
                <TD align="right">
                  {live ? (
                    <>
                      {fmtSolValue(vault.sol)} SOL <span className="text-ink-3">+ {vault.supplyPct.toFixed(2)}%</span>
                    </>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </TD>
                <TD align="right">{l.backerCount}</TD>
                <TD align="right">{live ? l.holders : <span className="text-ink-3">—</span>}</TD>
                <TD align="right" className="text-ink-2">
                  {timeAgo(l.createdAt, now).replace(" ago", "")}
                </TD>
                <TD align="right">
                  <Spark l={l} now={now} />
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
    </section>
  );
}
