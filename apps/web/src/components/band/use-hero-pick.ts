"use client";

import { useQuery } from "@tanstack/react-query";
import { useNow } from "@/lib/hooks";
import { launchId } from "@/lib/launch";
import { useCandles, useLaunches } from "@/lib/queries";
import { trendingQuery } from "@/lib/users";
import { BAND_MIN_POINTS, candlesSince, HERO_TF } from "./model";
import { heroCandidates } from "./queries";

/**
 * The landing's featured launch (§4.2 §1): the trending king (or top trending), else the most-traded
 * live launch. `chartLaunch` is the first of those with ≥ 12 candles in the last 24h (null → draw the
 * simulator instead); `seed` is the launch the instrument, simulator and step fallbacks show.
 */
export function useHeroPick() {
  const nowSec = useNow(30_000);
  const trending = useQuery({ ...trendingQuery(), refetchInterval: 30_000 });
  const live = useLaunches({ status: "live", sort: "trending" });
  const { primary, fallback } = heroCandidates(trending.data, live.data?.launches);

  const primaryCandles = useCandles(primary ? launchId(primary) : "", HERO_TF, !!primary);
  const primaryPoints = candlesSince(primaryCandles.data?.candles, nowSec).length;
  const needFallback =
    !!fallback &&
    fallback.address !== primary?.address &&
    (!primary || (primaryCandles.isSuccess && primaryPoints < BAND_MIN_POINTS));
  const fallbackCandles = useCandles(fallback ? launchId(fallback) : "", HERO_TF, needFallback);
  const fallbackPoints = candlesSince(fallbackCandles.data?.candles, nowSec).length;

  const chartLaunch =
    primary && primaryPoints >= BAND_MIN_POINTS ? primary : needFallback && fallbackPoints >= BAND_MIN_POINTS ? fallback : null;
  return {
    nowSec,
    seed: chartLaunch ?? fallback ?? primary,
    chartLaunch,
    /** Still finding out whether the king can be drawn. */
    deciding: !!primary && primaryCandles.isPending,
    loading: trending.isPending || live.isPending,
    failed: trending.isError && live.isError,
    retry: () => void Promise.all([trending.refetch(), live.refetch()]),
    retrying: trending.isFetching || live.isFetching,
  };
}
