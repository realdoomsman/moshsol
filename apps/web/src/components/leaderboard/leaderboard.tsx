"use client";

import { lamportsToSol, timeAgo } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Change } from "@/components/discover/launch-card";
import { vaultOf } from "@/components/discover/model";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { HeadlineStat, Stat, StatRow } from "@/components/ui/stat";
import { Table, TableMessage, TD, TH, THead, TR } from "@/components/ui/table";
import { Segmented, Tabs } from "@/components/ui/tabs";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { cn } from "@/components/ui/cn";
import { WalletLink } from "@/components/wallet-peek/wallet-peek";
import { fmtSolColumn, fmtSolValue } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useFallbackInterval } from "@/lib/live";
import { useLaunches, usePlatform, useStats } from "@/lib/queries";
import { clearsHeadline } from "@/lib/thresholds";
import type { LaunchSummary } from "@/lib/types";
import {
  LEADERBOARD_LIMIT,
  leaderboardQuery,
  type BackerEntry,
  type CreatorEntry,
  type LaunchEntry,
  type LeaderboardKind,
  type LeaderboardWindow,
  type TraderEntry,
} from "@/lib/users";

export const KINDS: { value: LeaderboardKind; label: string }[] = [
  { value: "backers", label: "Backers" },
  { value: "creators", label: "Creators" },
  { value: "traders", label: "Traders" },
  { value: "launches", label: "Launches" },
];

export const WINDOWS: { value: LeaderboardWindow; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "all", label: "All" },
];

const WINDOW_TEXT: Record<LeaderboardWindow, string> = { "24h": "in the last 24 hours", "7d": "in the last 7 days", all: "yet" };

const sol = (v: number) => `${fmtSolColumn(v)} SOL`;

interface Column<E> {
  label: ReactNode;
  align?: "right";
  cell: (e: E) => ReactNode;
}

interface Board<E> {
  columns: Column<E>[];
  empty: string;
  /** Row owner for the pinned "You" row. */
  wallet?: (e: E) => string;
}

function walletCell(e: { wallet: string; name: string | null; avatar: string | null }) {
  return <WalletLink wallet={e.wallet} name={e.name} avatar={e.avatar} size={24} />;
}

function launchesBoard(byMint: Map<string, LaunchSummary>): Board<LaunchEntry> {
  return {
    empty: "No launch traded",
    columns: [
      {
        label: "Launch",
        cell: (e) => (
          <Link href={`/launch/${e.mint}`} className="flex min-w-0 items-center gap-2.5 hover:text-ink">
            <TokenAvatar src={e.image} symbol={e.symbol} mint={e.mint} size={24} />
            <span className="max-w-44 truncate text-ink">{e.name}</span>
            <span className="text-ink-3">${e.symbol}</span>
          </Link>
        ),
      },
      { label: "Volume", align: "right", cell: (e) => sol(e.volumeSol) },
      { label: "Trades", align: "right", cell: (e) => e.trades },
      { label: "Mcap change", align: "right", cell: (e) => <Change value={e.mcapChangePct} /> },
      {
        label: "Backer fees paid",
        align: "right",
        cell: (e) => {
          const l = byMint.get(e.mint);
          return l ? sol(lamportsToSol(l.backerFeesAccrued)) : <span className="text-ink-3">—</span>;
        },
      },
      {
        label: "Vault value",
        align: "right",
        cell: (e) => {
          const l = byMint.get(e.mint);
          return l ? sol(vaultOf(l).valueSol) : <span className="text-ink-3">—</span>;
        },
      },
    ],
  };
}

const BACKERS: Board<BackerEntry> = {
  empty: "No backer earned fees",
  wallet: (e) => e.wallet,
  columns: [
    { label: "Backer", cell: walletCell },
    { label: "Fees earned", align: "right", cell: (e) => <span className="text-accent-ink">{sol(e.feesEarnedSol)}</span> },
    { label: "Launches backed", align: "right", cell: (e) => e.launchesBacked },
    { label: "Deposited", align: "right", cell: (e) => sol(e.depositedSol) },
  ],
};

