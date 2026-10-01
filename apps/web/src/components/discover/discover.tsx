"use client";

import { Check, ListFilter, MoreHorizontal, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Sheet } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { MenuItem, Popover } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { useNow } from "@/lib/hooks";
import { launchId } from "@/lib/launch";
import { useLaunches } from "@/lib/queries";
import type { LaunchSummary } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { LaunchCard, LaunchCardSkeleton, LaunchRow } from "./launch-card";
import { LaunchTable } from "./launch-table";
import { useFreshIds, useHeldOrder, useTradeFlashes, type Flash } from "./live";
import {
  isToolbarSort,
  laneOf,
  LANES,
  sortLaunches,
  TOOLBAR_SORTS,
  VIEWS,
  type Lane,
  type Sort,
  type SortKey,
  type View,
} from "./model";
import { Spotlight } from "./spotlight";

/** The Live lane is always ranked by trending unless its own menu says otherwise (§4.4). */
const LANE_DEFAULT: Record<Lane, SortKey | null> = { raising: null, min: null, live: "trending" };

const LANE_EMPTY: Record<Lane, { text: string; action?: { href: string; label: string } }> = {
  raising: { text: "No raises open.", action: { href: "/create", label: "Start one" } },
  min: { text: "No raise has reached its minimum yet." },
  live: { text: "Nothing is trading yet.", action: { href: "/create", label: "Create a launch" } },
};

/** Mirror view/sort into the URL without a navigation, so the page is shareable and survives reloads. */
function writeUrl(view: View, sort: SortKey) {
  const url = new URL(window.location.href);
  if (view === "board") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  if (sort === "trending" || !isToolbarSort(sort)) url.searchParams.delete("sort");
  else url.searchParams.set("sort", sort);
  window.history.replaceState(window.history.state, "", url);
}

type Flashes = Record<string, Flash>;

function LaneList({
  lane,
  launches,
  now,
  flashes,
  isFresh,
  layout,
}: {
  lane: Lane;
  launches: LaunchSummary[];
  now: number;
  flashes: Flashes;
  isFresh: (id: string) => boolean;
  /** `cards` = board column; `rows` = the mobile list; `grid` = tablet two-up. */
  layout: "cards" | "rows" | "grid";
}) {
  const held = useHeldOrder(launches, launchId);
  if (!launches.length) {
    const empty = LANE_EMPTY[lane];
    // A quiet placeholder the size of what would be there: a card in a column, a row in the list.
    return (
      <div
        className={cn(
          "grid place-items-center rounded-md border border-dashed border-line-2",
          layout === "rows" ? "min-h-[72px]" : "min-h-[196px]",
        )}
      >
        <EmptyState
          action={
            empty.action ? (
              <Link
                href={empty.action.href}
                className="ui text-ink underline decoration-ink-3/60 underline-offset-4 transition-colors hover:decoration-ink"
              >
                {empty.action.label} →
              </Link>
            ) : undefined
          }
        >
          {empty.text}
        </EmptyState>
      </div>
    );
  }
  if (layout === "rows") {
    return (
      <div {...held.bind} className="rounded-md border border-line bg-surface px-3">
        {held.items.map((l) => (
          <LaunchRow key={launchId(l)} launch={l} now={now} flash={flashes[l.mint]} fresh={isFresh(launchId(l))} />
        ))}
      </div>
    );
  }
  return (
    <div {...held.bind} className={cn("grid gap-3", layout === "grid" && "sm:grid-cols-2")}>
      {held.items.map((l) => (
        <LaunchCard key={launchId(l)} launch={l} now={now} flash={flashes[l.mint]} fresh={isFresh(launchId(l))} />
      ))}
    </div>
  );
}

