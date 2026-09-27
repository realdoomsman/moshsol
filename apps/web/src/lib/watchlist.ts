"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Watchlist ★ (brief #29): mints saved in this browser (localStorage), shared by the token page
 * star and Discover's "Watching" filter. Renders empty on the server and while hydrating, then the
 * stored list; stays in sync across components and tabs.
 */
const KEY = "holdfast:watchlist";
const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cached: readonly string[] = EMPTY;

function read(): readonly string[] {
  const raw = window.localStorage.getItem(KEY);
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cached = Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: readonly string[]) {
  window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

export function useWatchlist(): { mints: readonly string[]; has: (mint: string) => boolean; toggle: (mint: string) => void } {
  const mints = useSyncExternalStore(subscribe, read, () => EMPTY);
  const has = useCallback((mint: string) => mints.includes(mint), [mints]);
  const toggle = useCallback((mint: string) => {
    const current = read();
    write(current.includes(mint) ? current.filter((m) => m !== mint) : [mint, ...current]);
  }, []);
  return { mints, has, toggle };
}
