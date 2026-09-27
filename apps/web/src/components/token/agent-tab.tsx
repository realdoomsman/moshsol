"use client";

import { fmtPrice } from "@holdfast/sdk";
import { useMemo } from "react";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { tradeKey, useAgentStatus, useTradeFeed } from "@/lib/queries";
import type { AgentDecision, LaunchSummary, TradeRow } from "@/lib/types";
import { agentMarkers, decisionLabel, describeAgentTrade } from "../band/model";
import { AgentGlyph } from "../brand/glyphs";
import { Chip } from "../ui/chip";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { LoadMore, Table, TableMessage, TD, TH, THead, TR } from "../ui/table";
import { RelativeTime, TxLink, useFreshKeys } from "./shared";
import { LoadingRows } from "./trades-tab";

type Row = { kind: "decision"; at: number; d: AgentDecision } | { kind: "trade"; at: number; t: TradeRow; text: string };

const AGENT_FILTER = { agent: true } as const;

/**
 * Agent tab (§4.5): the vault agent's latest decision for this launch (agent `/status`) and its
 * on-chain trades (`trades?agent=1`), merged by time.
 */
export function AgentTab({ launch: l, now }: { launch: LaunchSummary; now: number }) {
  const status = useAgentStatus();
  const feed = useTradeFeed(l.mint, AGENT_FILTER);
  const fresh = useFreshKeys(feed.headKeys);
  const cols = 6;

  const rows = useMemo<Row[]>(() => {
    const markers = new Map(agentMarkers(feed.rows, l.virtualSol).map((m) => [m.signature, m]));
    const trades: Row[] = feed.rows.map((t) => {
      const m = markers.get(t.signature);
      return { kind: "trade", at: t.timestamp, t, text: m ? describeAgentTrade(m, l.symbol) : "" };
    });
    const decisions: Row[] = (status.data?.decisions ?? [])
      .filter((d) => d.mint === l.mint && !(d.signature && feed.rows.some((t) => t.signature === d.signature)))
      .map((d) => ({ kind: "decision", at: d.at, d }));
    return [...decisions, ...trades].sort((a, b) => b.at - a.at);
  }, [feed.rows, status.data, l.mint, l.symbol, l.virtualSol]);

  return (
    <div>
      {status.isError ? (
        <p className="small px-4 pb-3 text-ink-2">The agent service isn&apos;t answering. On-chain limits hold regardless; trades below are from the chain.</p>
      ) : null}
      <Table density="dense" maxHeight={480} label="Vault agent activity">
        <THead>
          <TH>Time</TH>
          <TH>Action</TH>
          <TH>Reason</TH>
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
          ) : feed.isLoading ? (
            <LoadingRows cols={cols} rows={3} />
          ) : rows.length === 0 ? (
            <TableMessage colSpan={cols}>
              <EmptyState>No agent activity yet. The agent trades only when price leaves the band.</EmptyState>
            </TableMessage>
          ) : (
            rows.map((r) =>
              r.kind === "decision" ? (
                <TR key={`d:${r.d.at}`}>
                  <TD className="text-ink-2">
                    <RelativeTime ts={r.d.at} now={now} />
                  </TD>
                  <TD>
                    {r.d.error && (r.d.action === "buy" || r.d.action === "sell") ? (
                      <Chip tone="warn">Failed</Chip>
                    ) : (
                      <Chip tone={r.d.action === "buy" || r.d.action === "sell" ? "accent" : "muted"}>{decisionLabel(r.d)}</Chip>
                    )}
                  </TD>
                  <TD className="max-w-[360px] truncate text-ink-2 first-letter:uppercase" title={r.d.reason}>
                    {r.d.error ? `${r.d.reason} · ${r.d.error}` : r.d.reason}
                  </TD>
                  <TD align="right" className="text-ink-2 max-md:hidden">
                    {fmtPrice(r.d.priceSol)} / {fmtPrice(r.d.emaSol)}
                  </TD>
                  <TD align="right" className="text-ink-2">
                    {r.d.amount ? (r.d.action === "buy" ? `${fmtLamports(r.d.amount)} SOL` : fmtTokens(r.d.amount)) : "—"}
                  </TD>
                  <TD>{r.d.signature ? <TxLink signature={r.d.signature} /> : null}</TD>
                </TR>
              ) : (
                <TR key={tradeKey(r.t)} agent flash={fresh.has(tradeKey(r.t)) ? "agent" : undefined}>
                  <TD className="text-ink-2">
                    <RelativeTime ts={r.t.timestamp} now={now} />
                  </TD>
                  <TD>
                    <Chip tone="accent" icon={<AgentGlyph size={10} outline={!r.t.isBuy} />}>
                      {r.t.isBuy ? "Bought" : "Sold"}
                    </Chip>
                  </TD>
                  <TD className="max-w-[360px] truncate text-ink-2">{r.text}</TD>
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
              ),
            )
          )}
          {feed.hasMore ? (
            <TableMessage colSpan={cols}>
              <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onLoadMore={feed.loadMore} />
            </TableMessage>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
