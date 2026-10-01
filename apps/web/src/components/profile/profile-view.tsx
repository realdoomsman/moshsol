"use client";

import { shortAddr, timeAgo } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LaunchCard, Change } from "@/components/discover/launch-card";
import { CopyButton } from "@/components/ui/address";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Identicon } from "@/components/ui/identicon";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatRow } from "@/components/ui/stat";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { fmtJoined } from "@/components/wallet-peek/wallet-peek";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { fmtLamports, fmtMcap, fmtSolValue, fmtTokens } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { launchHref, launchId, type LaunchRef } from "@/lib/launch";
import { useFallbackInterval, useLiveEvents } from "@/lib/live";
import { useLaunches, usePortfolio } from "@/lib/queries";
import type { ActivityEvent } from "@/lib/types";
import { userActivityQuery, userQuery, usersApi, USER_ACTIVITY_PAGE, type UserProfile } from "@/lib/users";
import { EditProfileDialog } from "./edit-profile";

type Tab = "created" | "backed" | "holdings" | "activity";

const sol = (v: number) => `${fmtSolValue(v)} SOL`;

function TokenCell({ l }: { l: LaunchRef & { name: string; symbol: string; image: string | null } }) {
  return (
    <Link href={launchHref(l)} className="flex min-w-0 items-center gap-2.5 hover:text-ink">
      <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={24} />
      <span className="max-w-44 truncate text-ink">{l.name}</span>
      <span className="text-ink-3">${l.symbol}</span>
    </Link>
  );
}

function Header({ user, own, onEdit }: { user: UserProfile; own: boolean; onEdit: () => void }) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <Identicon address={user.wallet} src={user.avatar} size={80} className="max-md:size-16!" />
        <div className="min-w-0">
          <h1 className="display-m truncate text-ink">{user.name ?? <span className="font-mono tracking-normal">{shortAddr(user.wallet)}</span>}</h1>
          {user.bio ? <p className="body mt-1 max-w-[60ch] text-ink-2">{user.bio}</p> : null}
          <div className="small mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-3">
            {user.stats.firstSeen ? <span>{fmtJoined(user.stats.firstSeen)}</span> : <span>No on-chain activity yet</span>}
            <span className="mono inline-flex items-center gap-1 text-ink-2">
              {shortAddr(user.wallet, 6)}
              <CopyButton value={user.wallet} />
            </span>
            <a
              href={explorerAddress(user.wallet)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1 text-ink-2 transition-colors hover:text-ink md:min-h-0"
            >
              Explorer <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
            </a>
          </div>
        </div>
      </div>
      {own ? (
        <Button variant="secondary" size="sm" icon={<Pencil className="size-4" strokeWidth={1.5} />} onClick={onEdit} className="self-start">
          Edit profile
        </Button>
      ) : null}
    </header>
  );
}

function Stats({ user }: { user: UserProfile }) {
  const s = user.stats;
  // Zeros are real values, but they shouldn't read as loudly as the numbers this wallet has.
  const quiet = (v: number, text: ReactNode) => (v ? text : <span className="text-ink-3">{text}</span>);
  return (
    <StatRow className="rounded-md border-x bg-surface">
      <Stat label="Launches created" value={quiet(s.launchesCreated, s.launchesCreated)} />
      <Stat
        label="Raised for launches"
        rule="SOL raised by this wallet's launches that aren't refunding, including open raises."
        value={quiet(s.raisedSol, sol(s.raisedSol))}
      />
      <Stat
        label="Backed launches"
        value={quiet(s.backedLaunches, s.backedLaunches)}
        sub={s.depositedSol ? `${fmtSolValue(s.depositedSol)} SOL deposited` : undefined}
      />
      <Stat
        label="Backer earnings"
        rule="Claimed plus claimable backer earnings (fee share, vault agent profit, wind-down payouts), pro-rata to this wallet's deposits."
        value={quiet(s.backerFeesEarnedSol, sol(s.backerFeesEarnedSol))}
        tone={s.backerFeesEarnedSol > 0 ? "accent" : undefined}
      />
      <Stat
        label="Trading volume"
        rule="SOL traded on the curve by this wallet. Vault-agent trades excluded."
        value={quiet(s.volumeSol, sol(s.volumeSol))}
        sub={s.trades ? `${s.trades} trades` : undefined}
      />
      <Stat label="Comments" value={quiet(s.comments, s.comments)} />
    </StatRow>
  );
}