function LaneSortMenu({ lane, value, onChange }: { lane: Lane; value: SortKey | null; onChange: (v: SortKey | null) => void }) {
  const label = LANES.find((l) => l.value === lane)!.label;
  return (
    <Popover
      role="menu"
      label={`Sort ${label}`}
      placement="bottom-end"
      width={220}
      trigger={(p) => (
        <IconButton {...p} label={`Sort ${label}`} size="sm" className={cn(value !== null && lane !== "live" && "text-ink")}>
          <ListFilter className="size-4" strokeWidth={1.5} />
        </IconButton>
      )}
    >
      <div className="py-1">
        <MenuItem
          onClick={() => onChange(null)}
          icon={<Check className={cn("size-4", value === null ? "opacity-100" : "opacity-0")} strokeWidth={1.5} />}
        >
          Same as page sort
        </MenuItem>
        {TOOLBAR_SORTS.map((s) => (
          <MenuItem
            key={s.value}
            onClick={() => onChange(s.value)}
            icon={<Check className={cn("size-4", value === s.value ? "opacity-100" : "opacity-0")} strokeWidth={1.5} />}
          >
            {s.label}
          </MenuItem>
        ))}
      </div>
    </Popover>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-3">
          <LaunchCardSkeleton />
          <LaunchCardSkeleton />
        </div>
      ))}
    </div>
  );
}

/**
 * Discover `/app` (§4.4): spotlight, then the launch list as a lifecycle Board (Raising · Min
 * reached · Live), a Grid or a Table. Live over the indexer websocket: cards outline-flash on
 * trades, new launches expand in, re-sorts wait for the pointer to leave.
 */
