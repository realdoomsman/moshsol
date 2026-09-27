import { shortAddr } from "@holdfast/sdk";
import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { parseWallet } from "@/components/portfolio/wallet";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { platformQuery, portfolioQuery } from "@/lib/query-options";
import { userQuery } from "@/lib/users";

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const wallet = parseWallet((await searchParams).wallet);
  return { title: wallet ? `Portfolio of ${shortAddr(wallet)}` : "Portfolio" };
}

/**
 * The connected wallet's positions, or any wallet's read-only with `?wallet=<address>`. Lookups
 * are server-prefetched; the connected wallet is only known in the browser.
 */
export default async function PortfolioPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const wallet = parseWallet(q.wallet);
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, platformQuery()),
    ...(wallet ? [prefetch(client, portfolioQuery(wallet)), prefetch(client, userQuery(wallet))] : []),
  ]);
  return (
    <Hydrate client={client}>
      <PortfolioView lookup={wallet} badLookup={q.wallet !== undefined && !wallet} />
    </Hydrate>
  );
}
