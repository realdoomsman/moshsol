import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard/leaderboard";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { launchesQuery, platformQuery, statsQuery } from "@/lib/query-options";
import { leaderboardQuery, type LeaderboardKind, type LeaderboardWindow } from "@/lib/users";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Top backers, creators, traders and launches on Holdfast by fees, volume and raises.",
};

const KINDS: readonly LeaderboardKind[] = ["backers", "creators", "traders", "launches"];
const WINDOWS: readonly LeaderboardWindow[] = ["24h", "7d", "all"];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = KINDS.find((k) => k === params.kind) ?? "backers";
  const range = WINDOWS.find((w) => w === params.window) ?? "all";

  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, leaderboardQuery(kind, range)),
    prefetch(client, leaderboardQuery("backers", "all")),
    prefetch(client, statsQuery()),
    prefetch(client, platformQuery()),
    kind === "launches" ? prefetch(client, launchesQuery({ status: "all", sort: "trending" })) : null,
  ]);
  return (
    <Hydrate client={client}>
      <Leaderboard initialKind={kind} initialWindow={range} />
    </Hydrate>
  );
}
