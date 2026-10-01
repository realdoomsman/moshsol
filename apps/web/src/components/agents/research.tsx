"use client";

import { timeAgo } from "@holdfast/sdk";
import { useAgentResearch } from "@/lib/queries";
import { Chip } from "../ui/chip";
import { EmptyState } from "../ui/empty-state";

const SHOWN = 5;

/**
 * "What the agent learned": the newest research notes from the agent's parameter loop, each a
 * summary, a date and whether the proposal was adopted. The agent service may be unreachable or
 * have nothing yet; both read as the empty state, never an error.
 */
export function ResearchNotes({ now }: { now: number }) {
  const research = useAgentResearch();
  const items = (research.data?.items ?? []).slice(0, SHOWN);
  return (
    <div className="rounded-md border border-line bg-surface">
      {!items.length ? (
        <EmptyState>{research.isLoading ? "Connecting to the agent…" : "The agent hasn't published a research note yet."}</EmptyState>
      ) : (
        <ol>
          {items.map((r) => (
            <li key={r.ts} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="small num text-ink-3">{timeAgo(r.ts, now)}</span>
                <Chip tone={r.adopted ? "ink" : "muted"}>{r.adopted ? "Adopted" : "Kept current parameters"}</Chip>
              </div>
              <p className="small max-w-[80ch] text-ink-2">{r.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
