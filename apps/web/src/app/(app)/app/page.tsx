import type { Metadata } from "next";
import { Discover } from "@/components/discover/discover";
import { isToolbarSort, isView } from "@/components/discover/model";
import { api } from "@/lib/api";
import { launchId } from "@/lib/launch";
import { phaseOf } from "@/lib/launch";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { candlesQuery, launchesQuery } from "@/lib/query-options";
import { trendingQuery } from "@/lib/users";

export const metadata: Metadata = {
  title: "Discover",
  description: "Launches raising, launching and trading on Holdfast — the vault holds the first buy.",
  alternates: { canonical: "/app" },
};

/** Live cards whose 24h sparklines are server-rendered; the rest load in the browser. */
const SPARKLINE_PREFETCH = 24;

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = typeof params.view === "string" && isView(params.view) ? params.view : "board";
  const sort = typeof params.sort === "string" && isToolbarSort(params.sort) ? params.sort : "trending";

  const client = serverQueryClient();
  const launches = launchesQuery({ status: "all", sort: "trending" });
  await Promise.all([
    prefetch(client, trendingQuery()),
    (async () => {
      await prefetch(client, launches);
      const now = Math.floor(Date.now() / 1000);
      const live = (client.getQueryData(launches.queryKey)?.launches ?? []).filter((l) => phaseOf(l, now) === "live");
      const ids = live.slice(0, SPARKLINE_PREFETCH).map(launchId);
      if (ids.length === 0) return;
      // One indexer request for every card; like `prefetch`, a failure leaves the sparklines to the browser.
      const batch = await api.candlesBatch(ids, 900).catch(() => null);
      for (const id of ids) {
        const candles = batch?.candles[id];
        if (candles) client.setQueryData(candlesQuery(id, 900).queryKey, { candles });
      }
    })(),
  ]);
  return (
    <Hydrate client={client}>
      <Discover initialView={view} initialSort={sort} />
    </Hydrate>
  );
}
