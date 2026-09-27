"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export type Placement = "bottom-start" | "bottom" | "bottom-end" | "top-start" | "top" | "top-end";

const VIEWPORT_MARGIN = 8;

/**
 * Positions a portalled element (`position: fixed`) against an anchor: flips above/below when
 * there's no room, keeps 8px inside the viewport, follows scroll/resize while open. Used by
 * Popover, Menu, Select and Tooltip so overlays never get clipped by `overflow: hidden` panels.
 */
export function useFloating<A extends HTMLElement = HTMLElement>(open: boolean, placement: Placement, offset = 8) {
  const anchorRef = useRef<A | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0, visibility: "hidden" });

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const a = anchor.getBoundingClientRect();
    const w = floating.offsetWidth;
    const h = floating.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const [side, align = "center"] = placement.split("-") as ["top" | "bottom", "start" | "end" | undefined];
    const below = a.bottom + offset;
    const above = a.top - offset - h;
    let top = side === "bottom" ? below : above;
    if (side === "bottom" && below + h > vh - VIEWPORT_MARGIN && above >= VIEWPORT_MARGIN) top = above;
    if (side === "top" && above < VIEWPORT_MARGIN && below + h <= vh - VIEWPORT_MARGIN) top = below;
    let left = align === "start" ? a.left : align === "end" ? a.right - w : a.left + a.width / 2 - w / 2;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - w - VIEWPORT_MARGIN));
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN));
    setStyle({ position: "fixed", top, left });
  }, [placement, offset]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ position: "fixed", top: 0, left: 0, visibility: "hidden" });
      return;
    }
    update();
    const ro = new ResizeObserver(update);
    if (floatingRef.current) ro.observe(floatingRef.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, update]);

  return { anchorRef, floatingRef, style };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}
