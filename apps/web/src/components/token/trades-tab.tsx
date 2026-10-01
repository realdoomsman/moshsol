"use client";

import { fmtPrice } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { ListFilter, X } from "lucide-react";
import { useState } from "react";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { launchId } from "@/lib/launch";
import { tradeKey, useTradeFeed, type PagedFeed } from "@/lib/queries";
import type { TradeFilter } from "@/lib/query-options";
import type { LaunchSummary, TradeRow } from "@/lib/types";
import { AgentGlyph } from "../brand/glyphs";
import { Button } from "../ui/button";
import { Chip, RoleChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { Segmented } from "../ui/tabs";
import { WalletLink } from "../wallet-peek/wallet-peek";
import { RelativeTime, shareDetail, TxLink, useFreshKeys, type LaunchRoles } from "./shared";

export type Who = "all" | "mine" | "creator" | "backers" | "agent";
export type SideFilter = "all" | "buy" | "sell";

export interface TradeFilters {
  who: Who;
  side: SideFilter;
  /** Typed minimum size in SOL ("" = none). */
  minSol: string;
  /** A single wallet (pasted, or picked from a maker cell/peek); overrides `who`. */
  maker: string | null;
}

export const NO_FILTERS: TradeFilters = { who: "all", side: "all", minSol: "", maker: null };
/** Backers filter: one `trader=` query per backer, merged by time — capped to the largest backers. */
const MAX_BACKER_QUERIES = 50;
const SUPPLY = 1_000_000_000;
/** Compact filter field matching the 32px segmented controls (40px on touch). */
const FILTER_FIELD =
  "small inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-2 bg-field px-2.5 text-ink transition-colors " +
  "hover:border-ink-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent pointer-coarse:h-10";

function isAddress(v: string): boolean {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

/** Filters → the server-side query (`/trades` side, minSol, trader, agent). */
function toQuery(f: TradeFilters, roles: LaunchRoles, me: string | null, minSol: number): TradeFilter {
  const q: TradeFilter = {};
  if (f.side !== "all") q.side = f.side;
  if (minSol > 0) q.minSol = minSol;
  if (f.maker) q.traders = [f.maker];
  else if (f.who === "agent") q.agent = true;
  else if (f.who === "mine") q.traders = me ? [me] : [];
  else if (f.who === "creator") q.traders = [roles.creator];
  else if (f.who === "backers") q.traders = roles.loaded ? roles.backers.slice(0, MAX_BACKER_QUERIES) : [];
  return q;
}

function TypeCell({ t }: { t: TradeRow }) {
  const side = t.isBuy ? "Buy" : "Sell";
  return (
    <span className={cn("inline-flex items-center gap-1.5 [font-weight:560]", t.isBuy ? "text-up" : "text-down")}>
      {t.isAgent ? (
        <>
          <AgentGlyph size={12} outline={!t.isBuy} className="text-accent" />
          Agent {side.toLowerCase()}
        </>
      ) : (
        side
      )}
    </span>
  );
}

function MakerCell({ t, roles, onFilter }: { t: TradeRow; roles: LaunchRoles; onFilter: (wallet: string) => void }) {
  const share = roles.shares.get(t.trader);
  return (
    <span className="inline-flex items-center gap-2">
      <WalletLink wallet={t.trader} onFilter={() => onFilter(t.trader)} />
      {t.isAgent ? <RoleChip role="agent" /> : null}
      {t.trader === roles.creator ? <RoleChip role="creator" /> : null}
      {share !== undefined ? <RoleChip role="backer" detail={shareDetail(share)} /> : null}
      <button
        type="button"
        onClick={() => onFilter(t.trader)}
        aria-label="Filter trades by this wallet"
        title="Filter trades by this wallet"
        className="relative inline-flex text-ink-3 opacity-0 transition-opacity before:absolute before:-inset-3 group-hover/row:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        <ListFilter className="size-3.5" strokeWidth={1.5} aria-hidden />
      </button>
    </span>
  );
}

function FeedFooter<T>({ feed, cols }: { feed: PagedFeed<T>; cols: number }) {
  if (feed.loadError) {
    return (
      <TableMessage colSpan={cols}>
        <ErrorState onRetry={feed.loadMore} retrying={feed.loadingMore} className="m-3">
          Couldn&apos;t load older rows. {feed.loadError}
        </ErrorState>
      </TableMessage>
    );
  }
  if (!feed.hasMore) return null;
  return (
    <TableMessage colSpan={cols}>
      <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onLoadMore={feed.loadMore} />
    </TableMessage>
  );
}

export function LoadingRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }, (_, j) => (
        <td key={j} className="h-10 border-b border-line px-3 first:pl-4 last:pr-4">
          <Skeleton className="h-3.5 w-full max-w-24" />
        </td>
      ))}
    </tr>
  ));
}