export function Discover({ initialView, initialSort }: { initialView: View; initialSort: SortKey }) {
  const now = useNow(15_000);
  const [view, setViewState] = useState<View>(initialView);
  const [sort, setSortState] = useState<Sort>({ key: initialSort, dir: "desc" });
  const [laneSort, setLaneSort] = useState<Record<Lane, SortKey | null>>(LANE_DEFAULT);
  const [mobileLane, setMobileLane] = useState<Lane>("live");
  const [watchingOnly, setWatchingOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const watchlist = useWatchlist();

  const launches = useLaunches({ status: "all", sort: "trending" });
  const flashes = useTradeFlashes();
  const all = launches.data?.launches ?? [];
  const isFresh = useFreshIds(all.map(launchId));

  const setView = useCallback(
    (v: View) => {
      setViewState(v);
      writeUrl(v, sort.key);
    },
    [sort.key],
  );
  const setToolbarSort = useCallback(
    (key: SortKey) => {
      setSortState({ key, dir: "desc" });
      writeUrl(view, key);
    },
    [view],
  );
  /** Table header click: toggles direction on the active column. */
  const onTableSort = (key: SortKey) =>
    setSortState((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const watched = watchingOnly ? all.filter((l) => watchlist.has(launchId(l))) : all;
  const sorted = sortLaunches(watched, sort, now);
  const lanes: Record<Lane, LaunchSummary[]> = { raising: [], min: [], live: [] };
  for (const lane of LANES) {
    const key = laneSort[lane.value];
    const list = key ? sortLaunches(watched, { key, dir: "desc" }, now) : sorted;
    lanes[lane.value] = list.filter((l) => laneOf(l, now) === lane.value);
  }

  const watchToggle = (
    <Button
      size="sm"
      variant={watchingOnly ? "primary" : "secondary"}
      aria-pressed={watchingOnly}
      icon={<Star className="size-4" strokeWidth={1.5} fill={watchingOnly ? "currentColor" : "none"} />}
      onClick={() => setWatchingOnly((w) => !w)}
    >
      Watching <span className="num text-current/70">{watchlist.ids.length}</span>
    </Button>
  );
  const sortSelect = (
    <Select
      label="Sort launches"
      prefix="Sort"
      size="sm"
      align="end"
      value={isToolbarSort(sort.key) ? sort.key : "trending"}
      onChange={setToolbarSort}
      options={TOOLBAR_SORTS}
    />
  );

  let body;
  if (launches.isError && !launches.data) {
    body = (
      <ErrorState onRetry={() => void launches.refetch()} retrying={launches.isFetching}>
        Couldn&apos;t load launches. Indexer unreachable.
      </ErrorState>
    );
  } else if (!launches.data) {
    body = <BoardSkeleton />;
  } else if (watchingOnly && !watched.length) {
    body = (
      <EmptyState
        action={
          <Button size="sm" variant="secondary" onClick={() => setWatchingOnly(false)}>
            Show all launches
          </Button>
        }
      >
        {watchlist.ids.length
          ? "None of your watched launches are listed right now."
          : "You're not watching any launches. Star one on its page to follow it here."}
      </EmptyState>
    );
  } else if (!all.length) {
    body = (
      <EmptyState
        action={
          <Link href="/create" className="ui text-ink underline decoration-ink-3/60 underline-offset-4 transition-colors hover:decoration-ink">
            Create the first launch →
          </Link>
        }
      >
        No launches yet.
      </EmptyState>
    );
  } else if (view === "table") {
    body = <LaunchTable launches={sorted} now={now} sort={sort} onSort={onTableSort} flashes={flashes} />;
  } else if (view === "grid") {
    body = (
      <>
        <div className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((l) => (
            <LaunchCard key={launchId(l)} launch={l} now={now} flash={flashes[l.mint]} fresh={isFresh(launchId(l))} />
          ))}
        </div>
        <div className="md:hidden">
          <LaneList lane="live" launches={sorted} now={now} flashes={flashes} isFresh={isFresh} layout="rows" />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="hidden gap-4 lg:grid lg:grid-cols-3">
          {LANES.map((lane) => (
            <section key={lane.value} aria-labelledby={`lane-${lane.value}`} className="min-w-0">
              <header className="mb-3 flex h-10 items-center justify-between gap-2 border-b border-line">
                <h2 id={`lane-${lane.value}`} className="label text-ink-3">
                  {lane.label} <span className="num text-ink-2">({lanes[lane.value].length})</span>
                </h2>
                <LaneSortMenu
                  lane={lane.value}
                  value={laneSort[lane.value]}
                  onChange={(v) => setLaneSort((s) => ({ ...s, [lane.value]: v }))}
                />
              </header>
              <div className="no-scrollbar max-h-[calc(100dvh-160px)] overflow-y-auto pb-1">
                <LaneList lane={lane.value} launches={lanes[lane.value]} now={now} flashes={flashes} isFresh={isFresh} layout="cards" />
              </div>
            </section>
          ))}
        </div>
        <div className="lg:hidden">
          <Segmented
            label="Board lane"
            stretch
            value={mobileLane}
            onChange={setMobileLane}
            items={LANES.map((l) => ({ value: l.value, label: `${l.short} ${lanes[l.value].length}` }))}
          />
          <div className="mt-3 hidden md:block">
            <LaneList lane={mobileLane} launches={lanes[mobileLane]} now={now} flashes={flashes} isFresh={isFresh} layout="grid" />
          </div>
          <div className="mt-3 md:hidden">
            <LaneList lane={mobileLane} launches={lanes[mobileLane]} now={now} flashes={flashes} isFresh={isFresh} layout="rows" />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="display-m text-ink">Discover</h1>
        <div className="hidden items-center gap-2 md:flex">
          {watchToggle}
          <Segmented label="View" size="sm" value={view} onChange={setView} items={VIEWS} />
          {sortSelect}
        </div>
        <div className="md:hidden">
          <IconButton label="View and sort" variant="secondary" onClick={() => setSheetOpen(true)}>
            <MoreHorizontal className="size-5" strokeWidth={1.5} />
          </IconButton>
        </div>
      </header>

      <div className="flex flex-col gap-8">
        {launches.data ? <Spotlight launches={all} now={now} /> : null}
        {body}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="View and sort">
        <div className="flex flex-col gap-5 px-5 pt-1 pb-5">
          <div>
            <div className="label mb-2 text-ink-3">View</div>
            <Segmented label="View" stretch value={view} onChange={setView} items={VIEWS} />
          </div>
          <div>
            <div className="label mb-2 text-ink-3">Sort</div>
            <div role="radiogroup" aria-label="Sort launches" className="flex flex-col">
              {TOOLBAR_SORTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={sort.key === s.value}
                  onClick={() => {
                    setToolbarSort(s.value);
                    setSheetOpen(false);
                  }}
                  className="ui flex min-h-11 items-center justify-between border-b border-line text-left text-ink last:border-b-0"
                >
                  {s.label}
                  {sort.key === s.value ? <Check className="size-4" strokeWidth={1.5} /> : null}
                </button>
              ))}
            </div>
          </div>
          <div>{watchToggle}</div>
        </div>
      </Sheet>
    </div>
  );
}