function Created({ user, own }: { user: UserProfile; own: boolean }) {
  const now = useNow(15_000);
  const launches = useLaunches({ status: "all", sort: "trending" });
  if (!user.launches.length) {
    return (
      <EmptyState
        action={
          own ? (
            <ButtonLink href="/create" size="sm" variant="secondary">
              Create a launch
            </ButtonLink>
          ) : undefined
        }
      >
        {own ? "You haven't created a launch yet." : "This wallet hasn't created a launch."}
      </EmptyState>
    );
  }
  const byAddress = new Map((launches.data?.launches ?? []).map((l) => [l.address, l]));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {user.launches.map((u) => {
        const l = byAddress.get(u.address);
        if (l) return <LaunchCard key={u.address} launch={l} now={now} />;
        return (
          <Link
            key={u.address}
            href={launchHref(u)}
            className="flex items-center gap-3 rounded-md border border-line bg-surface p-4 transition-colors hover:border-line-2 hover:bg-raised"
          >
            <TokenAvatar src={u.image} symbol={u.symbol} mint={u.mint} size={56} />
            <div className="min-w-0 flex-1">
              <div className="h3 truncate text-ink">{u.name}</div>
              <div className="small text-ink-3">
                ${u.symbol} · raised {sol(u.raisedSol)}
              </div>
            </div>
            <StatusChip status={u.status} />
          </Link>
        );
      })}
    </div>
  );
}

function Backed({ user }: { user: UserProfile }) {
  return (
    <section className="rounded-md border border-line bg-surface">
      <Table label="Backed launches">
        <THead>
          <TH>Launch</TH>
          <TH>Status</TH>
          <TH align="right">Deposited</TH>
          <TH align="right">Share</TH>
          <TH align="right">Fees earned</TH>
          <TH align="right">Claimable</TH>
          <TH align="right">Backed</TH>
        </THead>
        <tbody>
          {user.backed.map((b) => (
            <TR key={b.address}>
              <TD>
                <TokenCell l={b} />
              </TD>
              <TD>
                <StatusChip status={b.status} />
              </TD>
              <TD align="right">{sol(b.depositedSol)}</TD>
              <TD align="right">{(b.shareBps / 100).toFixed(b.shareBps % 100 ? 2 : 0)}%</TD>
              <TD align="right" className="text-accent-ink">
                {sol(b.feesEarnedSol)}
              </TD>
              <TD align="right">{sol(b.feesClaimableSol)}</TD>
              <TD align="right" className="text-ink-2">
                {timeAgo(b.firstDepositAt)}
              </TD>
            </TR>
          ))}
          {!user.backed.length ? (
            <TableMessage colSpan={7}>
              <EmptyState>This wallet hasn&apos;t backed a raise yet.</EmptyState>
            </TableMessage>
          ) : null}
        </tbody>
      </Table>
    </section>
  );
}

