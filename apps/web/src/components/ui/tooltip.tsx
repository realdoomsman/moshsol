"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { useFloating, type Placement } from "./floating";

const SHOW_DELAY_MS = 300;

function useTooltip(placement: Placement) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const floating = useFloating<HTMLElement>(open, placement, 6);
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!floating.anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, floating.anchorRef]);
  return { open, setOpen, show, hide, ...floating };
}

function Bubble({
  id,
  open,
  style,
  floatingRef,
  children,
}: {
  id: string;
  open: boolean;
  style: CSSProperties;
  floatingRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div
      ref={floatingRef}
      id={id}
      role="tooltip"
      style={style}
      className="small pointer-events-none z-[60] max-w-[280px] animate-pop-in rounded-sm bg-raised px-3 py-2 text-pretty text-ink shadow-pop"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Hover/focus hint (§4.12: `raised`, `small`, max 280px, after 300 ms). Wraps its children in an
 * inline span; for a focusable trigger put a button/link inside. Touch users get it on tap.
 */
export function Tooltip({
  content,
  placement = "top",
  className,
  children,
}: {
  content: ReactNode;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const t = useTooltip(placement);
  return (
    <span
      ref={t.anchorRef}
      aria-describedby={t.open ? id : undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && t.show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && t.hide()}
      onFocus={t.show}
      onBlur={t.hide}
      className={cn("inline-flex", className)}
    >
      {children}
      <Bubble id={id} open={t.open} style={t.style} floatingRef={t.floatingRef}>
        {content}
      </Bubble>
    </span>
  );
}

/**
 * A dotted-underlined term that explains itself (§5.1 #21c, Jupiter/Hyperliquid convention): the
 * rule, formula or threshold in one sentence. Use on stat labels and jargon (EMA, band, bundle,
 * vault avg cost, impact). Keyboard-focusable; tap toggles on touch.
 *
 *   <RuleTooltip rule="Circulating supply × price.">Market cap</RuleTooltip>
 */
export function RuleTooltip({
  rule,
  placement = "top",
  className,
  children,
}: {
  rule: ReactNode;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const t = useTooltip(placement);
  return (
    <>
      <button
        ref={t.anchorRef as RefObject<HTMLButtonElement | null>}
        type="button"
        aria-describedby={t.open ? id : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && t.show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && t.hide()}
        onFocus={t.show}
        onBlur={t.hide}
        onClick={(e) => {
          if ((e.nativeEvent as PointerEvent).pointerType !== "mouse") t.setOpen(!t.open);
        }}
        className={cn(
          "cursor-help text-left underline decoration-ink-3 decoration-dotted decoration-1 underline-offset-[3px] [font:inherit] [letter-spacing:inherit] [text-transform:inherit]",
          className,
        )}
      >
        {children}
      </button>
      <Bubble id={id} open={t.open} style={t.style} floatingRef={t.floatingRef}>
        {rule}
      </Bubble>
    </>
  );
}
