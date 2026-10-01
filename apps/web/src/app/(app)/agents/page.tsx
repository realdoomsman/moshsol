import type { Metadata } from "next";
import { AgentsView } from "@/components/agents/agents-view";
import { LatestDecision } from "@/components/agents/latest-decision";
import { VideoSlot } from "@/components/landing/video-slot";
import { CLUSTER_NAME } from "@/lib/env";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, agentsQuery, launchesQuery, platformQuery } from "@/lib/query-options";

/** The agent's live status comes from a separate service; don't let it hold up the page. */
const AGENT_STATUS_DEADLINE_MS = 800;

export const metadata: Metadata = {
  title: "Agents",
  description: `The vault agent's status, rules, per-vault health, every decision and what it learned, live from ${CLUSTER_NAME}.`,
  alternates: { canonical: "/agents" },
};

export default async function AgentsPage() {
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, platformQuery()),
    prefetch(client, agentsQuery()),
    prefetch(client, launchesQuery({ status: "live", sort: "mcap" })),
    prefetch(client, agentStatusQuery(), AGENT_STATUS_DEADLINE_MS),
  ]);
  return (
    <Hydrate client={client}>
      <AgentsView
        aside={
          <VideoSlot
            name="agent-defends"
            label="The vault agent buying a dip and selling a rally inside its band"
            fallback={<LatestDecision />}
            fallbackCaption={`Live from ${CLUSTER_NAME} · the agent's newest decision`}
          />
        }
      />
    </Hydrate>
  );
}