/**
 * Trades tab (§4.5): server-side filters (who, side, min size, maker), role chips on makers, the
 * wallet peek on every maker, row flash for live inserts and infinite scroll via `before=`.
 */
export function TradesTab({
  launch: l,
  roles,
  now,
  filters,
  onFilters,
}: {
  launch: LaunchSummary;
  roles: LaunchRoles;
  now: number;
  filters: TradeFilters;
  onFilters: (f: TradeFilters) => void;
}) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const me = publicKey?.toBase58() ?? null;
  const minSolDebounced = useDebounced(filters.minSol, 400);
  const minSol = Number(minSolDebounced) > 0 ? Number(minSolDebounced) : 0;
  const feed = useTradeFeed(launchId(l), toQuery(filters, roles, me, minSol));
  const fresh = useFreshKeys(feed.headKeys);
  const [makerDraft, setMakerDraft] = useState("");
  const makerInvalid = makerDraft.trim() !== "" && !isAddress(makerDraft.trim());
  const filtered = filters.who !== "all" || filters.side !== "all" || minSol > 0 || filters.maker !== null;
  const set = (patch: Partial<TradeFilters>) => onFilters({ ...filters, ...patch });
  const pickMaker = (wallet: string) => set({ maker: wallet, who: "all" });
  const cols = 8;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <Segmented<Who>
          size="sm"
          label="Whose trades"
          value={filters.who}
          onChange={(who) => {
            if (who === "mine" && !me) {
              setVisible(true);
              return;
            }
            set({ who, maker: null });
          }}
          items={[
            { value: "all", label: "All" },
            { value: "mine", label: "Mine" },
            { value: "creator", label: "Creator" },
            { value: "backers", label: "Backers" },
            {
              value: "agent",
              label: (
                <span className="inline-flex items-center gap-1">
                  <AgentGlyph size={12} className="text-accent" /> Agent
                </span>
              ),
            },
          ]}
        />
        <Segmented<SideFilter>
          size="sm"
          label="Trade side"
          value={filters.side}
          onChange={(side) => set({ side })}
          items={[
            { value: "all", label: "Both" },
            { value: "buy", label: "Buys" },
            { value: "sell", label: "Sells" },
          ]}
        />
        <label className={FILTER_FIELD}>
          <span className="text-ink-3">≥</span>
          <input
            aria-label="Minimum trade size in SOL"
            inputMode="decimal"
            placeholder="Min size"
            value={filters.minSol}
            onChange={(e) => set({ minSol: e.target.value.replace(/,/g, ".").replace(/[^\d.]/g, "") })}
            className="num w-16 min-w-0 bg-transparent outline-none placeholder:text-ink-3"
          />
          <span className="text-ink-3">SOL</span>
        </label>
        {filters.maker ? (
          <span className="inline-flex items-center gap-1">
            <Chip tone="ink">Maker {filters.maker.slice(0, 4)}…{filters.maker.slice(-4)}</Chip>
            <button
              type="button"
              onClick={() => set({ maker: null })}
              aria-label="Clear maker filter"
              className="inline-flex size-8 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-raised hover:text-ink pointer-coarse:size-10"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ) : (
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              const v = makerDraft.trim();
              if (!isAddress(v)) return;
              pickMaker(v);
              setMakerDraft("");
            }}
          >
            <label className={cn(FILTER_FIELD, makerInvalid && "border-down")}>
              <ListFilter className="size-3.5 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input
                aria-label="Filter by maker address"
                aria-invalid={makerInvalid || undefined}
                placeholder="Maker: paste address"
                value={makerDraft}
                onChange={(e) => setMakerDraft(e.target.value)}
                onBlur={() => {
                  const v = makerDraft.trim();
                  if (isAddress(v)) {
                    pickMaker(v);
                    setMakerDraft("");
                  }
                }}
                className="w-40 min-w-0 bg-transparent outline-none placeholder:text-ink-3"
              />
            </label>
          </form>
        )}
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={() => onFilters(NO_FILTERS)}>
            Clear
          </Button>
        ) : null}
      </div>
      {filters.who === "backers" && !filters.maker && roles.backers.length > MAX_BACKER_QUERIES ? (
        <p className="small px-4 pb-2 text-ink-3">Showing trades by the {MAX_BACKER_QUERIES} largest backers.</p>
      ) : null}

      <Table density="dense" maxHeight={480} label={`$${l.symbol} trades`}>
        <THead>
          <TH>Time</TH>
          <TH>Type</TH>
          <TH align="right">SOL</TH>
          <TH align="right">${l.symbol}</TH>
          <TH align="right" className="max-md:hidden">
            Price
          </TH>
          <TH align="right" className="max-md:hidden">
            Mcap
          </TH>
          <TH>Maker</TH>
          <TH>
            <span className="sr-only">Transaction</span>
          </TH>
        </THead>
        <tbody>
          {feed.error ? (
            <TableMessage colSpan={cols}>
              <ErrorState onRetry={feed.retry} className="m-3">
                Couldn&apos;t load trades. {feed.error}
              </ErrorState>
            </TableMessage>
          ) : feed.isLoading ? (
            <LoadingRows cols={cols} />
          ) : feed.rows.length === 0 ? (
            <TableMessage colSpan={cols}>
              {filtered ? (
                <EmptyState
                  action={
                    <Button size="sm" variant="secondary" onClick={() => onFilters(NO_FILTERS)}>
                      Clear filters
                    </Button>
                  }
                >
                  No trades match these filters.
                </EmptyState>
              ) : (
                <EmptyState>No trades yet. Be the first: the price starts at {fmtPrice(l.priceSol)} SOL.</EmptyState>
              )}
            </TableMessage>
          ) : (
            feed.rows.map((t) => {
              const key = tradeKey(t);
              return (
                <TR key={key} agent={t.isAgent} flash={fresh.has(key) ? (t.isAgent ? "agent" : t.isBuy ? "up" : "down") : undefined}>
                  <TD className="text-ink-2">
                    <RelativeTime ts={t.timestamp} now={now} />
                  </TD>
                  <TD>
                    <TypeCell t={t} />
                  </TD>
                  <TD align="right">{fmtLamports(t.solAmount)}</TD>
                  <TD align="right" className="text-ink-2">
                    {fmtTokens(t.tokenAmount)}
                  </TD>
                  <TD align="right" className="text-ink-2 max-md:hidden">
                    {fmtPrice(t.priceSol)}
                  </TD>
                  <TD align="right" className="text-ink-2 max-md:hidden">
                    {fmtSolValue(t.priceSol * SUPPLY)}
                  </TD>
                  <TD>
                    <MakerCell t={t} roles={roles} onFilter={pickMaker} />
                  </TD>
                  <TD>
                    <TxLink signature={t.signature} />
                  </TD>
                </TR>
              );
            })
          )}
          <FeedFooter feed={feed} cols={cols} />
        </tbody>
      </Table>
    </div>
  );
}
