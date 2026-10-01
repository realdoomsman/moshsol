import type { QueryClient } from "@tanstack/react-query";
import { launchId } from "@/lib/launch";
import { prefetch } from "@/lib/prefetch";
import { backersQuery, candlesQuery, launchesQuery, launchQuery, platformQuery, recentTradesQuery } from "@/lib/query-options";
import type { LaunchSummary } from "@/lib/types";
import { trendingQuery } from "@/lib/users";
import { BAND_MIN_POINTS, candlesSince, HERO_TF } from "./model";
import { agentTradesQuery, heroCandidates, liveLaunchesQuery } from "./queries";

/**
 * Server half of `useHeroPick`: fills the SSR cache with everything the Band instrument, the agent
 * simulator and the step fallbacks read, making the same pick (king with ≥ 12 candles in 24h, else
 * the most-traded live launch) so the hydrated client renders identically.
 */
export async function prefetchHero(client: QueryClient): Promise<{ seed: LaunchSummary | null; chart: LaunchSummary | null }> {
  const nowSec = Math.floor(Date.now() / 1000);
  await Promise.all([
    prefetch(client, platformQuery()),
    prefetch(client, trendingQuery()),
    prefetch(client, liveLaunchesQuery()),
    prefetch(client, launchesQuery({ status: "raising", sort: "new" })),
  ]);
  const { primary, fallback } = heroCandidates(
    client.getQueryData(trendingQuery().queryKey),
    client.getQueryData(liveLaunchesQuery().queryKey)?.launches,
  );
  const points = async (id: string) => {
    await prefetch(client, candlesQuery(id, HERO_TF));
    return candlesSince(client.getQueryData(candlesQuery(id, HERO_TF).queryKey)?.candles, nowSec).length;
  };
  let chart = primary && (await points(launchId(primary))) >= BAND_MIN_POINTS ? primary : null;
  if (!chart && fallback && fallback.address !== primary?.address && (await points(launchId(fallback))) >= BAND_MIN_POINTS) chart = fallback;
  const seed = chart ?? fallback ?? primary;
  await Promise.all([
    seed ? prefetch(client, launchQuery(launchId(seed))) : null,
    seed ? prefetch(client, backersQuery(launchId(seed))) : null,
    chart ? prefetch(client, recentTradesQuery(launchId(chart), 200)) : null,
    chart ? prefetch(client, agentTradesQuery(launchId(chart))) : null,
  ]);
  return { seed, chart };
}
