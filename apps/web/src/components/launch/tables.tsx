"use client";

import { fmtPrice, shortAddr, timeAgo } from "@moshsol/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bot, ExternalLink, Inbox } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { explorerTx } from "@/lib/explorer";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useAgentStatus, useBackers, useDeposits, useHolders, useTrades } from "@/lib/queries";
import type { LaunchSummary, TradeRow } from "@/lib/types";
import { cn } from "../ui/cn";
import { AddressLink } from "../ui/interactive";
import { Badge, EmptyState, Meter, Skeleton } from "../ui/primitives";

const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-dim first:pl-5 last:pr-5";
const td = "px-3 py-2.5 first:pl-5 last:pr-5";

/** Marks keys that appear after the first render so new rows can flash. */
function useFreshKeys(keys: string[] | undefined): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (keys) {
    if (seen.current) for (const k of keys) if (!seen.current.has(k)) fresh.add(k);
  }
  useEffect(() => {
    if (!keys) return;
    seen.current ??= new Set();
    for (const k of keys) seen.current.add(k);
  }, [keys]);
  return fresh;
}

function TableShell({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full text-[13px]">
        <thead className="border-b border-line">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j} className={td}>
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function TxLink({ signature }: { signature: string }) {
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noreferrer"
      aria-label="View transaction"
      className="inline-flex text-dim transition hover:text-lime"
    >
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

function SideBadge({ t }: { t: TradeRow }) {
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

export function TradesTable({ launch: l, agentOnly }: { launch: LaunchSummary; agentOnly?: boolean }) {
  const { data, isLoading } = useTrades(l.mint, 100);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const now = useNow(5_000);
  const rows = (data?.trades ?? []).filter((t) => !agentOnly || t.isAgent);
  const fresh = useFreshKeys(data?.trades.map((t) => t.signature));

  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState icon={agentOnly ? <Bot className="size-5" aria-hidden /> : <Inbox className="size-5" aria-hidden />} title={agentOnly ? "No agent trades yet" : "No trades yet"}>
        {agentOnly
          ? "Agents only trade when price leaves the EMA band and their cost-basis rules allow it."
          : "Be the first to trade after the bundle."}
      </EmptyState>
    );
  }

  return (
    <TableShell
      head={
        <>
          <th className={th}>Time</th>
          <th className={th}>Side</th>
          <th className={cn(th, "text-right")}>SOL</th>
          <th className={cn(th, "hidden text-right sm:table-cell")}>${l.symbol}</th>
          <th className={cn(th, "hidden text-right md:table-cell")}>Price</th>
          <th className={cn(th, "text-right")}>Trader</th>
          <th className={cn(th, "hidden w-8 sm:table-cell")}>
            <span className="sr-only">Transaction</span>
          </th>
        </>
      }
    >
      {isLoading ? (
        <LoadingRows cols={7} />
      ) : (
        rows.map((t) => (
          <tr key={t.signature} className={cn("transition-colors hover:bg-white/[0.025]", fresh.has(t.signature) && "animate-flash")}>
            <td className={cn(td, "whitespace-nowrap text-dim tabular-nums")}>{timeAgo(t.timestamp, now)}</td>
            <td className={td}>
              <SideBadge t={t} />
            </td>
            <td className={cn(td, "text-right font-medium tabular-nums")}>{fmtLamports(t.solAmount)}</td>
            <td className={cn(td, "hidden text-right tabular-nums text-muted sm:table-cell")}>{fmtTokens(t.tokenAmount)}</td>
            <td className={cn(td, "hidden text-right tabular-nums text-muted md:table-cell")}>{fmtPrice(t.priceSol)}</td>
            <td className={cn(td, "text-right")}>
              {t.isAgent ? (
                <span className="font-mono text-[12.5px] text-cyan">vault</span>
              ) : t.trader === me ? (
                <span className="font-mono text-[12.5px] text-lime">you</span>
              ) : (
                <AddressLink address={t.trader} />
              )}
            </td>
            <td className={cn(td, "hidden sm:table-cell")}>
              <TxLink signature={t.signature} />
            </td>
          </tr>
        ))
      )}
    </TableShell>
  );
}

export function HoldersTable({ launch: l }: { launch: LaunchSummary }) {
  const { data, isLoading } = useHolders(l.mint);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const rows = data?.holders ?? [];
  if (!isLoading && rows.length === 0) {
    return <EmptyState icon={<Inbox className="size-5" aria-hidden />} title="No holders yet" />;
  }
  return (
    <TableShell
      head={
        <>
          <th className={cn(th, "w-10")}>#</th>
          <th className={th}>Holder</th>
          <th className={cn(th, "text-right")}>Amount</th>
          <th className={cn(th, "w-40 text-right")}>Share</th>
        </>
      }
    >
      {isLoading ? (
        <LoadingRows cols={4} />
      ) : (
        rows.map((h, i) => (
          <tr key={h.owner} className="hover:bg-white/[0.025]">
            <td className={cn(td, "text-dim tabular-nums")}>{i + 1}</td>
            <td className={td}>
              <span className="inline-flex items-center gap-2">
                <AddressLink address={h.owner} />
                {h.label === "curve" ? <Badge tone="neutral">Bonding curve</Badge> : null}
                {h.label === "vault" ? <Badge tone="lime">Locked vault</Badge> : null}
                {h.owner === me ? <Badge tone="violet">You</Badge> : null}
              </span>
            </td>
            <td className={cn(td, "text-right tabular-nums")}>{fmtTokens(h.amount)}</td>
            <td className={cn(td, "text-right")}>
              <div className="flex items-center justify-end gap-2.5">
                <Meter
                  value={h.pct}
                  tone={h.label === "vault" ? "lime" : h.label === "curve" ? "violet" : "up"}
                  className="hidden w-16 sm:block"
                />
                <span className="w-14 tabular-nums">{h.pct.toFixed(2)}%</span>
              </div>
            </td>
          </tr>
        ))
      )}
    </TableShell>
  );
}

export function BackersTable({ launch: l }: { launch: LaunchSummary }) {
  const { data, isLoading } = useBackers(l.mint);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const rows = data?.backers ?? [];
  const live = l.status === "live";
  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="size-5" aria-hidden />}
        title={l.status === "refunding" && BigInt(l.refunded) > 0n ? "All deposits refunded" : "No backers yet"}
      >
        {l.status === "refunding"
          ? "Refunded backer accounts are closed on-chain and their rent returned."
          : "Deposits during the raise fund the locked bundle and earn trading fees forever."}
      </EmptyState>
    );
  }
  return (
    <TableShell
      head={
        <>
          <th className={th}>Backer</th>
          <th className={cn(th, "text-right")}>Deposited</th>
          <th className={cn(th, "text-right")}>Share</th>
          {live ? <th className={cn(th, "hidden text-right sm:table-cell")}>Fees earned</th> : null}
        </>
      }
    >
      {isLoading ? (
        <LoadingRows cols={live ? 4 : 3} />
      ) : (
        rows.map((b) => (
          <tr key={b.owner} className="hover:bg-white/[0.025]">
            <td className={td}>
              <span className="inline-flex items-center gap-2">
                <AddressLink address={b.owner} />
                {b.owner === me ? <Badge tone="violet">You</Badge> : null}
                {b.owner === l.creator ? <Badge tone="neutral">Creator</Badge> : null}
              </span>
            </td>
            <td className={cn(td, "text-right font-medium tabular-nums")}>{fmtLamports(b.deposited)} SOL</td>
            <td className={cn(td, "text-right tabular-nums text-muted")}>{(b.shareBps / 100).toFixed(2)}%</td>
            {live ? (
              <td className={cn(td, "hidden text-right tabular-nums sm:table-cell")}>
                <span className="text-up">{fmtLamports(BigInt(b.claimable) + BigInt(b.feesClaimed))}</span>
                <span className="text-dim"> SOL</span>
              </td>
            ) : null}
          </tr>
        ))
      )}
    </TableShell>
  );
}

