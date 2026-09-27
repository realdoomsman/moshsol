import { Explore } from "@/components/explore/explore";
import { phaseOf } from "@/lib/launch";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, agentsQuery, candlesQuery, launchesQuery, platformQuery, statsQuery } from "@/lib/query-options";

/** Launch cards whose sparklines are server-rendered; the rest load in the browser. */
const SPARKLINE_PREFETCH = 24;
/** The featured launch's agent line is decoration; don't let a slow agent service hold up the page. */
const AGENT_STATUS_DEADLINE_MS = 800;

export default async function ExplorePage() {
  const client = serverQueryClient();
  const launches = launchesQuery({ status: "all", sort: "trending" });
  await Promise.all([
    prefetch(client, platformQuery()),
    prefetch(client, statsQuery()),
    prefetch(client, agentsQuery()),
    prefetch(client, agentStatusQuery(), AGENT_STATUS_DEADLINE_MS),
    (async () => {
      await prefetch(client, launches);
      // The default tab lists live launches; their cards draw a 1m-candle sparkline.
      const now = Math.floor(Date.now() / 1000);
      const live = (client.getQueryData(launches.queryKey)?.launches ?? []).filter((l) => phaseOf(l, now) === "live");
      await Promise.all(live.slice(0, SPARKLINE_PREFETCH).map((l) => prefetch(client, candlesQuery(l.mint, 60))));
    })(),
  ]);
  return (
    <Hydrate client={client}>
      <Explore />
    </Hydrate>
  );
}
