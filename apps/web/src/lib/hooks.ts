"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;

/** True after hydration; lets client-only values render without SSR mismatches. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Unix seconds at which the server rendered this document. Clock-dependent UI (phases, countdowns,
 * "2m ago") renders against it on the server and while hydrating, so both passes agree.
 */
export const ServerNowContext = createContext<number | null>(null);

/** Wall clock in unix seconds, ticking every `ms`. */
export function useNow(ms = 1_000): number {
  const serverNow = useContext(ServerNowContext);
  const hydrating = !useMounted();
  const [now, setNow] = useState(() => (hydrating && serverNow !== null ? serverNow : Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    // Catch up from the server's clock right after hydration.
    tick();
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return;
    try {
      setValue(JSON.parse(raw) as T);
    } catch {
      window.localStorage.removeItem(key);
    }
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      window.localStorage.setItem(key, JSON.stringify(v));
    },
    [key],
  );
  return [value, set];
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Client media query (false during SSR). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
