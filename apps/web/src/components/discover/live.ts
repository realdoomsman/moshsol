"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useLiveEvents } from "@/lib/live";

export interface Flash {
  dir: "up" | "down";
  /** Bumps per trade so the outline animation restarts. */
  n: number;
}

/** Last trade direction per mint, from the indexer websocket (§3.8.3 card outline flash). */
export function useTradeFlashes(): Record<string, Flash> {
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  useLiveEvents((e) => {
    if (e.type !== "trade") return;
    setFlashes((prev) => ({ ...prev, [e.mint]: { dir: e.isBuy ? "up" : "down", n: (prev[e.mint]?.n ?? 0) + 1 } }));
  });
  return flashes;
}

/** Pointer idle time after which a held list re-sorts anyway (§4.4). */
const HOLD_IDLE_MS = 5_000;

/**
 * "Cards never reorder under the cursor": while a mouse is over the list (and moved within the
 * last 5 s) the displayed order is held — launches that appear meanwhile go on top, removed ones
 * drop out — and the latest order applies when the pointer leaves or rests.
 */
export function useHeldOrder<T>(items: T[], idOf: (item: T) => string) {
  const [held, setHeld] = useState(false);
  const shown = useRef<string[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const byId = new Map(items.map((item) => [idOf(item), item]));
  let order = items.map(idOf);
  if (held && shown.current) {
    const prev = shown.current.filter((id) => byId.has(id));
    const prevSet = new Set(prev);
    order = [...order.filter((id) => !prevSet.has(id)), ...prev];
  }
  useEffect(() => {
    shown.current = order;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const release = useCallback(() => {
    window.clearTimeout(timer.current);
    setHeld(false);
  }, []);
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      setHeld(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(release, HOLD_IDLE_MS);
    },
    [release],
  );

  return {
    items: order.map((id) => byId.get(id)!),
    bind: { onPointerMove, onPointerLeave: release },
  };
}

/**
 * Ids that appeared after the first render (live inserts get the 240 ms height expand once).
 * Initial items and items already shown never animate.
 */
export function useFreshIds(ids: string[]): (id: string) => boolean {
  const known = useRef<Set<string> | null>(null);
  if (known.current === null) known.current = new Set(ids);
  useEffect(() => {
    for (const id of ids) known.current!.add(id);
  });
  return (id) => !known.current!.has(id);
}
