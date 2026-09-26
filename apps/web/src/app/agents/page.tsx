import type { Metadata } from "next";
import { AgentsView } from "@/components/agents/agents-view";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <div className="pt-4 pb-8">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Agents, in the open</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Every vault is traded by an agent that can only act inside hard limits written into the program. Here are the
          limits, what the agent is thinking right now, and everything it has done.
        </p>
      </div>
      <AgentsView />
    </div>
  );
}
