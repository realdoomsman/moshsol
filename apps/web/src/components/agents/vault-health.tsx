"use client";

import { timeAgo } from "@holdfast/sdk";
import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { BandMeter } from "../token/band-meter";
import { StatusDot } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState } from "../ui/empty-state";
import { Input } from "../ui/input";
import { Segmented } from "../ui/tabs";
import { Table, TD, TH, THead, TR } from "../ui/table";
import { TokenAvatar } from "../ui/token-avatar";
import { ActionChip } from "./decision-log";
import type { VaultHealth } from "./health";

type Filter = "all" | "attention";

/** Share of a window budget used: a 4px meter on the same `line` track as the progress bars. */
function Budget({ pct, used, cap, label, caption }: { pct: number; used: string; cap: string; label: string; caption?: string }) {
  return (
    <div className="grid w-36 gap-1">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-1 overflow-hidden rounded-[2px] bg-line"
      >
        <div className="h-full bg-ink-2" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="micro num text-ink-3">
        {caption ? `${caption} ` : ""}
        {used} / {cap}
      </span>
    </div>
  );
}

function Status({ h }: { h: VaultHealth }) {
  return (
    <span className={cn("small flex items-start gap-2", h.tone === "warn" ? "text-warn" : "text-ink-2")}>
      <StatusDot tone={h.tone === "warn" ? "warn" : "up"} className="mt-1.5" />
      <span className="min-w-0 text-pretty">{h.status}</span>
    </span>
  );
}

/**
 * Vault health (§4.10, the Rabby chain-dashboard pattern): one row per live vault with holdings,
 * band position, window budgets, the last decision and a plain-English status. The filter counts
 * come from the same list that is rendered.
 */
export function VaultHealthList({ rows, now, loading }: { rows: VaultHealth[]; now: number; loading: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const attention = rows.filter((h) => h.tone === "warn");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (filter === "attention" ? rows.filter((h) => h.tone === "warn") : rows).filter(
      (h) =>
        !q ||
        h.row.symbol.toLowerCase().includes(q) ||
        h.row.name.toLowerCase().includes(q) ||
        h.row.mint.toLowerCase().startsWith(q),
    );
  }, [rows, filter, query]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Filter vaults"
          size="sm"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: <span className="num">All ({rows.length})</span> },
            { value: "attention", label: <span className="num">Needs attention ({attention.length})</span> },
          ]}
        />
        <Input
          aria-label="Search vaults"
          placeholder="Search token"
          prefix={<Search className="size-4" strokeWidth={1.5} aria-hidden />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      <div className="rounded-md border border-line bg-surface">
        {loading && !rows.length ? (
          <EmptyState>Loading live vaults…</EmptyState>
        ) : !rows.length ? (
          <EmptyState>No live vaults yet. A vault appears here the moment its launch goes live.</EmptyState>
        ) : !shown.length ? (
          <EmptyState>
            {filter === "attention" && !query ? "Every vault is being evaluated. Nothing needs attention." : "No vaults match."}
          </EmptyState>
        ) : (
          <>
            <ul className="lg:hidden">
              {shown.map((h) => (
                <li key={h.row.mint} className="grid gap-3 border-b border-line px-4 py-4 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/launch/${h.row.mint}`} className="flex min-w-0 items-center gap-3">
                      <TokenAvatar src={h.row.image} symbol={h.row.symbol} mint={h.row.mint} size={36} />
                      <span className="min-w-0">
                        <span className="ui block truncate text-ink">{h.row.name}</span>
                        <span className="small block text-ink-3">${h.row.symbol}</span>
                      </span>
                    </Link>
                    <span className="small num shrink-0 text-right text-ink-2">
                      {fmtLamports(h.row.vaultSol)} SOL
                      <span className="block text-ink-3">{fmtTokens(h.row.vaultTokens)} tokens</span>
                    </span>
                  </div>
                  <Status h={h} />
                  <BandMeter {...h.meter} compact />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <Budget
                      label="Buy budget used"
                      caption="Buy"
                      pct={h.buyUsedPct}
                      used={fmtLamports(h.buySpent)}
                      cap={`${fmtLamports(h.row.windowBuyCap)} SOL`}
                    />
                    <Budget
                      label="Sell budget used"
                      caption="Sell"
                      pct={h.sellUsedPct}
                      used={fmtTokens(h.sellSold)}
                      cap={fmtTokens(h.row.windowSellCap)}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <Table label="Live vaults" className="hidden lg:block">
              <THead>
                <TH>Vault</TH>
                <TH align="right">Holds</TH>
                <TH>Band</TH>
                <TH>Buy budget</TH>
                <TH>Sell budget</TH>
                <TH>Last decision</TH>
                <TH>Status</TH>
              </THead>
              <tbody>
                {shown.map((h) => (
                  <TR key={h.row.mint}>
                    <TD>
                      <Link href={`/launch/${h.row.mint}`} className="group flex items-center gap-3">
                        <TokenAvatar src={h.row.image} symbol={h.row.symbol} mint={h.row.mint} size={32} />
                        <span>
                          <span className="ui block text-ink group-hover:underline group-hover:decoration-ink-3/60 group-hover:underline-offset-2">
                            {h.row.name}
                          </span>
                          <span className="small block text-ink-3">${h.row.symbol}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD align="right" className="py-2">
                      {fmtLamports(h.row.vaultSol)} SOL
                      <span className="block text-ink-3">{fmtTokens(h.row.vaultTokens)} tokens</span>
                    </TD>
                    <TD>
                      <div className="w-40">
                        <BandMeter {...h.meter} compact />
                      </div>
                    </TD>
                    <TD>
                      <Budget
                        label="Buy budget used"
                        pct={h.buyUsedPct}
                        used={fmtLamports(h.buySpent)}
                        cap={`${fmtLamports(h.row.windowBuyCap)} SOL`}
                      />
                    </TD>
                    <TD>
                      <Budget
                        label="Sell budget used"
                        pct={h.sellUsedPct}
                        used={fmtTokens(h.sellSold)}
                        cap={fmtTokens(h.row.windowSellCap)}
                      />
                    </TD>
                    <TD>
                      {h.decision ? (
                        <span className="flex items-center gap-2">
                          <ActionChip d={h.decision} />
                          <span className="text-ink-3">{timeAgo(h.decision.at, now)}</span>
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TD>
                    <TD className="max-w-[320px] py-2 whitespace-normal">
                      <Status h={h} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
