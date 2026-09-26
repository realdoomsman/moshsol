"use client";

import { Flame, Rocket, Search, SearchX, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { LaunchSort } from "@/lib/api";
import { useDebounced, useNow } from "@/lib/hooks";
import { phaseOf } from "@/lib/launch";
import { useLaunches } from "@/lib/queries";
import { ButtonLink } from "../ui/button";
import { Segmented } from "../ui/interactive";
import { EmptyState } from "../ui/primitives";
import { Hero } from "./hero";
import { LaunchCard, LaunchCardSkeleton } from "./launch-card";
import { StatsStrip } from "./stats-strip";

type Tab = "live" | "raising" | "ended";

const SORTS: { value: LaunchSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "new", label: "New" },
  { value: "mcap", label: "Market cap" },
  { value: "volume", label: "Volume" },
  { value: "raised", label: "Raised" },
];

const EMPTY: Record<Tab, { title: string; body: string }> = {
  live: { title: "No live launches yet", body: "Launches go live the moment their raise closes. Back one that's raising or start your own." },
  raising: { title: "Nothing raising right now", body: "Open a raise and let backers fund your locked bundle." },
  ended: { title: "No ended raises", body: "Cancelled raises and raises that missed their minimum show up here with refunds open." },
};

export function Explore() {
  const now = useNow(5_000);
  const [tab, setTab] = useState<Tab>("live");
  const [sort, setSort] = useState<LaunchSort>("trending");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const { data, isLoading, isError, refetch } = useLaunches({ status: "all", sort, q });

  const grouped = useMemo(() => {
    const out: Record<Tab, NonNullable<typeof data>["launches"]> = { live: [], raising: [], ended: [] };
    for (const l of data?.launches ?? []) {
      const phase = phaseOf(l, now);
      if (phase === "live") out.live.push(l);
      else if (phase === "raising" || phase === "ready") out.raising.push(l);
      else out.ended.push(l);
    }
    return out;
  }, [data, now]);

  const list = grouped[tab];

  return (
    <>
      <Hero />
      <StatsStrip />

      <section className="mt-12" aria-labelledby="launches-heading">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="launches-heading" className="text-2xl font-semibold tracking-tight">
              Launches
            </h2>
            <p className="mt-1 text-sm text-muted">Every bundle below is locked in its vault — check any of them on-chain.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block sm:w-64">
              <span className="sr-only">Search launches</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, symbol or mint"
                className="field h-10 py-0 pl-9 text-sm"
              />
            </label>
            <label className="relative block">
              <span className="sr-only">Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as LaunchSort)}
                className="field h-10 cursor-pointer appearance-none py-0 pr-9 text-sm font-medium sm:w-44"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value} className="bg-panel">
                    {s.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-dim">▾</span>
            </label>
          </div>
        </div>

        <div className="no-scrollbar mt-5 overflow-x-auto">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            ariaLabel="Launch status"
            options={[
              {
                value: "live",
                label: (
                  <>
                    <Flame className="size-3.5 text-up" aria-hidden /> Live <Count n={grouped.live.length} />
                  </>
                ),
              },
              {
                value: "raising",
                label: (
                  <>
                    <Sparkles className="size-3.5 text-violet" aria-hidden /> Raising <Count n={grouped.raising.length} />
                  </>
                ),
              },
              {
                value: "ended",
                label: (
                  <>
                    Ended<span className="hidden sm:inline"> · refunding</span> <Count n={grouped.ended.length} />
                  </>
                ),
              },
            ]}
          />
        </div>

        <div className="mt-5">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <LaunchCardSkeleton key={i} />
              ))}
            </div>
          ) : isError && !data ? (
            <div className="card">
              <EmptyState
                icon={<SearchX className="size-5" aria-hidden />}
                title="Can't reach the indexer"
                action={
                  <button type="button" onClick={() => void refetch()} className="text-sm font-semibold text-lime">
                    Retry
                  </button>
                }
              >
                Launch data comes from the moshsol indexer. It will reconnect automatically.
              </EmptyState>
            </div>
          ) : list.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={q ? <SearchX className="size-5" aria-hidden /> : <Rocket className="size-5" aria-hidden />}
                title={q ? `No ${tab} launches match “${q}”` : EMPTY[tab].title}
                action={
                  q ? null : (
                    <ButtonLink href="/create" variant="primary">
                      Create a launch
                    </ButtonLink>
                  )
                }
              >
                {q ? "Try another name, symbol or mint address." : EMPTY[tab].body}
              </EmptyState>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((l) => (
                <LaunchCard key={l.mint} launch={l} now={now} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded-md bg-white/[0.07] px-1.5 py-px text-[11px] tabular-nums text-muted">{n}</span>;
}
