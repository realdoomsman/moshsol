"use client";

import { X } from "lucide-react";
import { AnimatePresence, useDragControls } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery, useMounted } from "@/lib/hooks";
import { IconButton } from "./button";
import { cn } from "./cn";
import { focusables } from "./floating";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** --dur-4 in, a quicker exit. */
const ENTER = { duration: 0.36, ease: EASE_OUT };
const EXIT = { duration: 0.2, ease: EASE_OUT };

export type Presentation = "dialog" | "sheet" | "fullscreen";

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading (`h2`). Always rendered for screen readers; `hideTitle` hides it visually. */
  title: ReactNode;
  hideTitle?: boolean;
  /** One line under the title (`small ink-2`). */
  description?: ReactNode;
  children: ReactNode;
  /** Pinned under the scrolling body (e.g. action buttons, "New to Solana?" links). */
  footer?: ReactNode;
  /** Dialog width in px (desktop). Default 440. */
  width?: number;
  /** Element to focus on open (default: first focusable in the body). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Replaces the title row (e.g. the command palette's search input). */
  header?: ReactNode;
  /** Distance from the top of the viewport on desktop (default centred). e.g. "15vh". */
  top?: string;
  className?: string;
}

/** Keeps Tab inside `root`, restores focus on close, locks page scroll. */
function useModalBehaviour(open: boolean, root: RefObject<HTMLDivElement | null>, initialFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    const id = window.requestAnimationFrame(() => {
      const target = initialFocus?.current ?? focusables(root.current).find((el) => !el.dataset.dialogClose) ?? root.current;
      target?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(id);
      html.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, root, initialFocus]);
}

function trapTab(e: KeyboardEvent<HTMLDivElement>, root: HTMLDivElement | null, close: () => void) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== "Tab") return;
  const items = focusables(root);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function Overlay({ presentation, ...p }: OverlayProps & { presentation: Presentation }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const drag = useDragControls();
  const close = () => p.onOpenChange(false);
  useModalBehaviour(p.open, panel, p.initialFocus);

  const sheet = presentation === "sheet";
  const full = presentation === "fullscreen";

  const titleRow = p.header ?? (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", p.hideTitle && "sr-only")}>
      <div className="min-w-0">
        <h2 id={titleId} className="h2 text-ink">
          {p.title}
        </h2>
        {p.description ? (
          <p id={descId} className="small mt-1 text-ink-2">
            {p.description}
          </p>
        ) : null}
      </div>
      <IconButton label="Close" size="sm" onClick={close} className="-mt-1 -mr-2" data-dialog-close="true">
        <X className="size-4" strokeWidth={1.5} aria-hidden />
      </IconButton>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70]">
      <m.div
        aria-hidden
        className="absolute inset-0 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: ENTER }}
        exit={{ opacity: 0, transition: EXIT }}
        onClick={close}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex",
          sheet ? "items-end" : full ? "items-stretch" : cn("justify-center p-4", p.top ? "items-start" : "items-center"),
        )}
        style={!sheet && !full && p.top ? { paddingTop: p.top } : undefined}
      >
        <m.div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={p.header ? undefined : titleId}
          aria-label={p.header && typeof p.title === "string" ? p.title : undefined}
          aria-describedby={p.description ? descId : undefined}
          tabIndex={-1}
          onKeyDown={(e) => trapTab(e, panel.current, close)}
          className={cn(
            "pointer-events-auto flex flex-col bg-raised text-ink shadow-pop outline-none",
            sheet && "max-h-[90dvh] w-full rounded-t-lg pb-[env(safe-area-inset-bottom)]",
            full && "h-dvh w-full",
            !sheet && !full && "max-h-[calc(100dvh-32px)] w-full rounded-lg",
            p.className,
          )}
          style={!sheet && !full ? { maxWidth: p.width ?? 440 } : undefined}
          initial={sheet ? { y: "100%" } : full ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
          animate={sheet ? { y: 0, transition: ENTER } : { opacity: 1, y: 0, scale: 1, transition: ENTER }}
          exit={sheet ? { y: "100%", transition: EXIT } : { opacity: 0, y: 4, scale: 0.98, transition: EXIT }}
          drag={sheet ? "y" : false}
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 96 || info.velocity.y > 600) close();
          }}
        >
          {sheet ? (
            <div
              className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
              onPointerDown={(e) => drag.start(e)}
              aria-hidden
            >
              <span className="h-1 w-9 rounded-full bg-line-2" />
            </div>
          ) : null}
          {titleRow}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{p.children}</div>
          {p.footer ? <div className="shrink-0 border-t border-line px-5 py-4">{p.footer}</div> : null}
        </m.div>
      </div>
    </div>
  );
}

/**
 * Modal (§3.6 elevation 3: `raised`, 16px radius, scrim, no blur). Below 768px it becomes a bottom
 * sheet (`mobile="sheet"`, default), a full-screen page (`"fullscreen"`) or stays a dialog.
 * Escape, scrim click and the × close it; focus is trapped and restored.
 */
export function Dialog({ mobile = "sheet", ...props }: OverlayProps & { mobile?: Presentation }) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const mounted = useMounted();
  if (!mounted) return null;
  const presentation: Presentation = narrow ? mobile : "dialog";
  return createPortal(
    <AnimatePresence>{props.open ? <Overlay key="overlay" presentation={presentation} {...props} /> : null}</AnimatePresence>,
    document.body,
  );
}

/** Bottom sheet at every width (mobile trade panel, "More" menu): 16px top radius, drag handle, ≤ 90vh. */
export function Sheet(props: OverlayProps) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{props.open ? <Overlay key="overlay" presentation="sheet" {...props} /> : null}</AnimatePresence>,
    document.body,
  );
}
