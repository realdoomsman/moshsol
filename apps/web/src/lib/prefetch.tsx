import { dehydrate, type FetchQueryOptions, HydrationBoundary, QueryClient, type QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Server-side react-query cache for one render. Pages fill it with the same query options the
 * client hooks use (`query-options.ts`) and hand it to the browser through `<Hydrate>`, so the SSR
 * HTML already shows real data and the client cache starts warm (websocket updates apply as usual).
 */
export function serverQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * Prefetch one query. Never throws: a failed or slow fetch (see the server timeout in `api.ts`) is
 * left out of the dehydrated cache and the browser loads it as before. `deadlineMs` stops waiting
 * sooner for optional data from slower services.
 */
export async function prefetch<TData, TKey extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TKey>,
  deadlineMs?: number,
): Promise<void> {
  const done = client.prefetchQuery(options);
  if (deadlineMs === undefined) return done;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([done, new Promise<void>((resolve) => (timer = setTimeout(resolve, deadlineMs)))]);
  clearTimeout(timer);
}

/** Ships the settled server cache (successful queries only) to the browser's query client. */
export function Hydrate({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <HydrationBoundary state={dehydrate(client)}>{children}</HydrationBoundary>;
}