const CREATORS: Board<CreatorEntry> = {
  empty: "No creator's launch traded or filled its raise",
  wallet: (e) => e.wallet,
  columns: [
    { label: "Creator", cell: walletCell },
    { label: "Creator fees", align: "right", cell: (e) => sol(e.creatorFeesSol) },
    { label: "Launches", align: "right", cell: (e) => (e.liveLaunches ? `${e.launches} · ${e.liveLaunches} live` : e.launches) },
    { label: "Volume", align: "right", cell: (e) => sol(e.volumeSol) },
    { label: "Raised", align: "right", cell: (e) => sol(e.raisedSol) },
  ],
};

function tradersBoard(now: number): Board<TraderEntry> {
  return {
    empty: "No one traded",
    wallet: (e) => e.wallet,
    columns: [
      { label: "Trader", cell: walletCell },
      { label: "Volume", align: "right", cell: (e) => sol(e.volumeSol) },
      {
        label: "Trades",
        align: "right",
        cell: (e) => (
          <>
            {e.trades} <span className="text-ink-3">({e.buys} buys · {e.sells} sells)</span>
          </>
        ),
      },
      { label: "Launches", align: "right", cell: (e) => e.launchesTraded },
      {
        label: "Last trade",
        align: "right",
        cell: (e) => (e.lastTradeAt ? <span className="text-ink-2">{timeAgo(e.lastTradeAt, now)}</span> : "—"),
      },
    ],
  };
}

function RankCell({ rank }: { rank: number }) {
  return (
    <TD className={cn("relative w-16", rank === 1 && "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent")}>
      <span className={rank <= 3 ? "num-l text-ink" : "text-ink-2"}>{rank}</span>
    </TD>
  );
}

function BoardTable<E extends { rank: number }>({
  board,
  entries,
  windowText,
  me,
  loading,
  error,
  onRetry,
  retrying,
  label,
}: {
  board: Board<E>;
  entries: E[] | undefined;
  windowText: string;
  me: string | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  retrying: boolean;
  label: string;
}) {
  const span = board.columns.length + 1;
  const mine = me && board.wallet ? entries?.find((e) => board.wallet!(e) === me) : undefined;
  return (
    <Table label={label} maxHeight="max(420px, calc(100dvh - 320px))">
      <THead>
        <TH className="w-16">Rank</TH>
        {board.columns.map((c, i) => (
          <TH key={i} align={c.align}>
            {c.label}
          </TH>
        ))}
      </THead>
      <tbody>
        {entries?.map((e) => (
          <TR key={e.rank}>
            <RankCell rank={e.rank} />
            {board.columns.map((c, i) => (
              <TD key={i} align={c.align}>
                {c.cell(e)}
              </TD>
            ))}
          </TR>
        ))}
        {entries && !entries.length ? (
          <TableMessage colSpan={span}>
            <EmptyState
              action={
                <ButtonLink href="/app" size="sm" variant="secondary">
                  Browse launches
                </ButtonLink>
              }
            >
              {board.empty} {windowText}.
            </EmptyState>
          </TableMessage>
        ) : null}
        {!entries && error ? (
          <TableMessage colSpan={span}>
            <ErrorState onRetry={onRetry} retrying={retrying}>
              Couldn&apos;t load the leaderboard. Indexer unreachable.
            </ErrorState>
          </TableMessage>
        ) : null}
        {!entries && loading
          ? Array.from({ length: 6 }, (_, i) => (
              <TR key={i}>
                <TD>
                  <Skeleton className="h-4 w-6" />
                </TD>
                {board.columns.map((c, j) => (
                  <TD key={j} align={c.align}>
                    <Skeleton className={cn("h-4", j === 0 ? "w-36" : "ml-auto w-16")} />
                  </TD>
                ))}
              </TR>
            ))
          : null}
        {mine ? (
          <TR className="sticky bottom-0 z-[1] [&>td]:border-t [&>td]:border-line-2 [&>td]:bg-raised" aria-label="Your rank">
            <RankCell rank={mine.rank} />
            {board.columns.map((c, i) => (
              <TD key={i} align={c.align}>
                {i === 0 ? (
                  <span className="inline-flex items-center gap-2">
                    {c.cell(mine)}
                    <span className="label text-ink-3">You</span>
                  </span>
                ) : (
                  c.cell(mine)
                )}
              </TD>
            ))}
          </TR>
        ) : null}
      </tbody>
    </Table>
  );
}

