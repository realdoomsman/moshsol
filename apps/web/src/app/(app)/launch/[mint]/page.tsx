import { fmtPrice, lamportsToSol } from "@holdfast/sdk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHART_TRADES, HOLDERS_LIMIT } from "@/components/token/limits";
import { TokenView } from "@/components/token/token-view";
import { fmtSolValue } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import {
  agentStatusQuery,
  backersQuery,
  candlesQuery,
  commentsQuery,
  depositFeed,
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
/** Backers are read live from chain (one RPC call); the rail's role chips can fill in client-side. */
const BACKERS_DEADLINE_MS = 900;

type Params = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { mint } = await params;
  if (!parseMint(mint)) return { title: "Launch not found" };
  const r = await loadLaunch(mint);
  if (r.state === "missing") return { title: (await launchOnChain(mint)) === false ? "Launch not found" : "New launch" };
  if (r.state !== "found") return { title: "Launch" };
  const l = r.launch;
  const title = `${l.name} ($${l.symbol})`;
  const backerPct = l.terms.backerFeeShareBps / 100;
  const description =
    l.status === "live"
      ? `$${l.symbol}: ${fmtSolValue(l.marketCapSol)} SOL market cap at ${fmtPrice(l.priceSol)} SOL. The vault holds ${fmtSolValue(lamportsToSol(l.vaultSol))} SOL, traded only by a rate-limited agent; backers get ${backerPct}% of every trading fee and 100% of its profit.`
      : l.status === "raising"
        ? `Raising ${fmtSolValue(lamportsToSol(l.raised))} of ${fmtSolValue(lamportsToSol(l.raiseMax))} SOL. Backers make the first buy, earn ${backerPct}% of every trading fee and 100% of the vault agent's profit.`
        : l.status === "woundDown"
          ? `$${l.symbol} wound down: trading has ended and the curve and vault SOL were credited to its backers.`
          : `The $${l.symbol} raise closed without launching. Every backer can refund 100%.`;
  return {
    title,
    description,
    openGraph: { title: `${title} · Holdfast`, description, type: "website", siteName: "Holdfast" },
    twitter: { card: "summary_large_image", title: `${title} · Holdfast`, description },
  };
}

export default async function LaunchPage({ params }: Params) {
  const { mint } = await params;
  if (!parseMint(mint)) notFound();
  const client = serverQueryClient();
  // Most visits land on live launches, so the live layout's data loads alongside the summary
  // (which is shared with generateMetadata) instead of waiting on it.
  const pending = [
    prefetch(client, platformQuery()),
    // The chart counts 1m candles to pick its timeframe; the trades tab is the first one below it.
    prefetch(client, candlesQuery(mint, 60)),
    prefetch(client, recentTradesQuery(mint, CHART_TRADES)),
    prefetch(client, feedHeadQuery(tradeFeed(mint))),
    prefetch(client, holdersQuery(mint, HOLDERS_LIMIT)),
    prefetch(client, backersQuery(mint), BACKERS_DEADLINE_MS),
    prefetch(client, agentStatusQuery(), AGENT_STATUS_DEADLINE_MS),
  ];
  const r = await loadLaunch(mint);
  // Not indexed: only a 404 if the chain agrees; a launch confirmed seconds ago renders and waits.
  if (r.state === "missing" && (await launchOnChain(mint)) === false) notFound();
  if (r.state === "found") {
    client.setQueryData(launchQuery(mint).queryKey, r.launch);
    const phase = phaseOf(r.launch, Math.floor(Date.now() / 1000));
    if (phase === "live" || phase === "woundDown") pending.push(prefetch(client, vaultWithdrawalsQuery(mint)));
    else pending.push(prefetch(client, feedHeadQuery(depositFeed(mint))), prefetch(client, commentsQuery(mint)));
  }
  await Promise.all(pending);
  return (
    <Hydrate client={client}>
      <TokenView mint={mint} />
    </Hydrate>
  );
}