export function DepositsFeed({ launch: l }: { launch: LaunchSummary }) {
  const { data, isLoading } = useDeposits(l.mint);
  const now = useNow(5_000);
  const rows = data?.deposits ?? [];
  const fresh = useFreshKeys(data?.deposits.map((d) => d.signature));
  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState icon={<Inbox className="size-5" aria-hidden />} title="No deposits yet">
        Be the first backer.
      </EmptyState>
    );
  }
  return (
    <TableShell
      head={
        <>
          <th className={th}>Time</th>
          <th className={th}>Backer</th>
          <th className={cn(th, "text-right")}>Amount</th>
          <th className={cn(th, "hidden text-right sm:table-cell")}>Raised after</th>
          <th className={cn(th, "hidden w-8 sm:table-cell")}>
            <span className="sr-only">Transaction</span>
          </th>
        </>
      }
    >
      {isLoading ? (
        <LoadingRows cols={5} />
      ) : (
        rows.map((d) => (
          <tr key={d.signature} className={cn("hover:bg-white/[0.025]", fresh.has(d.signature) && "animate-flash")}>
            <td className={cn(td, "whitespace-nowrap text-dim tabular-nums")}>{timeAgo(d.timestamp, now)}</td>
            <td className={td}>
              <AddressLink address={d.backer} />
            </td>
            <td className={cn(td, "text-right font-medium text-[#c2a6ff] tabular-nums")}>+{fmtLamports(d.amount)} SOL</td>
            <td className={cn(td, "hidden text-right tabular-nums text-muted sm:table-cell")}>{fmtLamports(d.raised)} SOL</td>
            <td className={cn(td, "hidden sm:table-cell")}>
              <TxLink signature={d.signature} />
            </td>
          </tr>
        ))
      )}
    </TableShell>
  );
}

/** Agent decisions for this launch from the agent service, followed by its on-chain trades. */
export function AgentFeed({ launch: l }: { launch: LaunchSummary }) {
  const status = useAgentStatus();
  const now = useNow(2_000);
  const decision = status.data?.decisions.find((d) => d.mint === l.mint);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 text-[13px]">
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
            <span className="text-xs text-dim tabular-nums">{timeAgo(decision.at, now)}</span>
          </>
        ) : (
          <span className="text-dim">
            {status.isError ? "Agent service offline — on-chain limits hold regardless." : "Waiting for the next tick…"}
          </span>
        )}
      </div>
      <TradesTable launch={l} agentOnly />
      {decision?.signature ? (
        <div className="border-t border-line px-5 py-3 text-xs text-dim">
          Latest agent tx{" "}
          <a className="font-mono text-muted hover:text-lime" href={explorerTx(decision.signature)} target="_blank" rel="noreferrer">
            {shortAddr(decision.signature, 8)}
          </a>
        </div>
      ) : null}
    </div>
  );
}
