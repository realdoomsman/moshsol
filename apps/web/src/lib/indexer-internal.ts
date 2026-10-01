import { INDEXER_URL } from "./env";

const INDEXER_ORIGIN = new URL(INDEXER_URL).origin;

/**
 * `init` plus `x-holdfast-internal: INDEXER_INTERNAL_TOKEN` when this runs on the server and `url` is on the indexer:
 * server renders, route handlers and OG images reach the indexer from a few shared egress IPs on behalf of every
 * visitor, and the token exempts them from its per-IP budget (its `INTERNAL_TOKEN`). The token is a server-only secret:
 * never `NEXT_PUBLIC_`, and the `typeof window` branch is compiled out of client bundles, the env read with it.
 */
export function withIndexerToken(url: string, init?: RequestInit): RequestInit | undefined {
  const token = typeof window === "undefined" ? process.env.INDEXER_INTERNAL_TOKEN : undefined;
  if (!token || new URL(url).origin !== INDEXER_ORIGIN) return init;
  const headers = new Headers(init?.headers);
  headers.set("x-holdfast-internal", token);
  return { ...init, headers };
}
