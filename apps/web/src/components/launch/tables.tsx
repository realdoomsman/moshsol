"use client";

import { fmtPrice, shortAddr, timeAgo } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bot, ExternalLink } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { explorerTx } from "@/lib/explorer";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { useMounted, useNow } from "@/lib/hooks";
import {
  tradeKey,
  useAgentStatus,
  useBackers,
  useDepositFeed,
  useHolders,
  useTradeFeed,
  type PagedFeed,
} from "@/lib/queries";
import type { LaunchSummary, TradeRow } from "@/lib/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { AddressLink } from "../ui/interactive";
import { Badge, EmptyState, Meter, Skeleton } from "../ui/primitives";

const HOLDERS_PAGE = 25;
const BACKERS_PAGE = 50;
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * Keys that arrived after the first render, kept for the length of the row entrance animation.
 * Runs before paint so a new row never flashes in un-animated.
 */
function useFreshKeys(keys: string[] | undefined): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState(NO_KEYS);
  const signature = keys?.join("|");
  useLayoutEffect(() => {
    if (!keys) return;
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    const known = seen.current;
    const added = keys.filter((k) => !known.has(k));
    if (added.length === 0) return;
    for (const k of added) known.add(k);
    setFresh((prev) => new Set([...prev, ...added]));
    window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const k of added) next.delete(k);
        return next;
      });
    }, 1_400);
    // `signature` changes exactly when `keys` does.
  }, [signature]);
  return fresh;
}

/** Fixed-height scroll area with a sticky header row; the footer scrolls with the rows. */
function ScrollTable({ head, children, footer }: { head: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="max-h-[440px] overflow-auto overscroll-contain lg:max-h-[480px]">
      <table className="data-table">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {footer}
    </div>
  );
}

function LoadingRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function FeedFooter({
  count,
  noun,
  hasMore,
  loadingMore,
  loadError,
  onMore,
}: {
  count: number;
  noun: string;
  hasMore: boolean;
  loadingMore?: boolean;
  loadError?: string | null;
  onMore: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 text-xs text-dim">
      {loadError ? <span className="text-down">Couldn&apos;t load more — {loadError}</span> : null}
      {hasMore || loadError ? (
        <Button size="sm" variant="secondary" loading={loadingMore} onClick={onMore}>
          {loadError ? "Retry" : `Load older ${noun}`}
        </Button>
      ) : (
        <span>
          Showing all {count.toLocaleString("en-US")} {count === 1 ? noun.replace(/s$/, "") : noun}
        </span>
      )}
    </div>
  );
}

function PagedFooter<T>({ feed, noun }: { feed: PagedFeed<T>; noun: string }) {
  return (
    <FeedFooter
      count={feed.rows.length}
      noun={noun}
      hasMore={feed.hasMore}
      loadingMore={feed.loadingMore}
      loadError={feed.loadError}
      onMore={feed.loadMore}
    />
  );
}

function TxLink({ signature }: { signature: string }) {
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noreferrer"
      aria-label="View transaction"
      className="relative inline-flex text-dim transition before:absolute before:-inset-[13px] before:content-[''] hover:text-lime"
    >
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

function SideCell({ t }: { t: TradeRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("font-semibold", t.isBuy ? "text-up" : "text-down")}>{t.isBuy ? "Buy" : "Sell"}</span>
      {t.isAgent ? (
        <Badge tone="cyan" className="h-5 px-1.5 text-[10.5px]">
          <Bot className="size-3" aria-hidden /> Agent
        </Badge>
      ) : null}
    </span>
  );
}

function TimeCell({ ts, now }: { ts: number; now: number }) {
  // Local time zone and locale exist only in the browser; the server-rendered row omits the tooltip.
  const mounted = useMounted();
  return (
    <td className="whitespace-nowrap text-dim" title={mounted ? new Date(ts * 1000).toLocaleString() : undefined}>
      {timeAgo(ts, now)}
    </td>
  );
}

