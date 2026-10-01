import { fmtPrice, lamportsToSol } from "@holdfast/sdk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHART_TRADES, HOLDERS_LIMIT } from "@/components/token/limits";
import { TokenView } from "@/components/token/token-view";
import { fmtMcap, fmtSolValue } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import {
  agentStatusQuery,
  backersQuery,
  candlesQuery,
  commentsQuery,
  depositFeed,
  FEED_PAGE,
  feedHeadQuery,
  holdersQuery,
  launchQuery,
  platformQuery,
  recentTradesQuery,
  tradeFeed,
  vaultWithdrawalsQuery,
} from "@/lib/query-options";
import { launchOnChain, loadLaunch, parseMint } from "@/lib/server";

/** Agent status is optional decoration; don't let a slow agent service hold up the page. */
const AGENT_STATUS_DEADLINE_MS = 800;
/** Backers come from the indexer's deposit ledger; the rail's role chips can fill in client-side if the prefetch is slow. */
const BACKERS_DEADLINE_MS = 900;

/** The route is `/launch/[mint]` historically; the param is a launch id: the mint (Holdfast launches) or the launch address (pump launches). */
type Params = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { mint: id } = await params;
  if (!parseMint(id)) return { title: "Launch not found" };
  const r = await loadLaunch(id);
  if (r.state === "missing") return { title: (await launchOnChain(id)) === false ? "Launch not found" : "New launch" };
  if (r.state !== "found") return { title: "Launch" };
  const l = r.launch;
  const title = `${l.name} ($${l.symbol})`;
  const pump = l.venue === "pump";
  const s = pumpSplit(l.terms);
  const payback = `When the vault is ${fmtMult(s.payoutMult)} its start and the chart is strong, the vault agent may pay backers back (principal first, then ${s.payoutSharePct}% of the vault every ${fmtInterval(s.payoutIntervalHours)}).`;
  const backerEarn = pump
    ? `${s.backerPct}% of pump.fun's creator fees. ${payback}`
    : `${l.terms.backerFeeShareBps / 100}% of every trading fee. ${payback}`;
  const description =
    l.status === "live"
      ? `$${l.symbol}: ${fmtMcap(l)} market cap${l.marketCapUsd != null ? ` (${fmtSolValue(l.marketCapSol)} SOL)` : ""} at ${fmtPrice(l.priceSol)} SOL${pump ? " on pump.fun" : ""}. The vault holds ${fmtSolValue(lamportsToSol(l.vaultSol))} SOL, traded only by the rate-limited vault agent; its sell proceeds stay in the vault. Backers earn ${backerEarn}`
      : l.status === "raising"
        ? `Raising ${fmtSolValue(lamportsToSol(l.raised))} of ${fmtSolValue(lamportsToSol(l.raiseMax))} SOL${pump ? " for a pump.fun token" : ""}. Backers' SOL makes the first buy ${pump ? "in the same instruction that creates the token" : "the moment it launches"}; they earn ${backerEarn}`
        : l.status === "woundDown"
          ? `$${l.symbol} wound down: the vault ${pump ? "sold what it held and all vault SOL was" : "and curve SOL were"} credited to its backers.`
          : `The $${l.symbol} raise closed without launching. Every backer can refund 100%.`;
  return {
    title,
    description,
    alternates: { canonical: `/launch/${id}` },
    openGraph: { title: `${title} · Holdfast`, description, type: "website", siteName: "Holdfast" },
    twitter: { card: "summary_large_image", title: `${title} · Holdfast`, description },
  };
}

export default async function LaunchPage({ params }: Params) {
  const { mint: id } = await params;
  if (!parseMint(id)) notFound();
  const client = serverQueryClient();
  // Most visits land on live launches, so the live layout's data loads alongside the summary
  // (which is shared with generateMetadata) instead of waiting on it.
  const pending = [
    prefetch(client, platformQuery()),
    // The chart counts 1m candles to pick its timeframe; the trades tab is the first one below it.
    prefetch(client, candlesQuery(id, 60)),
    // The trades tab's first page is the newest FEED_PAGE of the chart's trades: one request fills both.
    (async () => {
      const recent = recentTradesQuery(id, CHART_TRADES);
      await prefetch(client, recent);
      const trades = client.getQueryData(recent.queryKey)?.trades;
      if (trades) client.setQueryData(feedHeadQuery(tradeFeed(id)).queryKey, trades.slice(0, FEED_PAGE));
    })(),
    prefetch(client, holdersQuery(id, HOLDERS_LIMIT)),
    prefetch(client, backersQuery(id), BACKERS_DEADLINE_MS),
    prefetch(client, agentStatusQuery(), AGENT_STATUS_DEADLINE_MS),
  ];
  const r = await loadLaunch(id);
  // Not indexed: only a 404 if the chain agrees; a launch confirmed seconds ago renders and waits.
  if (r.state === "missing" && (await launchOnChain(id)) === false) notFound();
  if (r.state === "found") {
    client.setQueryData(launchQuery(id).queryKey, r.launch);
    const phase = phaseOf(r.launch, Math.floor(Date.now() / 1000));
    if (phase === "live" || phase === "woundDown") pending.push(prefetch(client, vaultWithdrawalsQuery(id)));
    else pending.push(prefetch(client, feedHeadQuery(depositFeed(id))), prefetch(client, commentsQuery(r.launch.address)));
  }
  await Promise.all(pending);
  return (
    <Hydrate client={client}>
      <TokenView id={id} />
    </Hydrate>
  );
}