function Holdings({ wallet }: { wallet: string }) {
  const portfolio = usePortfolio(wallet);
  const holdings = (portfolio.data?.holdings ?? []).slice().sort((a, b) => b.valueSol - a.valueSol);
  return (
    <section className="rounded-md border border-line bg-surface">
      <Table label="Holdings">
        <THead>
          <TH>Token</TH>
          <TH align="right">Balance</TH>
          <TH align="right">Value</TH>
          <TH align="right">Mcap</TH>
          <TH align="right">24h</TH>
        </THead>
        <tbody>
          {holdings.map((h) => (
            <TR key={launchId(h.launch)}>
              <TD>
                <TokenCell l={h.launch} />
              </TD>
              <TD align="right">{fmtTokens(h.amount)}</TD>
              <TD align="right">{sol(h.valueSol)}</TD>
              <TD align="right">{fmtMcap(h.launch)}</TD>
              <TD align="right">
                <Change value={h.launch.change24h} />
              </TD>
            </TR>
          ))}
          {portfolio.data && !holdings.length ? (
            <TableMessage colSpan={5}>
              <EmptyState>No Holdfast tokens in this wallet.</EmptyState>
            </TableMessage>
          ) : null}
          {portfolio.isError && !portfolio.data ? (
            <TableMessage colSpan={5}>
              <ErrorState onRetry={() => void portfolio.refetch()} retrying={portfolio.isFetching}>
                Couldn&apos;t load holdings. The indexer couldn&apos;t reach the RPC.
              </ErrorState>
            </TableMessage>
          ) : null}
          {portfolio.isPending
            ? Array.from({ length: 3 }, (_, i) => (
                <TR key={i}>
                  {Array.from({ length: 5 }, (_, j) => (
                    <TD key={j} align={j ? "right" : "left"}>
                      <Skeleton className={j ? "ml-auto h-4 w-16" : "h-4 w-36"} />
                    </TD>
                  ))}
                </TR>
              ))
            : null}
        </tbody>
      </Table>
    </section>
  );
}

/** One activity line, from the wallet's point of view. */
function describe(e: ActivityEvent): string {
  const amount = e.solAmount ? `${fmtLamports(e.solAmount)} SOL` : "";
  const tick = `$${e.symbol}`;
  switch (e.type) {
    case "trade":
      return e.isBuy ? `Bought ${tick} for ${amount}` : `Sold ${tick} for ${amount}`;
    case "deposit":
      return `Backed ${tick} with ${amount}`;
    case "launch_created":
      return `Created ${tick}`;
    case "launched":
      return `${tick} launched`;
    case "refund":
      return `Refunded ${amount} from ${tick}`;
    case "cancelled":
      return `${tick} raise cancelled`;
    case "backer_claim":
      return `Claimed ${amount} in backer earnings from ${tick}`;
    case "creator_claim":
      return `Claimed ${amount} in creator fees from ${tick}`;
    case "profit_shared":
      return `${tick} vault agent shared ${amount} of profit with backers`;
    case "wound_down":
      return `${tick} wound down: ${amount} credited to backers`;
    case "vault_withdrawn":
      return `Admin withdrew ${amount}${e.tokenAmount && BigInt(e.tokenAmount) > 0n ? ` + ${fmtTokens(e.tokenAmount)} ${tick}` : ""} from the ${tick} vault`;
    case "creator_fees_collected":
      return `Collected ${amount} of pump.fun creator fees for ${tick}`;
    case "buyback_burned":
      return `${tick} spent ${amount} of its buyback pool${e.tokenAmount && BigInt(e.tokenAmount) > 0n ? ` and burned ${fmtTokens(e.tokenAmount)}` : ""}`;
    case "graduated":
      return `${tick} graduated to PumpSwap`;
    case "migrated":
      return `${tick} migrated to the current program layout`;
  }
}

