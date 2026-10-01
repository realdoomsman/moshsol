"use client";

import { fmtPrice, lamportsToSol, timeAgo } from "@holdfast/sdk";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { launchHref } from "@/lib/launch";
import { useAgents, useAgentStatus, useLaunches, usePlatform } from "@/lib/queries";
import { useAgentHeartbeat } from "@/lib/status";
import type { AgentDecision, LaunchSummary } from "@/lib/types";
import { Address } from "../ui/address";
import { Chip, StatusDot } from "../ui/chip";
import { cn } from "../ui/cn";
import { formatCountdown } from "../ui/countdown";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Table, TD, TH, THead, TR } from "../ui/table";
import { DecisionLog, useDecisionLog } from "./decision-log";
import { vaultHealth } from "./health";
import { ResearchNotes } from "./research";
import { RulesSheet } from "./rules";
import { VaultHealthList } from "./vault-health";

const HEARTBEAT_LABEL = { up: "Online", warn: "Stale", down: "Offline", unknown: "Checking" } as const;

function Section({
  id,
  title,
  aside,
  className,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("grid min-w-0 gap-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="h2 text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** ● Online · Signer ↗ · Tick # · Last tick · Up for · Dry run (§4.10 header). */
function StatusRow({ now }: { now: number }) {
  const hb = useAgentHeartbeat();
  const status = useAgentStatus();
  const s = status.data;
  return (
    <dl className="small flex flex-wrap items-center gap-x-5 gap-y-2 text-ink-2">
      <div className="flex items-center gap-2">
        <dt className="sr-only">Status</dt>
        <StatusDot tone={hb.tone} />
        <dd className={cn("ui", hb.tone === "up" ? "text-ink" : hb.tone === "unknown" ? "text-ink-3" : "text-warn")}>
          {HEARTBEAT_LABEL[hb.tone]}
        </dd>
      </div>
      {s ? (
        <>
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-3">Signer</dt>
            <dd>
              <Address address={s.agent} />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-3">Tick</dt>
            <dd className="num text-ink">#{s.tick.toLocaleString("en-US")}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-3">Last tick</dt>
            <dd className="num text-ink">{s.lastTickAt ? timeAgo(s.lastTickAt, now) : "not yet"}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-3">Up for</dt>
            <dd className="num text-ink">{formatCountdown(now - s.startedAt)}</dd>
          </div>
          {s.dryRun ? (
            <div>
              <dt className="sr-only">Mode</dt>
              <dd>
                <Chip tone="warn">Dry run · no transactions sent</Chip>
              </dd>
            </div>
          ) : null}
        </>
      ) : hb.tone === "down" ? (
        <p className="text-ink-2">The agent service isn&apos;t reachable. Nothing changes on-chain: every limit is enforced by the program.</p>
      ) : null}
    </dl>
  );
}

function AgentTrades({ now }: { now: number }) {
  const agents = useAgents();
  const rows = agents.data?.recent ?? [];
  if (agents.isError && !agents.data) {
    return (
      <ErrorState onRetry={() => void agents.refetch()} retrying={agents.isFetching}>
        Couldn&apos;t load agent trades. Indexer unreachable.
      </ErrorState>
    );
  }
  if (!rows.length) {
    return (
      <div className="rounded-md border border-line bg-surface">
        <EmptyState>
          {agents.isLoading ? "Loading agent trades…" : "No agent trades yet. The agent only trades when price leaves the band."}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line bg-surface">
      <Table label="Agent trades" density="dense" maxHeight={480}>
        <THead>
          <TH>When</TH>
          <TH>Launch</TH>
          <TH>Side</TH>
          <TH align="right">SOL</TH>
          <TH align="right">Tokens</TH>
          <TH align="right">Price</TH>
          <TH align="right">Tx</TH>
        </THead>
        <tbody>
          {rows.map((t) => (
            <TR key={`${t.signature}:${t.mint}:${t.isBuy ? "b" : "s"}`} agent>
              <TD className="text-ink-3">{timeAgo(t.timestamp, now)}</TD>
              <TD>
                <Link href={launchHref(t)} className="ui text-ink hover:underline hover:decoration-ink-3/60 hover:underline-offset-2">
                  ${t.symbol}
                </Link>
              </TD>
              <TD className={t.isBuy ? "text-up" : "text-down"}>{t.isBuy ? "Bought dip" : "Sold rally"}</TD>
              <TD align="right">{fmtLamports(t.solAmount)}</TD>
              <TD align="right" className="text-ink-2">
                {fmtTokens(t.tokenAmount)}
              </TD>
              <TD align="right" className="text-ink-2">
                {fmtPrice(t.priceSol)}
              </TD>
              <TD align="right">
                <Address address={t.signature} kind="tx" copy={false} className="justify-end" />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/**
 * /agents (§4.10): the vault agent's status, its rules as a spec sheet, one health row per live
 * vault, the live decision log and its trades. `aside` is the header's right column (the
 * "agent defends" loop, or a live stand-in).
 */
export function AgentsView({ aside }: { aside: ReactNode }) {
  const now = useNow(5_000);
  const platform = usePlatform();
  const agents = useAgents();
  const status = useAgentStatus();
  const hb = useAgentHeartbeat();
  const live = useLaunches({ status: "live", sort: "mcap" });
  const log = useDecisionLog(status.data);

  const liveLaunches = useMemo(() => (live.data?.launches ?? []).filter((l) => l.status === "live"), [live.data]);
  const health = useMemo(() => {
    const byMint: Record<string, LaunchSummary> = Object.fromEntries(liveLaunches.map((l) => [l.mint, l]));
    const decisions: Record<string, AgentDecision> = Object.fromEntries((status.data?.decisions ?? []).map((d) => [d.mint, d]));
    return (agents.data?.launches ?? []).map((row) =>
      vaultHealth({
        row,
        launch: byMint[row.mint],
        decision: decisions[row.mint],
        agent: hb.tone,
        agentsPaused: !!platform.data?.params.agentsPaused,
        platformWindowSecs: platform.data?.params.agentWindowSecs ?? 0,
        now,
      }),
    );
  }, [agents.data, liveLaunches, status.data, hb.tone, platform.data, now]);

  const totals = agents.data?.totals;
  const traded = totals ? totals.buys + totals.sells > 0 : false;

  return (
    <div className="grid gap-10">
      <header className="order-1 grid gap-8 lg:order-none lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="grid gap-5">
          <div className="grid gap-3">
            <h1 className="display-m text-ink">The vault agent, in the open.</h1>
            <p className="body-l max-w-[60ch] text-ink-2">
              A rate-limited agent sells each vault slowly into strength and buys back dips with what it sold, inside limits the program
              enforces. Proceeds stay in the vault; once it has grown, the agent may pay backers back.{" "}
              <Link href="/docs/agents" className="whitespace-nowrap text-ink underline decoration-ink-3/60 underline-offset-2 hover:decoration-ink">
                How it works ›
              </Link>
            </p>
          </div>
          <StatusRow now={now} />
          {traded && totals ? (
            <p className="small num text-ink-3">
              {totals.buys} dip {totals.buys === 1 ? "buy" : "buys"} · {totals.sells} rally {totals.sells === 1 ? "sell" : "sells"} ·{" "}
              {fmtSolValue(lamportsToSol(totals.solSpent))} SOL spent · {fmtSolValue(lamportsToSol(totals.solReceived))} SOL received
            </p>
          ) : null}
        </div>
        <div className="hidden lg:block">{aside}</div>
      </header>

      <Section id="rules" title="Rules" className="order-4 lg:order-none">
        <RulesSheet platform={platform.data} launches={liveLaunches} />
      </Section>

      <Section id="health" title="Vault health" className="order-2 lg:order-none">
        {agents.isError && !agents.data ? (
          <ErrorState onRetry={() => void agents.refetch()} retrying={agents.isFetching}>
            Couldn&apos;t load vaults. Indexer unreachable.
          </ErrorState>
        ) : (
          <VaultHealthList rows={health} now={now} loading={agents.isLoading} />
        )}
      </Section>

      <Section
        id="log"
        title="Decision log"
        className="order-3 lg:order-none"
        aside={<span className="small text-ink-3">Live from the agent · newest first</span>}
      >
        <div className="rounded-md border border-line bg-surface">
          {status.isError && !log.length ? (
            <ErrorState onRetry={() => void status.refetch()} retrying={status.isFetching} className="m-4">
              Couldn&apos;t reach the agent service. Vault limits are still enforced on-chain.
            </ErrorState>
          ) : (
            <DecisionLog log={log} now={now} loading={status.isLoading} />
          )}
        </div>
      </Section>

      <Section id="trades" title="Agent trades" className="order-5 lg:order-none">
        <AgentTrades now={now} />
      </Section>

      <Section
        id="research"
        title="What the agent learned"
        className="order-6 lg:order-none"
        aside={<span className="small text-ink-3">An optional language model writes these notes; it never decides trades</span>}
      >
        <ResearchNotes now={now} />
      </Section>
    </div>
  );
}