export function TradesTable({ launch: l, agentOnly }: { launch: LaunchSummary; agentOnly?: boolean }) {
  const feed = useTradeFeed(l.mint, agentOnly);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const now = useNow(5_000);
  const fresh = useFreshKeys(feed.headKeys);

  if (!feed.isLoading && feed.rows.length === 0) {
    return (
      <EmptyState art={agentOnly ? "agent" : "trades"} title={agentOnly ? "No agent trades yet" : "No trades yet"}>
        {agentOnly
          ? "Agents only trade when price leaves the EMA band and their cost-basis rules allow it."
          : "The bundle is in. Be the first public trade."}
      </EmptyState>
    );
  }

  return (
    <ScrollTable
      head={
        <>
          <th>Time</th>
          <th>Side</th>
          <th className="text-right">SOL</th>
          <th className="hidden text-right sm:table-cell">${l.symbol}</th>
          <th className="hidden text-right md:table-cell">Price</th>
          <th className="text-right">Trader</th>
          <th className="hidden w-8 sm:table-cell">
            <span className="sr-only">Transaction</span>
          </th>
        </>
      }
      footer={<PagedFooter feed={feed} noun={agentOnly ? "agent trades" : "trades"} />}
    >
      {feed.isLoading ? (
        <LoadingRows cols={7} />
      ) : (
        feed.rows.map((t) => {
          const key = tradeKey(t);
          return (
            <tr key={key} className={cn(fresh.has(key) && (t.isBuy ? "animate-row-in-up" : "animate-row-in-down"))}>
              <TimeCell ts={t.timestamp} now={now} />
              <td>
                <SideCell t={t} />
              </td>
              <td className="text-right font-medium">{fmtLamports(t.solAmount)}</td>
              <td className="hidden text-right text-muted sm:table-cell">{fmtTokens(t.tokenAmount)}</td>
              <td className="hidden text-right text-muted md:table-cell">{fmtPrice(t.priceSol)}</td>
              <td className="text-right">
                {t.isAgent ? (
                  <span className="font-mono text-[12.5px] text-cyan">vault</span>
                ) : t.trader === me ? (
                  <span className="font-mono text-[12.5px] text-lime">you</span>
                ) : (
                  <AddressLink address={t.trader} />
                )}
              </td>
              <td className="hidden sm:table-cell">
                <TxLink signature={t.signature} />
              </td>
            </tr>
          );
        })
      )}
    </ScrollTable>
  );
}

export function HoldersTable({ launch: l }: { launch: LaunchSummary }) {
  const [limit, setLimit] = useState(HOLDERS_PAGE);
  const { data, isLoading, isFetching } = useHolders(l.mint, limit);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const rows = data?.holders ?? [];
  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState art="people" title="No holders yet">
        Buy on the curve to become the first holder.
      </EmptyState>
    );
  }
  return (
    <ScrollTable
      head={
        <>
          <th className="w-10">#</th>
          <th>Holder</th>
          <th className="text-right">Amount</th>
          <th className="w-40 text-right">Share</th>
        </>
      }
      footer={
        <FeedFooter
          count={rows.length}
          noun="holders"
          hasMore={rows.length >= limit && limit < 1_000}
          loadingMore={isFetching && rows.length < limit}
          onMore={() => setLimit((n) => Math.min(1_000, n + HOLDERS_PAGE * 2))}
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={4} />
      ) : (
        rows.map((h, i) => (
          <tr key={h.owner}>
            <td className="text-dim">{i + 1}</td>
            <td>
              <span className="inline-flex items-center gap-2">
                <AddressLink address={h.owner} />
                {h.label === "curve" ? <Badge tone="neutral">Bonding curve</Badge> : null}
                {h.label === "vault" ? <Badge tone="lime">Locked vault</Badge> : null}
                {h.owner === me ? <Badge tone="violet">You</Badge> : null}
              </span>
            </td>
            <td className="text-right">{fmtTokens(h.amount)}</td>
            <td className="text-right">
              <div className="flex items-center justify-end gap-2.5">
                <Meter
                  value={h.pct}
                  tone={h.label === "vault" ? "lime" : h.label === "curve" ? "violet" : "up"}
                  className="hidden w-16 sm:block"
                />
                <span className="w-14">{h.pct.toFixed(2)}%</span>
              </div>
            </td>
          </tr>
        ))
      )}
    </ScrollTable>
  );
}

