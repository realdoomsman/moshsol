import { fmtPrice, lamportsToSol } from "@moshsol/sdk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LaunchView } from "@/components/launch/launch-view";
import { fmtSolValue } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import {
  agentStatusQuery,
  backersQuery,
  candlesQuery,
  depositFeed,
  feedHeadQuery,
  launchQuery,
  platformQuery,
  recentTradesQuery,
  tradeFeed,
} from "@/lib/query-options";
import { launchOnChain, loadLaunch, parseMint } from "@/lib/server";

/** Recent trades behind the chart's EMA line and agent markers (same limit as `PriceChart`). */
const CHART_TRADES = 500;
/** Agent status is optional decoration; don't let a slow agent service hold up the page. */
const AGENT_STATUS_DEADLINE_MS = 800;

type Params = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { mint } = await params;
  if (!parseMint(mint)) return { title: "Launch not found" };
  const r = await loadLaunch(mint);
  if (r.state === "missing") return { title: (await launchOnChain(mint)) === false ? "Launch not found" : "New launch" };
  if (r.state !== "found") return { title: "Launch" };
  const l = r.launch;
  const title = `${l.name} ($${l.symbol})`;
  const description =
    l.status === "live"
      ? `$${l.symbol} at ${fmtPrice(l.priceSol)} SOL · mcap ${fmtSolValue(l.marketCapSol)} SOL · ${fmtSolValue(lamportsToSol(l.vaultSol))} SOL + ${l.bundleSupplyBps / 100}% bundle locked forever in the vault.`
      : l.status === "raising"
        ? `Raising ${fmtSolValue(lamportsToSol(l.raised))} / ${fmtSolValue(lamportsToSol(l.raiseMax))} SOL. Back the bundle — it's locked forever and backers earn a share of every trade.`
        : `The $${l.symbol} raise ended without launching — every backer can refund 100%.`;
  return {
    title,
    description,
    openGraph: { title: `${title} · moshsol`, description, type: "website", siteName: "moshsol" },
    twitter: { card: "summary_large_image", title: `${title} · moshsol`, description },
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
    // `PriceChart` opens on the 1m timeframe; the trades tab is the first one below it.
    prefetch(client, candlesQuery(mint, 60)),
    prefetch(client, recentTradesQuery(mint, CHART_TRADES)),
    prefetch(client, feedHeadQuery(tradeFeed(mint, false))),
    prefetch(client, agentStatusQuery(), AGENT_STATUS_DEADLINE_MS),
  ];
  const r = await loadLaunch(mint);
  // Not indexed: only a 404 if the chain agrees; a launch confirmed seconds ago renders and waits.
  if (r.state === "missing" && (await launchOnChain(mint)) === false) notFound();
  if (r.state === "found") {
    client.setQueryData(launchQuery(mint).queryKey, r.launch);
    const phase = phaseOf(r.launch, Math.floor(Date.now() / 1000));
    if (phase === "failed" || phase === "refunding") pending.push(prefetch(client, backersQuery(mint)));
    else if (phase !== "live") pending.push(prefetch(client, feedHeadQuery(depositFeed(mint))));
  }
  await Promise.all(pending);
  return (
    <Hydrate client={client}>
      <LaunchView mint={mint} />
    </Hydrate>
  );
}
