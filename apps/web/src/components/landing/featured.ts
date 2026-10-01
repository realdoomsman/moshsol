import type { QueryClient } from "@tanstack/react-query";
import { launchId } from "@/lib/launch";
import { prefetch } from "@/lib/prefetch";
import { backersQuery, launchesQuery, launchQuery, platformQuery } from "@/lib/query-options";
import type { LaunchSummary } from "@/lib/types";
import { mostTraded } from "../band/model";

/** The live launches the landing shows ("On Holdfast now") and picks its featured launch from. */
export const liveLaunchesQuery = () => launchesQuery({ status: "live", sort: "trending" });

/** The featured launch (landing step fallbacks, proof tiles, docs examples): the most-traded live launch. */
export const featuredLaunch = (live: LaunchSummary[] | undefined): LaunchSummary | null => mostTraded(live ?? []);

/**
 * Server half of `useFeatured`: fills the SSR cache with the platform, the live and open launches
 * and the featured launch's own data so the hydrated client renders the same pick.
 */
export async function prefetchLanding(client: QueryClient): Promise<{ seed: LaunchSummary | null }> {
  await Promise.all([
    prefetch(client, platformQuery()),
    prefetch(client, liveLaunchesQuery()),
    prefetch(client, launchesQuery({ status: "raising", sort: "new" })),
  ]);
  const seed = featuredLaunch(client.getQueryData(liveLaunchesQuery().queryKey)?.launches);
  if (seed) await Promise.all([prefetch(client, launchQuery(launchId(seed))), prefetch(client, backersQuery(launchId(seed)))]);
  return { seed };
}
