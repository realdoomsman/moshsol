import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { launchesQuery } from "@/lib/query-options";
import type { LaunchSummary } from "@/lib/types";
import type { Trending } from "@/lib/users";
import { mostTraded } from "./model";

/** Recent vault-agent trades for the chart markers (`/trades?agent=1`); under the `trades` prefix the websocket refreshes. */
export const agentTradesQuery = (mint: string) =>
  queryOptions({
    queryKey: ["trades", mint, "agent-recent", 100],
    queryFn: async () => (await api.trades(mint, { limit: 100, agent: true })).trades,
  });

/** Live launches for the hero fallback (shared with "On Holdfast now"). */
export const liveLaunchesQuery = () => launchesQuery({ status: "live", sort: "trending" });

/**
 * Hero token choice (§4.2 §1): the trending king (or the top trending launch), with the most-traded
 * live launch as the fallback when the king has too little history.
 */
export function heroCandidates(trending: Trending | undefined, live: LaunchSummary[] | undefined) {
  const primary = trending?.king?.launch ?? trending?.top[0] ?? null;
  const fallback = mostTraded(live ?? []) ?? primary;
  return { primary, fallback };
}