/** "Paid to backers" across all time (§4.9 hero strip), gated by §5.3. */
function HeroStrip() {
  const stats = useStats();
  const platform = usePlatform();
  const backers = useQuery(leaderboardQuery("backers", "all"));
  const paid = stats.data?.backerFeesAccruedSol;
  const count = backers.data?.entries.length;
  const showCount = clearsHeadline("backerFeesSol", paid) && count !== undefined;
  return (
    <StatRow className={showCount ? undefined : "max-md:grid-cols-1"}>
      <HeadlineStat
        stat="backerFeesSol"
        value={paid}
        label="Paid to backers"
        rule="Backer fees accrued across every launch since the first one, paid pro-rata to deposits."
        format={(v) => `${fmtSolValue(v)} SOL`}
        size="xl"
        context={{ backerFeeShareBps: platform.data?.params.backerFeeShareBps }}
      />
      {showCount && count !== undefined ? (
        <Stat label="Backers paid" value={count >= LEADERBOARD_LIMIT ? `${LEADERBOARD_LIMIT}+` : count} size="xl" />
      ) : null}
    </StatRow>
  );
}

/** Leaderboard `/leaderboard` (§4.9): backers, creators, traders and launches × 24h / 7d / all. */
export function Leaderboard({ initialKind, initialWindow }: { initialKind: LeaderboardKind; initialWindow: LeaderboardWindow }) {
  const [kind, setKind] = useState(initialKind);
  const [range, setRange] = useState(initialWindow);
  const now = useNow(30_000);
  const interval = useFallbackInterval(30_000);
  const me = useWallet().publicKey?.toBase58() ?? null;
  const board = useQuery({ ...leaderboardQuery(kind, range), refetchInterval: interval, placeholderData: (prev) => (prev?.kind === kind ? prev : undefined) });
  const launches = useLaunches({ status: "all", sort: "trending" });

  const update = (k: LeaderboardKind, w: LeaderboardWindow) => {
    setKind(k);
    setRange(w);
    const url = new URL(window.location.href);
    url.searchParams.set("kind", k);
    url.searchParams.set("window", w);
    window.history.replaceState(window.history.state, "", url);
  };

  const common = {
    windowText: WINDOW_TEXT[range],
    me,
    loading: board.isPending,
    error: board.isError,
    onRetry: () => void board.refetch(),
    retrying: board.isFetching,
    label: `${KINDS.find((k) => k.value === kind)!.label} leaderboard, ${range}`,
  };
  const data = board.data?.kind === kind ? board.data : undefined;

  let table: ReactNode;
  if (kind === "backers") {
    table = <BoardTable board={BACKERS} entries={data?.entries as BackerEntry[] | undefined} {...common} />;
  } else if (kind === "creators") {
    table = <BoardTable board={CREATORS} entries={data?.entries as CreatorEntry[] | undefined} {...common} />;
  } else if (kind === "traders") {
    table = <BoardTable board={tradersBoard(now)} entries={data?.entries as TraderEntry[] | undefined} {...common} />;
  } else {
    const byMint = new Map((launches.data?.launches ?? []).map((l) => [l.mint, l]));
    table = <BoardTable board={launchesBoard(byMint)} entries={data?.entries as LaunchEntry[] | undefined} {...common} />;
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <h1 className="display-m text-ink">Leaderboard</h1>
      <HeroStrip />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6 md:border-b md:border-line">
        <Tabs label="Leaderboard" items={KINDS} value={kind} onChange={(k) => update(k, range)} className="md:border-b-0" />
        <Segmented label="Window" size="sm" items={WINDOWS} value={range} onChange={(w) => update(kind, w)} className="md:mb-2" />
      </div>
      <section className="rounded-md border border-line bg-surface">{table}</section>
    </div>
  );
}