export function BackersTable({ launch: l }: { launch: LaunchSummary }) {
  const { data, isLoading } = useBackers(l.mint);
  const [shown, setShown] = useState(BACKERS_PAGE);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const all = data?.backers ?? [];
  const rows = all.slice(0, shown);
  const live = l.status === "live";
  if (!isLoading && all.length === 0) {
    return (
      <EmptyState
        art="people"
        title={l.status === "refunding" && BigInt(l.refunded) > 0n ? "All deposits refunded" : "No backers yet"}
      >
        {l.status === "refunding"
          ? "Refunded backer accounts are closed on-chain and their rent returned."
          : "Deposits during the raise fund the locked bundle and earn trading fees forever."}
      </EmptyState>
    );
  }
  return (
    <ScrollTable
      head={
        <>
          <th>Backer</th>
          <th className="text-right">Deposited</th>
          <th className="text-right">Share</th>
          {live ? <th className="hidden text-right sm:table-cell">Fees earned</th> : null}
        </>
      }
      footer={
        <FeedFooter
          count={all.length}
          noun="backers"
          hasMore={all.length > shown}
          onMore={() => setShown((n) => n + BACKERS_PAGE * 2)}
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={live ? 4 : 3} />
      ) : (
        rows.map((b) => (
          <tr key={b.owner}>
            <td>
              <span className="inline-flex items-center gap-2">
                <AddressLink address={b.owner} />
                {b.owner === me ? <Badge tone="violet">You</Badge> : null}
                {b.owner === l.creator ? <Badge tone="neutral">Creator</Badge> : null}
              </span>
            </td>
            <td className="text-right font-medium">{fmtLamports(b.deposited)} SOL</td>
            <td className="text-right text-muted">{(b.shareBps / 100).toFixed(2)}%</td>
            {live ? (
              <td className="hidden text-right sm:table-cell">
                <span className="text-up">{fmtLamports(BigInt(b.claimable) + BigInt(b.feesClaimed))}</span>
                <span className="text-dim"> SOL</span>
              </td>
            ) : null}
          </tr>
        ))
      )}
    </ScrollTable>
  );
}

export function DepositsFeed({ launch: l }: { launch: LaunchSummary }) {
  const feed = useDepositFeed(l.mint);
  const now = useNow(5_000);
  const fresh = useFreshKeys(feed.headKeys);
  if (!feed.isLoading && feed.rows.length === 0) {
    return (
      <EmptyState art="deposits" title="No deposits yet">
        Be the first backer — deposits fund the locked bundle and earn trading fees forever.
      </EmptyState>
    );
  }
  return (
    <ScrollTable
      head={
        <>
          <th>Time</th>
          <th>Backer</th>
          <th className="text-right">Amount</th>
          <th className="hidden text-right sm:table-cell">Raised after</th>
          <th className="hidden w-8 sm:table-cell">
            <span className="sr-only">Transaction</span>
          </th>
        </>
      }
      footer={<PagedFooter feed={feed} noun="deposits" />}
    >
      {feed.isLoading ? (
        <LoadingRows cols={5} />
      ) : (
        feed.rows.map((d) => {
          const key = `${d.signature}:${d.amount}`;
          return (
            <tr key={key} className={cn(fresh.has(key) && "animate-row-in")}>
              <TimeCell ts={d.timestamp} now={now} />
              <td>
                <AddressLink address={d.backer} />
              </td>
              <td className="text-right font-medium text-[#c2a6ff]">+{fmtLamports(d.amount)} SOL</td>
              <td className="hidden text-right text-muted sm:table-cell">{fmtLamports(d.raised)} SOL</td>
              <td className="hidden sm:table-cell">
                <TxLink signature={d.signature} />
              </td>
            </tr>
          );
        })
      )}
    </ScrollTable>
  );
}

/** Agent decision for this launch from the agent service, followed by its on-chain trades. */
export function AgentFeed({ launch: l }: { launch: LaunchSummary }) {
  const status = useAgentStatus();
  const now = useNow(2_000);
  const decision = status.data?.decisions.find((d) => d.mint === l.mint);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-3.5 text-[13px]">
        <span className="inline-flex items-center gap-2 font-semibold">
          <span className={cn("size-2 rounded-full", decision ? "animate-pulse-dot bg-cyan text-cyan" : "bg-dim")} />
          Agent brain
        </span>
        {decision ? (
          <>
            <Badge tone={decision.action === "buy" ? "up" : decision.action === "sell" ? "down" : "neutral"}>
              {decision.action}
            </Badge>
            <span className="min-w-0 flex-1 text-muted">{decision.reason}</span>
            <span className="text-xs text-dim">{timeAgo(decision.at, now)}</span>
            {decision.signature ? (
              <a
                className="font-mono text-xs text-muted hover:text-lime"
                href={explorerTx(decision.signature)}
                target="_blank"
                rel="noreferrer"
              >
                tx {shortAddr(decision.signature, 4)}
              </a>
            ) : null}
          </>
        ) : (
          <span className="text-dim">
            {status.isError ? "Agent service offline — on-chain limits hold regardless." : "Waiting for the next tick…"}
          </span>
        )}
      </div>
      <TradesTable launch={l} agentOnly />
    </div>
  );
}
