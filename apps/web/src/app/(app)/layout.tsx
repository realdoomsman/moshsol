import type { ReactNode } from "react";
import { SiteShell } from "@/components/shell/site-shell";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, healthQuery } from "@/lib/query-options";

/** Status dots are shell chrome: never hold the page for them longer than this. */
const STATUS_DEADLINE_MS = 600;

/** App routes (§4.3): the shared shell with every page inside the `frame-app` content frame. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, healthQuery(), STATUS_DEADLINE_MS),
    prefetch(client, agentStatusQuery(), STATUS_DEADLINE_MS),
  ]);
  return (
    <Hydrate client={client}>
      <SiteShell mainClassName="frame-app pt-6 pb-16 md:pt-8 md:pb-24">{children}</SiteShell>
    </Hydrate>
  );
}
