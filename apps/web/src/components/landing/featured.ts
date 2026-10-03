import type { QueryClient } from "@tanstack/react-query";
import { launchId } from "@/lib/launch";
import { prefetch } from "@/lib/prefetch";
import { backersQuery, launchesQuery, launchQuery, platformQuery } from "@/lib/query-options";
import type { LaunchSummary } from "@/lib/types";
import { officialMintOf } from "@/lib/official";
import { mostTraded } from "../band/model";

/** The live launches the landing shows ("On Holdfast now") and picks its featured launch from. */
export const liveLaunchesQuery = () => launchesQuery({ status: "live", sort: "trending" });

/** The featured launch (landing step fallbacks, proof tiles, docs examples): the official Holdfast token while it is live, else the most-traded live launch. */
export const featuredLaunch = (live: LaunchSummary[] | undefined, officialMint: string | null): LaunchSummary | null =>
  live?.find((l) => l.mint === officialMint && l.status === "live") ?? mostTraded(live ?? []);

/**
 * Server half of `useFeatured`: fills the SSR cache with the platform, the official token's launch, the live and
 * open launches and the featured launch's own data so the hydrated client renders the same pick.
 */
export async function prefetchLanding(client: QueryClient): Promise<{ seed: LaunchSummary | null }> {
  await Promise.all([
    prefetchOfficial(client),
    prefetch(client, liveLaunchesQuery()),
    prefetch(client, launchesQuery({ status: "raising", sort: "new" })),
  ]);
  const officialMint = officialMintOf(client.getQueryData(platformQuery().queryKey)?.params);
  const seed = featuredLaunch(client.getQueryData(liveLaunchesQuery().queryKey)?.launches, officialMint);
  if (seed) await Promise.all([prefetch(client, launchQuery(launchId(seed))), prefetch(client, backersQuery(launchId(seed)))]);
  return { seed };
}

/** The platform, then the official token's launch (by mint, as `useOfficial` reads it) once `buybackMint` is set. */
export async function prefetchOfficial(client: QueryClient): Promise<void> {
  await prefetch(client, platformQuery());
  const mint = officialMintOf(client.getQueryData(platformQuery().queryKey)?.params);
  if (mint) await prefetch(client, launchQuery(mint));
}
