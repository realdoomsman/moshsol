"use client";

import { fmtPrice } from "@holdfast/sdk";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { launchId } from "@/lib/launch";
import { useFallbackInterval } from "@/lib/live";
import { tradeKey, useAgentActivity, useAgentResearch, useTradeFeed } from "@/lib/queries";
import type { ActivityEvent, ActivityType, AgentActivityItem, LaunchSummary, TradeRow } from "@/lib/types";
import { agentMarkers, describeAgentTrade } from "../band/model";
import { AgentGlyph } from "../brand/glyphs";
import { Chip, type ChipTone } from "../ui/chip";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { RelativeTime, TxLink, useFreshKeys } from "./shared";
import { LoadingRows } from "./trades-tab";

const AGENT_FILTER = { agent: true } as const;

/** On-chain events worth a row next to the agent's log (its trades already come from the trade feed). */
const EVENT_TYPES: readonly ActivityType[] = ["backers_paid", "creator_fees_collected", "vault_withdrawn", "buyback_burned", "wound_down"];
const EVENTS_PER_TYPE = 50;

type Row =
  | { kind: "agent"; key: string; at: number; item: AgentActivityItem; trade?: TradeRow; event?: ActivityEvent }
  | { kind: "trade"; key: string; at: number; t: TradeRow; text: string }
  | { kind: "event"; key: string; at: number; e: ActivityEvent };

const num = (v: number | string | boolean | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Chip label + tone for an agent log entry. */
function agentLabel(item: AgentActivityItem): { label: string; tone: ChipTone; side?: "buy" | "sell" } {
  const failed = typeof item.detail.error === "string" && item.detail.error !== "";
  switch (item.kind) {
    case "sell":
      return failed ? { label: "Sell failed", tone: "warn" } : { label: item.sig ? "Sold" : "Selling", tone: "accent", side: "sell" };
    case "buy":
      return failed ? { label: "Buy failed", tone: "warn" } : { label: item.sig ? "Bought" : "Buying the dip", tone: "accent", side: "buy" };
    case "buyback":
      return failed ? { label: "Buy failed", tone: "warn" } : { label: item.sig ? "Bought back" : "Buying back", tone: "accent", side: "buy" };
    case "payout":
      return item.detail.skipped === true
        ? { label: "Payout skipped", tone: "muted" }
        : failed
          ? { label: "Payout failed", tone: "warn" }
          : { label: "Paid backers", tone: "accent" };
    case "collect_fees":
      return failed ? { label: "Crank failed", tone: "warn" } : { label: "Fees collected", tone: "neutral" };
    case "wind_down":
      return failed ? { label: "Crank failed", tone: "warn" } : { label: "Wound down", tone: "neutral" };
    default:
      return { label: "Holding", tone: "muted" };
  }
}

/** What the agent said about an entry: the narration when there is one, else the reason it logged. */
function agentText(item: AgentActivityItem): string {
  if (item.narrative) return item.narrative;
  if (item.kind === "payout" && item.detail.skipped === true && item.detail.eligible === true) return `Payout eligible, skipped: ${item.reason}`;
  const err = typeof item.detail.error === "string" && item.detail.error !== "" ? ` · ${item.detail.error}` : "";
  return `${item.reason}${err}`;
}

/** Size column of an agent entry: the on-chain trade when it was matched, else the numbers the agent logged. */
function agentSize(row: Extract<Row, { kind: "agent" }>): string {
  if (row.trade) return `${fmtLamports(row.trade.solAmount)} SOL · ${fmtTokens(row.trade.tokenAmount)}`;
  if (row.event?.solAmount) return `${fmtLamports(row.event.solAmount)} SOL`;
  const sol = num(row.item.detail.amountSol);
  if (sol !== null) return `${fmtSolValue(sol)} SOL`;
  const tokens = num(row.item.detail.amountTokens);
  if (tokens !== null) return fmtTokens(BigInt(Math.round(tokens * 1e6)));
  return "—";
}

function agentPrices(item: AgentActivityItem): string {
  const price = num(item.detail.priceSol);
  const ema = num(item.detail.emaSol);
  return price === null || ema === null ? "—" : `${fmtPrice(price)} / ${fmtPrice(ema)}`;
}

/** Chip + sentence for an on-chain event that isn't a trade. */
function eventCopy(e: ActivityEvent, symbol: string): { label: string; tone: ChipTone; text: string; size: string } {
  const sol = e.solAmount ? `${fmtLamports(e.solAmount)} SOL` : "—";
  switch (e.type) {
    case "backers_paid":
      return {
        label: "Backers paid",
        tone: "accent",
        text: `Backers paid: ${e.ref === "principal" ? "principal" : "dividend"} ${sol}, pro-rata to their deposits.`,
        size: sol,
      };
    case "creator_fees_collected":
      return { label: "Fees collected", tone: "neutral", text: `pump.fun creator fees swept into the launch and split between vault, buyback pool and backers.`, size: sol };
    case "vault_withdrawn":
      return {
        label: "Admin withdrew",
        tone: "neutral",
        text: `The platform multisig withdrew from the vault (admin_withdraw_vault).`,
        size: e.tokenAmount && BigInt(e.tokenAmount) > 0n ? `${sol} · ${fmtTokens(e.tokenAmount)}` : sol,
      };
    case "buyback_burned":
      return { label: "Burned", tone: "neutral", text: `Buyback pool spent on the Holdfast token and burned.`, size: sol };
    case "wound_down":
      return { label: "Wound down", tone: "neutral", text: `The vault sold what it held; all vault SOL went to backers.`, size: sol };
    default:
      return { label: e.type, tone: "neutral", text: `$${symbol}`, size: sol };
  }
}

function useLaunchEvents(id: string) {
  const interval = useFallbackInterval(15_000);
  return useQueries({
    queries: EVENT_TYPES.map((type) => ({
      queryKey: ["launch-activity", id, type],
      queryFn: () => api.launchActivity(id, { type, limit: EVENTS_PER_TYPE }),
      refetchInterval: interval,
    })),
    combine: (results) => results.flatMap((r) => r.data?.events ?? []),
  });
}

const absolute = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * Agent activity (§4.5): the vault agent's own log (`/launches/:id/activity`: every buy, sell,
 * buy-back, hold and crank with its reason, the optional narration and the numbers it decided
 * on), its on-chain trades (`trades?agent=1`) and the launch's other vault events (backer payouts,
 * fee sweeps, admin withdrawals, burns, wind-down), one feed newest first. An agent entry and the
 * trade or event it signed are one row. Under it: what the research loop learned.
 */
