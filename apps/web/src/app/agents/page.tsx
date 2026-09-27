import type { Metadata } from "next";
import { AgentsView } from "@/components/agents/agents-view";
import { PageHeader } from "@/components/ui/page-header";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, agentsQuery, platformQuery } from "@/lib/query-options";

/** The agent's live status comes from a separate service; don't let it hold up the page. */
const AGENT_STATUS_DEADLINE_MS = 800;

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, platformQuery()),
    prefetch(client, agentsQuery()),
    prefetch(client, agentStatusQuery(), AGENT_STATUS_DEADLINE_MS),
  ]);
  return (
    <div className="pt-4 pb-8">
      <PageHeader eyebrow="Agent transparency" title="Agents, in the open" tone="cyan">
        Every vault is traded by an agent that can only act inside hard limits written into the program. Here are the
        limits, what the agent is thinking right now, and everything it has done.
      </PageHeader>
      <Hydrate client={client}>
        <AgentsView />
      </Hydrate>
    </div>
  );
}
