"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Width/height of an element, tracked with a ResizeObserver. Renders with `fallback` on the server
 * and before the first measurement so SSR and hydration agree.
 */
export function useElementSize<T extends HTMLElement>(fallback: { width: number; height: number }) {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((s) => (Math.round(s.width) === Math.round(r.width) && Math.round(s.height) === Math.round(r.height) ? s : { width: r.width, height: r.height }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
