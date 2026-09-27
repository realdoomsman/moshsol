"use client";

import Link from "next/link";
import { useState } from "react";
import { CLUSTER_NAME } from "@/lib/env";
import { useLaunch, useLaunches } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { AgentSimulator } from "../band/agent-simulator";
import { useHeroPick } from "../band/use-hero-pick";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

/**
 * §5 panel: the simulator seeded with a real live launch — the featured one by default, or any live
 * launch picked from the list — using its vault, curve, window budgets and frozen terms.
 */
export function SimulatorPanel() {
  const { seed, loading, failed, retry, retrying } = useHeroPick();
  const live = useLaunches({ status: "live", sort: "trending" });
  const [picked, setPicked] = useState<string | null>(null);
  const options = live.data?.launches ?? [];
  const initial = options.find((l) => l.mint === picked) ?? seed;
  if (initial) return <Seeded key={initial.mint} initial={initial} options={options} onPick={setPicked} />;
  if (failed) {
    return (
      <ErrorState onRetry={retry} retrying={retrying}>
        Couldn&rsquo;t load a launch to simulate. Indexer unreachable.
      </ErrorState>
    );
  }
  return loading ? (
    <Skeleton className="h-[560px] w-full rounded-md" />
  ) : (
    <EmptyState>No live launch to simulate yet. The simulator seeds itself from the first one.</EmptyState>
  );
}

function Seeded({ initial, options, onPick }: { initial: LaunchSummary; options: LaunchSummary[]; onPick: (mint: string) => void }) {
  const fresh = useLaunch(initial.mint);
  const launch = fresh.data ?? initial;
  return (
    <div>
      {options.length > 1 ? (
        <div className="mb-4 flex justify-end">
          <Select
            label="Launch to simulate"
            prefix="Seeded with"
            size="sm"
            align="end"
            value={launch.mint}
            onChange={onPick}
            options={options.map((l) => ({ value: l.mint, label: `$${l.symbol}`, hint: l.name }))}
          />
        </div>
      ) : null}
      <AgentSimulator launch={launch} />
      <p className="micro mt-3 text-ink-3">
        Seeded with{" "}
        <Link href={`/launch/${launch.mint}`} className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
          ${launch.symbol}
        </Link>
        &rsquo;s live vault, curve and window budgets on {CLUSTER_NAME}. Nothing is sent; this is the program&rsquo;s arithmetic.
      </p>
    </div>
  );
}
