import type { ReactNode } from "react";
import { SiteShell } from "@/components/shell/site-shell";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, healthQuery } from "@/lib/query-options";

/** Status dots are chrome: never hold the page for them longer than this. */
const STATUS_DEADLINE_MS = 600;

/** Landing and docs (§4.2, §4.11): the shared shell; sections bring their own `frame-marketing`. */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, healthQuery(), STATUS_DEADLINE_MS),
    prefetch(client, agentStatusQuery(), STATUS_DEADLINE_MS),
  ]);
  return (
    <Hydrate client={client}>
      <SiteShell>{children}</SiteShell>
    </Hydrate>
  );
}
