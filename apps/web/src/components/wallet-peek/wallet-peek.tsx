"use client";

import { shortAddr } from "@holdfast/sdk";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ListFilter } from "lucide-react";
import type { ReactNode } from "react";
import { explorerAddress } from "@/lib/explorer";
import { fmtSolValue } from "@/lib/format";
import { userQuery } from "@/lib/users";
import { Address, CopyButton } from "../ui/address";
import { Button, ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { Identicon } from "../ui/identicon";
import { Skeleton } from "../ui/skeleton";
import { Stat } from "../ui/stat";

/** "Joined Sep 2026" from a unix timestamp. */
export function fmtJoined(ts: number): string {
  return `Joined ${new Date(ts * 1000).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/** A profile name, or the short wallet address. */
export function displayName(wallet: string, name: string | null | undefined): string {
  return name || shortAddr(wallet);
}

export interface PeekExtras {
  /** Extra context row (e.g. "Net position in $MOSH"), rendered under the stats. */
  position?: ReactNode;
  /** Shows "Filter trades by this wallet" and calls this (the popover closes via outside press). */
  onFilter?: () => void;
}

/**
 * Wallet peek (brief #21b, Jupiter maker modal): who this wallet is on Holdfast — profile, joined
 * date, and what it did (created, backed, fees earned, volume) — with a link to `/u/<wallet>`.
 * Loads `GET /api/users/:wallet` when opened. Content for `Address`'s 320px `peek` popover.
 */
export function WalletPeekCard({ wallet, position, onFilter }: { wallet: string } & PeekExtras) {
  const user = useQuery(userQuery(wallet));
  const u = user.data;

  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <Identicon address={wallet} src={u?.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="h3 truncate text-ink">{u?.name ?? <span className="font-mono tracking-normal">{shortAddr(wallet)}</span>}</div>
          <div className="small flex items-center gap-1 text-ink-3">
            {u?.name ? <span className="mono truncate">{shortAddr(wallet)}</span> : null}
            {u?.name && u.stats.firstSeen ? <span aria-hidden>·</span> : null}
            {u?.stats.firstSeen ? <span className="truncate">{fmtJoined(u.stats.firstSeen)}</span> : null}
            {u && !u.stats.firstSeen && !u.name ? <span>No on-chain activity yet</span> : null}
          </div>
        </div>
        <CopyButton value={wallet} />
        <a
          href={explorerAddress(wallet)}
          target="_blank"
          rel="noreferrer"
          aria-label="View on explorer"
          title="View on explorer"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink pointer-coarse:size-10"
        >
          <ArrowUpRight className="size-4" strokeWidth={1.5} aria-hidden />
        </a>
      </div>

      {u?.bio ? <p className="small mt-3 line-clamp-2 text-ink-2">{u.bio}</p> : null}

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3">
        {u ? (
          <>
            <Stat size="m" label="Launches created" value={u.stats.launchesCreated} />
            <Stat size="m" label="Backed" value={u.stats.backedLaunches} />
            <Stat size="m" label="Backer fees" value={`${fmtSolValue(u.stats.backerFeesEarnedSol)} SOL`} />
            <Stat size="m" label="Volume" value={`${fmtSolValue(u.stats.volumeSol)} SOL`} />
          </>
        ) : user.isError ? (
          <p className="small col-span-2 text-ink-2">Couldn&apos;t load this wallet. Indexer unreachable.</p>
        ) : (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-5 w-14" />
            </div>
          ))
        )}
      </div>

      {position ? <div className="mt-3 border-t border-line pt-3">{position}</div> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={`/u/${wallet}`} size="sm" variant="secondary" arrow>
          View profile
        </ButtonLink>
        {onFilter ? (
          <Button size="sm" variant="ghost" icon={<ListFilter className="size-4" strokeWidth={1.5} />} onClick={onFilter}>
            Filter trades
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A wallet in a list (holders, trades, backers, comments, leaderboards): identicon (or avatar) +
 * profile name or short address. Clicking the name opens the wallet peek.
 *
 *   <WalletLink wallet={t.trader} name={t.name} avatar={t.avatar} />
 */
export function WalletLink({
  wallet,
  name,
  avatar,
  size = 20,
  identicon = true,
  chars = 4,
  copy = false,
  explorer = false,
  position,
  onFilter,
  className,
}: {
  wallet: string;
  name?: string | null;
  avatar?: string | null;
  /** Identicon size in px. */
  size?: number;
  identicon?: boolean;
  chars?: number;
  copy?: boolean;
  explorer?: boolean;
  className?: string;
} & PeekExtras) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      {identicon ? <Identicon address={wallet} src={avatar} size={size} /> : null}
      <Address
        address={wallet}
        chars={chars}
        label={name || undefined}
        copy={copy}
        explorer={explorer}
        peek={<WalletPeekCard wallet={wallet} position={position} onFilter={onFilter} />}
      />
    </span>
  );
}