export function AgentActivity({ launch: l, now }: { launch: LaunchSummary; now: number }) {
  const id = launchId(l);
  const log = useAgentActivity(id);
  const feed = useTradeFeed(id, AGENT_FILTER);
  const events = useLaunchEvents(id);
  const research = useAgentResearch();
  const fresh = useFreshKeys(feed.headKeys);
  const cols = 6;
  // 404 = the agent is up but has nothing logged for this launch; anything else = unreachable.
  const agentDown = log.isError && !(log.error instanceof ApiError && log.error.status === 404);
  const items = log.data?.items ?? [];

  const rows = useMemo<Row[]>(() => {
    const markers = new Map(agentMarkers(feed.rows, l.virtualSol).map((m) => [m.signature, m]));
    const bySig = new Map<string, Extract<Row, { kind: "agent" }>>();
    const agent: Row[] = items.map((item, i) => {
      const row: Extract<Row, { kind: "agent" }> = { kind: "agent", key: `a:${item.ts}:${i}`, at: item.ts, item };
      if (item.sig) bySig.set(item.sig, row);
      return row;
    });
    const trades: Row[] = [];
    for (const t of feed.rows) {
      const matched = bySig.get(t.signature);
      if (matched) matched.trade ??= t;
      else {
        const m = markers.get(t.signature);
        trades.push({ kind: "trade", key: tradeKey(t), at: t.timestamp, t, text: m ? describeAgentTrade(m, l.symbol) : "" });
      }
    }
    const chain: Row[] = [];
    for (const e of events) {
      const matched = bySig.get(e.signature);
      if (matched) matched.event ??= e;
      else chain.push({ kind: "event", key: `e:${e.id}`, at: e.timestamp, e });
    }
    return [...agent, ...trades, ...chain].sort((a, b) => b.at - a.at);
  }, [items, feed.rows, events, l.symbol, l.virtualSol]);

  const newest = items[0];
  const nowLine = newest ? agentText(newest) : agentDown ? "The agent service isn't answering. On-chain limits hold regardless." : "Waiting for the agent's next tick.";
  const notes = (research.data?.items ?? []).slice(0, 3);

  return (
    <div>
      <div className="small flex items-baseline gap-3 px-4 pb-3" aria-live="polite">
        <span className="label shrink-0 text-ink-3">Now</span>
        <p className="min-w-0 text-ink first-letter:uppercase">
          {nowLine}
          {newest ? (
            <span className="num text-ink-3">
              {" "}
              · <RelativeTime ts={newest.ts} now={now} />
            </span>
          ) : null}
        </p>
      </div>
      <Table density="dense" maxHeight={480} label="Vault agent activity">
        <THead>
          <TH>Time</TH>
          <TH>Action</TH>
          <TH>What happened</TH>
          <TH align="right" className="max-md:hidden">
            Spot / EMA
          </TH>
          <TH align="right">Size</TH>
          <TH>
            <span className="sr-only">Transaction</span>
          </TH>
        </THead>
        <tbody>
          {feed.error ? (
            <TableMessage colSpan={cols}>
              <ErrorState onRetry={feed.retry} className="m-3">
                Couldn&apos;t load agent trades. {feed.error}
              </ErrorState>
            </TableMessage>
          ) : feed.isLoading || (log.isLoading && rows.length === 0) ? (
            <LoadingRows cols={cols} rows={3} />
          ) : rows.length === 0 ? (
            <TableMessage colSpan={cols}>
              <EmptyState>No agent activity yet.</EmptyState>
            </TableMessage>
          ) : (
            rows.map((r) => {
              if (r.kind === "agent") {
                const a = agentLabel(r.item);
                const text = agentText(r.item);
                return (
                  <TR key={r.key} agent={!!r.trade}>
                    <TD className="text-ink-2">
                      <RelativeTime ts={r.at} now={now} />
                    </TD>
                    <TD>
                      <Chip tone={a.tone} icon={a.side ? <AgentGlyph size={10} outline={a.side === "sell"} /> : undefined}>
                        {a.label}
                      </Chip>
                    </TD>
                    <TD className="max-w-[420px] truncate text-ink-2 first-letter:uppercase" title={text}>
                      {text}
                    </TD>
                    <TD align="right" className="text-ink-2 max-md:hidden">
                      {agentPrices(r.item)}
                    </TD>
                    <TD align="right" className="text-ink-2">
                      {agentSize(r)}
                    </TD>
                    <TD>{r.item.sig ? <TxLink signature={r.item.sig} /> : null}</TD>
                  </TR>
                );
              }
              if (r.kind === "trade") {
                return (
                  <TR key={r.key} agent flash={fresh.has(r.key) ? "agent" : undefined}>
                    <TD className="text-ink-2">
                      <RelativeTime ts={r.t.timestamp} now={now} />
                    </TD>
                    <TD>
                      <Chip tone="accent" icon={<AgentGlyph size={10} outline={!r.t.isBuy} />}>
                        {r.t.isBuy ? "Bought" : "Sold"}
                      </Chip>
                    </TD>
                    <TD className="max-w-[420px] truncate text-ink-2">{r.text}</TD>
                    <TD align="right" className="text-ink-2 max-md:hidden">
                      {fmtPrice(r.t.priceSol)} / {fmtPrice(r.t.emaSol)}
                    </TD>
                    <TD align="right">
                      {fmtLamports(r.t.solAmount)} SOL <span className="text-ink-3">· {fmtTokens(r.t.tokenAmount)}</span>
                    </TD>
                    <TD>
                      <TxLink signature={r.t.signature} />
                    </TD>
                  </TR>
                );
              }
              const c = eventCopy(r.e, l.symbol);
              return (
                <TR key={r.key}>
                  <TD className="text-ink-2">
                    <RelativeTime ts={r.at} now={now} />
                  </TD>
                  <TD>
                    <Chip tone={c.tone}>{c.label}</Chip>
                  </TD>
                  <TD className="max-w-[420px] truncate text-ink-2" title={c.text}>
                    {c.text}
                  </TD>
                  <TD align="right" className="text-ink-2 max-md:hidden">
                    —
                  </TD>
                  <TD align="right" className="text-ink-2">
                    {c.size}
                  </TD>
                  <TD>
                    <TxLink signature={r.e.signature} />
                  </TD>
                </TR>
              );
            })
          )}
          {feed.hasMore ? (
            <TableMessage colSpan={cols}>
              <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onLoadMore={feed.loadMore} />
            </TableMessage>
          ) : null}
        </tbody>
      </Table>

      <section aria-label="What the agent learned" className="grid gap-2 border-t border-line px-4 py-3">
        <h3 className="label text-ink-3">What the agent learned</h3>
        {notes.length === 0 ? (
          <p className="small text-ink-2">The agent hasn&apos;t published a research note yet.</p>
        ) : (
          <ul className="grid gap-2">
            {notes.map((n) => (
              <li key={n.ts} className="small grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3">
                <span className="num text-ink-3">{absolute.format(n.ts * 1000)}</span>
                <Chip tone={n.adopted ? "accent" : "muted"}>{n.adopted ? "Adopted" : "Kept"}</Chip>
                <p className="text-ink-2">{n.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
