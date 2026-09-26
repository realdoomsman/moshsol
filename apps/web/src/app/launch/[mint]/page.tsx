import { fmtPrice, lamportsToSol } from "@moshsol/sdk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LaunchView } from "@/components/launch/launch-view";
import { fmtSolValue } from "@/lib/format";
import { launchOnChain, loadLaunch, parseMint } from "@/lib/server";

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
  const r = await loadLaunch(mint);
  // Not indexed: only a 404 if the chain agrees; a launch confirmed seconds ago renders and waits.
  if (r.state === "missing" && (await launchOnChain(mint)) === false) notFound();
  return <LaunchView mint={mint} initial={r.state === "found" ? r.launch : null} />;
}
