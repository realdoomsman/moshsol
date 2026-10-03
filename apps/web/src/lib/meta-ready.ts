import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import { useNow } from "./hooks";

const RETRY_MS = 5_000;
/** After this long without the metadata being served, the launcher may launch anyway. */
const LAUNCH_ANYWAY_AFTER_SECS = 5 * 60;

/**
 * Whether a launch's metadata URI and its image are publicly served yet (`GET /api/meta-ready`: the indexer
 * fetches both, as the page CSP keeps the browser off the gateways). pump.fun reads the URI once when
 * `launch_pump` creates the token, and Arweave gateways can 404 a fresh upload for minutes, so launching waits for
 * it. Polls every 5 s until ready; `overdue` turns true 5 min after the wait began.
 */
export function useMetaReady(uri: string, enabled: boolean): { ready: boolean; overdue: boolean } {
  const q = useQuery({
    queryKey: ["meta-ready", uri],
    queryFn: () => api.metaReady(uri),
    enabled,
    retry: false,
    staleTime: (query) => (query.state.data?.ready ? Infinity : 0),
    refetchInterval: (query) => (query.state.data?.ready ? false : RETRY_MS),
  });
  const now = useNow(RETRY_MS);
  const [since] = useState(now);
  return { ready: q.data?.ready === true, overdue: now - since >= LAUNCH_ANYWAY_AFTER_SECS };
}