function Activity({ wallet }: { wallet: string }) {
  const now = useNow(30_000);
  const interval = useFallbackInterval(15_000);
  const head = useQuery({ ...userActivityQuery(wallet), refetchInterval: interval });
  const [older, setOlder] = useState<{ events: ActivityEvent[]; cursor: number | null } | null>(null);
  const [loading, setLoading] = useState(false);

  const headEvents = head.data?.events ?? [];
  const seen = new Set(headEvents.map((e) => e.id));
  const events = [...headEvents, ...(older?.events.filter((e) => !seen.has(e.id)) ?? [])];
  const cursor = older ? older.cursor : (head.data?.nextBefore ?? null);

  const loadMore = async () => {
    if (cursor === null || loading) return;
    setLoading(true);
    try {
      const page = await usersApi.activity(wallet, { limit: USER_ACTIVITY_PAGE, before: cursor });
      setOlder((o) => ({ events: [...(o?.events ?? []), ...page.events], cursor: page.nextBefore }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-md border border-line bg-surface">
      <Table label="Activity" density="dense">
        <tbody>
          {events.map((e) => (
            <TR key={String(e.id)}>
              <TD className="w-full max-md:whitespace-normal">
                <Link href={launchHref(e)} className="flex min-w-0 items-center gap-2.5 hover:text-ink">
                  <TokenAvatar src={e.image} symbol={e.symbol} mint={e.mint} size={24} />
                  <span className={e.type === "trade" ? (e.isBuy ? "text-up" : "text-down") : "text-ink"}>{describe(e)}</span>
                </Link>
              </TD>
              <TD align="right" className="text-ink-3">
                {timeAgo(e.timestamp, now)}
              </TD>
              <TD align="right">
                <a
                  href={explorerTx(e.signature)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View transaction on explorer"
                  className="relative inline-flex text-ink-3 transition-colors before:absolute before:-inset-3 hover:text-ink"
                >
                  <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
                </a>
              </TD>
            </TR>
          ))}
          {head.data && !events.length ? (
            <TableMessage colSpan={3}>
              <EmptyState>No on-chain activity yet.</EmptyState>
            </TableMessage>
          ) : null}
          {head.isError && !head.data ? (
            <TableMessage colSpan={3}>
              <ErrorState onRetry={() => void head.refetch()} retrying={head.isFetching}>
                Couldn&apos;t load activity. Indexer unreachable.
              </ErrorState>
            </TableMessage>
          ) : null}
        </tbody>
      </Table>
      {events.length ? <LoadMore hasMore={cursor !== null} loading={loading} onLoadMore={() => void loadMore()} /> : null}
    </section>
  );
}

/** Profile `/u/[wallet]` (§4.8): header, stats row, Created · Backed · Holdings · Activity. */
export function ProfileView({ wallet, startEditing }: { wallet: string; startEditing: boolean }) {
  const qc = useQueryClient();
  const interval = useFallbackInterval(15_000);
  const user = useQuery({ ...userQuery(wallet), refetchInterval: interval });
  const me = useWallet().publicKey?.toBase58();
  const own = me === wallet;
  /** Null until the visitor picks a tab: then the first of Created · Backed with rows, else Activity. */
  const [picked, setTab] = useState<Tab | null>(null);
  const [editRequested, setEditRequested] = useState(startEditing);
  const portfolio = usePortfolio(wallet);

  useLiveEvents((e) => {
    if (e.actor !== wallet) return;
    void qc.invalidateQueries({ queryKey: ["user", wallet] });
    void qc.invalidateQueries({ queryKey: ["user-activity", wallet] });
  });

  if (!user.data) {
    if (user.isError) {
      return (
        <ErrorState onRetry={() => void user.refetch()} retrying={user.isFetching}>
          Couldn&apos;t load this profile. Indexer unreachable.
        </ErrorState>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-full" />
          <div>
            <Skeleton className="h-8 w-56" />
            <Skeleton className="mt-3 h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const u = user.data;
  const tab: Tab = picked ?? (u.launches.length ? "created" : u.backed.length ? "backed" : "activity");
  const editOpen = own && editRequested;
  const closeEdit = (open: boolean) => {
    setEditRequested(open);
    if (!open && startEditing) {
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      window.history.replaceState(window.history.state, "", url);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Header user={u} own={own} onEdit={() => setEditRequested(true)} />
      <Stats user={u} />
      <div>
        <Tabs
          label="Profile sections"
          value={tab}
          onChange={setTab}
          items={[
            { value: "created", label: "Created", count: u.launches.length },
            { value: "backed", label: "Backed", count: u.backed.length },
            { value: "holdings", label: "Holdings", count: portfolio.data?.holdings.length },
            { value: "activity", label: "Activity" },
          ]}
        />
        <div className="mt-4" role="tabpanel">
          {tab === "created" ? <Created user={u} own={own} /> : null}
          {tab === "backed" ? <Backed user={u} /> : null}
          {tab === "holdings" ? <Holdings wallet={wallet} /> : null}
          {tab === "activity" ? <Activity wallet={wallet} /> : null}
        </div>
      </div>
      {own ? <EditProfileDialog key={u.profileUpdatedAt ?? 0} user={u} open={editOpen} onOpenChange={closeEdit} /> : null}
    </div>
  );
}
