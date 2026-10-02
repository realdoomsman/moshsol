"use client";

import { timeAgo } from "@holdfast/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { launchHref, launchId, type LaunchRef } from "@/lib/launch";
import { fmtMult, pumpSplit } from "@/lib/pump-terms";
import { usePlatform } from "@/lib/queries";
import { TX_STAGE_LABEL, type TxStage } from "@/lib/tx";
import type { ActivityEvent, LaunchSummary, PortfolioBacked, PortfolioCreated, PortfolioHolding } from "@/lib/types";
import { USER_ACTIVITY_PAGE, userActivityQuery, usersApi } from "@/lib/users";
import { Change } from "../discover/launch-card";
import { chipStatus } from "../discover/model";
import { Address } from "../ui/address";
import { Button, ButtonLink } from "../ui/button";
import { StatusChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { LoadMore, Table, TD, TH, THead, TR } from "../ui/table";
import { TokenAvatar } from "../ui/token-avatar";

export interface PositionActions {
  /** The connected wallet owns these positions (read-only lookups get no buttons). */
  own: boolean;
  pending: string | null;
  stage: TxStage | null;
  claimBacker: (b: PortfolioBacked) => void;
  claimCreator: (c: PortfolioCreated) => void;
  refund: (b: PortfolioBacked) => void;
}

export const claimBackerLabel = (l: LaunchSummary) => `Claim $${l.symbol} backer earnings`;
export const claimCreatorLabel = (l: LaunchSummary) => `Claim $${l.symbol} creator fees`;
export const refundLabel = (l: LaunchSummary) => `Refund $${l.symbol}`;

function LaunchCell({ l, size = 32 }: { l: LaunchRef & Pick<LaunchSummary, "name" | "symbol" | "image">; size?: number }) {
  return (
    <Link href={launchHref(l)} className="group flex min-w-0 items-center gap-3">
      <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={size} />
      <span className="min-w-0">
        <span className="ui block truncate text-ink group-hover:underline group-hover:decoration-ink-3/60 group-hover:underline-offset-2">
          {l.name}
        </span>
        <span className="small block text-ink-3">${l.symbol}</span>
      </span>
    </Link>
  );
}

/** A two-line list row for narrow screens (§4.7 mobile): launch, a figures line, the action on the right. */
function ListRow({ l, figures, action }: { l: LaunchSummary | ActivityEvent; figures: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="grid min-w-0 flex-1 gap-1.5">
        <LaunchCell l={l} size={36} />
        <div className="small num flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 pl-12 text-ink-2">{figures}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

function ActionButton({
  label,
  actions,
  disabled,
  variant = "secondary",
  children,
  onClick,
}: {
  label: string;
  actions: PositionActions;
  disabled?: boolean;
  variant?: "secondary" | "primary";
  children: ReactNode;
  onClick: () => void;
}) {
  const busy = actions.pending === label;
  return (
    <Button
      size="sm"
      variant={variant}
      busy={busy}
      disabled={disabled || (actions.pending !== null && !busy)}
      onClick={onClick}
    >
      {busy && actions.stage ? TX_STAGE_LABEL[actions.stage] : children}
    </Button>
  );
}

/* ------------------------------------------------------------------ Backed */

export function BackedPanel({ rows, actions, now }: { rows: PortfolioBacked[]; actions: PositionActions; now: number }) {
  const params = usePlatform().data?.params;
  if (!rows.length) {
    const split = pumpSplit(params);
    return (
      <EmptyState action={<ButtonLink href="/app" size="sm" variant="secondary">Find a raise</ButtonLink>}>
        No backed launches.
        {params
          ? params.holdfastCurveEnabled
            ? ` Backers earn ${params.backerFeeShareBps / 100}% of every trade fee; when the vault is ${fmtMult(split.payoutMult)} its start and the chart is strong, the vault agent may pay them back.`
            : ` Backers earn ${split.backerPct}% of a launch's pump.fun creator fees; when the vault is ${fmtMult(split.payoutMult)} its start and the chart is strong, the vault agent may pay them back.`
          : ""}
      </EmptyState>
    );
  }
  const action = (b: PortfolioBacked) => {
    if (!actions.own) return null;
    const claimable = BigInt(b.claimable);
    if (b.launch.status === "raising") return <span className="small text-ink-3">Raising</span>;
    return (
      <ActionButton
        label={claimBackerLabel(b.launch)}
        actions={actions}
        disabled={claimable === 0n}
        onClick={() => actions.claimBacker(b)}
      >
        {claimable > 0n ? `Claim ${fmtLamports(claimable)}` : "Nothing yet"}
      </ActionButton>
    );
  };
  const vaultShare = (b: PortfolioBacked) =>
    b.launch.status === "live" ? `${fmtSolValue(b.vaultShareSol)} SOL + ${fmtTokens(b.vaultShareTokens * 1e6)}` : "—";
  // Payback so far, pro rata; the fields are absent from an indexer that predates the payback model.
  const repaid = (b: PortfolioBacked) => ((b.launch.backersRepaidSol ?? 0) * b.shareBps) / 10_000;
  const dividends = (b: PortfolioBacked) => ((b.launch.backerPayoutsSol ?? 0) * b.shareBps) / 10_000;
  return (
    <>
      <ul className="md:hidden">
        {rows.map((b) => (
          <ListRow
            key={launchId(b.launch)}
            l={b.launch}
            figures={
              <>
                <span>{fmtLamports(b.deposited)} SOL in</span>
                <span>{(b.shareBps / 100).toFixed(2)}% share</span>
                <span className={BigInt(b.claimable) > 0n ? "text-accent-ink" : undefined}>
                  {fmtLamports(b.claimable)} claimable
                </span>
              </>
            }
            action={action(b)}
          />
        ))}
      </ul>
      <Table label="Backed launches" className="hidden md:block">
        <THead>
          <TH>Launch</TH>
          <TH>Status</TH>
          <TH align="right">Deposited</TH>
          <TH align="right">Share</TH>
          <TH align="right" className="hidden xl:table-cell">
            Vault share
          </TH>
          <TH align="right" className="hidden lg:table-cell">
            Principal repaid
          </TH>
          <TH align="right" className="hidden lg:table-cell">
            Dividends
          </TH>
          <TH align="right">Earned</TH>
          <TH align="right">Claimable</TH>
          {actions.own ? (
            <TH align="right">
              <span className="sr-only">Action</span>
            </TH>
          ) : null}
        </THead>
        <tbody>
          {rows.map((b) => {
            const claimable = BigInt(b.claimable);
            return (
              <TR key={launchId(b.launch)}>
                <TD>
                  <LaunchCell l={b.launch} />
                </TD>
                <TD>
                  <StatusChip status={chipStatus(b.launch, now)} />
                </TD>
                <TD align="right">{fmtLamports(b.deposited)} SOL</TD>
                <TD align="right">{(b.shareBps / 100).toFixed(2)}%</TD>
                <TD align="right" className="hidden text-ink-2 xl:table-cell">
                  {vaultShare(b)}
                </TD>
                <TD align="right" className="hidden text-ink-2 lg:table-cell">
                  {fmtSolValue(repaid(b))} SOL
                </TD>
                <TD align="right" className="hidden text-ink-2 lg:table-cell">
                  {fmtSolValue(dividends(b))} SOL
                </TD>
                <TD align="right" className="text-ink-2">
                  {fmtLamports(BigInt(b.feesClaimed) + claimable)} SOL
                </TD>
                <TD align="right" className={claimable > 0n ? "text-accent-ink" : "text-ink-3"}>
                  {fmtLamports(claimable)} SOL
                </TD>
                {actions.own ? <TD align="right">{action(b)}</TD> : null}
              </TR>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}

/* ----------------------------------------------------------------- Created */

export function CreatedPanel({ rows, actions, now }: { rows: PortfolioCreated[]; actions: PositionActions; now: number }) {
  const params = usePlatform().data?.params;
  if (!rows.length) {
    return (
      <EmptyState action={<ButtonLink href="/create" size="sm" variant="secondary">Create a launch</ButtonLink>}>
        No launches created.
        {params
          ? params.holdfastCurveEnabled
            ? ` Creators earn ${params.creatorFeeShareBps / 100}% of every trade fee on their launch.`
            : " New launches are pump.fun tokens; the launch itself collects pump.fun's creator fees for its vault, the buyback pool and its backers. The creator takes 0%."
          : ""}
      </EmptyState>
    );
  }
  const action = (c: PortfolioCreated) => {
    if (!actions.own) return null;
    const fees = BigInt(c.creatorFeesUnclaimed);
    return (
      <ActionButton
        label={claimCreatorLabel(c.launch)}
        actions={actions}
        disabled={fees === 0n}
        onClick={() => actions.claimCreator(c)}
      >
        {fees > 0n ? `Claim ${fmtLamports(fees)}` : "Nothing yet"}
      </ActionButton>
    );
  };
  return (
    <>
      <ul className="md:hidden">
        {rows.map((c) => (
          <ListRow
            key={launchId(c.launch)}
            l={c.launch}
            figures={
              <>
                <span>{fmtLamports(c.launch.raised)} SOL raised</span>
                <span className={BigInt(c.creatorFeesUnclaimed) > 0n ? "text-accent-ink" : undefined}>
                  {fmtLamports(c.creatorFeesUnclaimed)} claimable
                </span>
              </>
            }
            action={action(c)}
          />
        ))}
      </ul>
      <Table label="Created launches" className="hidden md:block">
        <THead>
          <TH>Launch</TH>
          <TH>Status</TH>
          <TH align="right">Raised</TH>
          <TH align="right">Volume 24h</TH>
          <TH align="right">Fees claimed</TH>
          <TH align="right">Claimable</TH>
          {actions.own ? (
            <TH align="right">
              <span className="sr-only">Action</span>
            </TH>
          ) : null}
        </THead>
        <tbody>
          {rows.map((c) => {
            const fees = BigInt(c.creatorFeesUnclaimed);
            return (
              <TR key={launchId(c.launch)}>
                <TD>
                  <LaunchCell l={c.launch} />
                </TD>
                <TD>
                  <StatusChip status={chipStatus(c.launch, now)} />
                </TD>
                <TD align="right">{fmtLamports(c.launch.raised)} SOL</TD>
                <TD align="right" className="text-ink-2">
                  {fmtSolValue(c.launch.volume24hSol)} SOL
                </TD>
                <TD align="right" className="text-ink-2">
                  {fmtLamports(c.creatorFeesClaimed)} SOL
                </TD>
                <TD align="right" className={fees > 0n ? "text-accent-ink" : "text-ink-3"}>
                  {fmtLamports(fees)} SOL
                </TD>
                {actions.own ? <TD align="right">{action(c)}</TD> : null}
              </TR>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}

/* ----------------------------------------------------------------- Refunds */

export function RefundsPanel({
  rows,
  refunded,
  actions,
  now,
}: {
  /** Deposits in failed/cancelled raises that can still be refunded. */
  rows: PortfolioBacked[];
  /** Refunds already received (from the wallet's activity). */
  refunded: ActivityEvent[];
  actions: PositionActions;
  now: number;
}) {
  if (!rows.length && !refunded.length) {
    return <EmptyState>No refunds due. If a raise you back misses its minimum, your deposit comes back here.</EmptyState>;
  }
  const action = (b: PortfolioBacked) =>
    actions.own ? (
      <ActionButton label={refundLabel(b.launch)} actions={actions} variant="primary" onClick={() => actions.refund(b)}>
        Refund {fmtLamports(b.deposited)} SOL
      </ActionButton>
    ) : null;
  return (
    <>
      <ul className="md:hidden">
        {rows.map((b) => (
          <ListRow
            key={launchId(b.launch)}
            l={b.launch}
            figures={<span>{fmtLamports(b.deposited)} SOL to refund</span>}
            action={action(b)}
          />
        ))}
        {refunded.map((e) => (
          <ListRow
            key={e.id}
            l={e}
            figures={
              <>
                <span>Refunded {e.solAmount ? `${fmtLamports(e.solAmount)} SOL` : ""}</span>
                <span className="text-ink-3">{timeAgo(e.timestamp, now)}</span>
              </>
            }
            action={<Address address={e.signature} kind="tx" chars={4} copy={false} />}
          />
        ))}
      </ul>
      <Table label="Refunds" className="hidden md:block">
        <THead>
          <TH>Launch</TH>
          <TH>Status</TH>
          <TH align="right">Amount</TH>
          <TH align="right">When</TH>
          <TH align="right">
            <span className="sr-only">Action</span>
          </TH>
        </THead>
        <tbody>
          {rows.map((b) => (
            <TR key={launchId(b.launch)}>
              <TD>
                <LaunchCell l={b.launch} />
              </TD>
              <TD>
                <StatusChip status={chipStatus(b.launch, now)} />
              </TD>
              <TD align="right">{fmtLamports(b.deposited)} SOL</TD>
              <TD align="right" className="text-ink-3">
                Due now
              </TD>
              <TD align="right">{action(b)}</TD>
            </TR>
          ))}
          {refunded.map((e) => (
            <TR key={e.id}>
              <TD>
                <LaunchCell l={e} />
              </TD>
              <TD>
                <span className="small text-ink-2">Refunded</span>
              </TD>
              <TD align="right">{e.solAmount ? `${fmtLamports(e.solAmount)} SOL` : "—"}</TD>
              <TD align="right" className="text-ink-3">
                {timeAgo(e.timestamp, now)}
              </TD>
              <TD align="right">
                <Address address={e.signature} kind="tx" copy={false} className="justify-end" />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </>
  );
}

/* ---------------------------------------------------------------- Holdings */

export function HoldingsPanel({ rows }: { rows: PortfolioHolding[] }) {
  if (!rows.length) {
    return (
      <EmptyState action={<ButtonLink href="/app" size="sm" variant="secondary">Discover launches</ButtonLink>}>
        No tokens held.
      </EmptyState>
    );
  }
  const trade = (h: PortfolioHolding) => (
    <ButtonLink href={launchHref(h.launch)} size="sm" variant="secondary">
      Trade
    </ButtonLink>
  );
  return (
    <>
      <ul className="md:hidden">
        {rows.map((h) => (
          <ListRow
            key={launchId(h.launch)}
            l={h.launch}
            figures={
              <>
                <span>{fmtSolValue(h.valueSol)} SOL</span>
                <span>{fmtTokens(h.amount)} ${h.launch.symbol}</span>
                <Change value={h.launch.change24h} />
              </>
            }
            action={trade(h)}
          />
        ))}
      </ul>
      <Table label="Token holdings" className="hidden md:block">
        <THead>
          <TH>Token</TH>
          <TH align="right">Amount</TH>
          <TH align="right">Value</TH>
          <TH align="right">24h</TH>
          <TH align="right">
            <span className="sr-only">Action</span>
          </TH>
        </THead>
        <tbody>
          {rows.map((h) => (
            <TR key={launchId(h.launch)}>
              <TD>
                <LaunchCell l={h.launch} />
              </TD>
              <TD align="right" className="text-ink-2">
                {fmtTokens(h.amount)}
              </TD>
              <TD align="right">{fmtSolValue(h.valueSol)} SOL</TD>
              <TD align="right">
                <Change value={h.launch.change24h} />
              </TD>
              <TD align="right">{trade(h)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </>
  );
}

/* ---------------------------------------------------------------- Activity */

const ACTIVITY_VERB: Record<ActivityEvent["type"], string> = {
  trade: "Traded",
  deposit: "Backed",
  launch_created: "Created",
  launched: "Launched",
  refund: "Refunded",
  cancelled: "Raise failed",
  backer_claim: "Claimed backer earnings",
  creator_claim: "Claimed creator fees",
  profit_shared: "Vault profit to backers (old profit split)",
  backers_paid: "Backers paid",
  wound_down: "Wound down",
  vault_withdrawn: "Admin vault withdrawal",
  creator_fees_collected: "pump.fun creator fees collected",
  buyback_burned: "Buyback & burn",
  graduated: "Graduated to PumpSwap",
  migrated: "Layout migrated",
};

function verbOf(e: ActivityEvent): string {
  if (e.type === "trade") return e.isBuy ? "Bought" : "Sold";
  if (e.type === "vault_withdrawn" && e.ref === "dev") return "Withdrawn by the dev key";
  return ACTIVITY_VERB[e.type];
}

function amountOf(e: ActivityEvent): string {
  if (e.type === "trade" && e.tokenAmount && e.solAmount) {
    return `${fmtTokens(e.tokenAmount)} for ${fmtLamports(e.solAmount)} SOL`;
  }
  if (e.type === "launched" && e.tokenAmount) return `${fmtTokens(e.tokenAmount)} to the vault`;
  if (e.type === "backers_paid" && e.solAmount) return `${fmtLamports(e.solAmount)} SOL ${e.ref === "principal" ? "principal" : "dividend"}`;
  if (e.type === "buyback_burned" && e.tokenAmount && BigInt(e.tokenAmount) > 0n) {
    return `${fmtLamports(e.solAmount ?? "0")} SOL → ${fmtTokens(e.tokenAmount)} burned`;
  }
  if ((e.type === "wound_down" || e.type === "vault_withdrawn") && e.tokenAmount && BigInt(e.tokenAmount) > 0n) {
    return `${fmtLamports(e.solAmount ?? "0")} SOL + ${fmtTokens(e.tokenAmount)}`;
  }
  return e.solAmount ? `${fmtLamports(e.solAmount)} SOL` : "—";
}

/** Everything the wallet did, newest first (`/api/users/:wallet/activity`), with older pages on demand. */
export function ActivityPanel({ wallet, now }: { wallet: string; now: number }) {
  const head = useQuery(userActivityQuery(wallet));
  const [older, setOlder] = useState<{ wallet: string; events: ActivityEvent[]; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const mine = older?.wallet === wallet ? older : null;
  const events = [...(head.data?.events ?? []), ...(mine?.events ?? [])];
  const next = mine ? mine.next : (head.data?.nextBefore ?? null);
  const hasMore = next !== null && (head.data?.events.length ?? 0) >= USER_ACTIVITY_PAGE;

  const loadMore = useCallback(() => {
    if (next === null || loading) return;
    setLoading(true);
    setLoadError(false);
    usersApi
      .activity(wallet, { limit: USER_ACTIVITY_PAGE, before: next })
      .then((page) => {
        setOlder((cur) => ({
          wallet,
          events: [...(cur?.wallet === wallet ? cur.events : []), ...page.events],
          next: page.events.length >= USER_ACTIVITY_PAGE ? page.nextBefore : null,
        }));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [loading, next, wallet]);

  if (head.isLoading) {
    return (
      <div className="grid gap-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (head.isError) {
    return (
      <ErrorState onRetry={() => void head.refetch()} retrying={head.isFetching} className="m-4">
        Couldn&apos;t load activity. Indexer unreachable.
      </ErrorState>
    );
  }
  if (!events.length) return <EmptyState>No activity yet.</EmptyState>;

  return (
    <>
      <ul className="md:hidden">
        {events.map((e) => (
          <ListRow
            key={e.id}
            l={e}
            figures={
              <>
                <span className="text-ink">{verbOf(e)}</span>
                <span>{amountOf(e)}</span>
                <span className="text-ink-3">{timeAgo(e.timestamp, now)}</span>
              </>
            }
          />
        ))}
      </ul>
      <Table label="Activity" density="dense" className="hidden md:block">
        <THead>
          <TH>When</TH>
          <TH>Action</TH>
          <TH>Launch</TH>
          <TH align="right">Amount</TH>
          <TH align="right">Tx</TH>
        </THead>
        <tbody>
          {events.map((e) => (
            <TR key={e.id}>
              <TD className="text-ink-3">{timeAgo(e.timestamp, now)}</TD>
              <TD className={cn(e.type === "trade" && (e.isBuy ? "text-up" : "text-down"))}>{verbOf(e)}</TD>
              <TD>
                <LaunchCell l={e} size={24} />
              </TD>
              <TD align="right">{amountOf(e)}</TD>
              <TD align="right">
                <Address address={e.signature} kind="tx" copy={false} className="justify-end" />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {loadError ? (
        <ErrorState onRetry={loadMore} className="m-4">
          Couldn&apos;t load older activity.
        </ErrorState>
      ) : (
        <LoadMore hasMore={hasMore} loading={loading} onLoadMore={loadMore} />
      )}
    </>
  );
}
