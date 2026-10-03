"use client";

import { useNow } from "@/lib/hooks";
import { useLaunches, useOfficialMint } from "@/lib/queries";
import { featuredLaunch } from "./featured";

/** Client half of `prefetchLanding`: the featured launch (official token, else most-traded live launch), refreshed with the live list. */
export function useFeatured() {
  const nowSec = useNow(30_000);
  const live = useLaunches({ status: "live", sort: "trending" });
  return { nowSec, seed: featuredLaunch(live.data?.launches, useOfficialMint()), loading: live.isPending };
}
