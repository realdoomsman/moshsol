"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { focusables, useFloating, type Placement } from "./floating";

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog" | "menu" | "listbox";
  "aria-controls": string | undefined;
}

/**
 * Anchored overlay (§4.12: `raised`, 12px radius, elevation 2, 240 ms in). Portalled to <body> so
 * tables and scroll panels never clip it. Closes on Escape (focus returns to the trigger), outside
 * press and when focus leaves it. `children` may be a render function receiving `close`.
 *
 *   <Popover trigger={(p) => <button {...p}>Open</button>}>{(close) => …}</Popover>
 */
export function Popover({
  trigger,
  children,
  open: openProp,
  onOpenChange,
  placement = "bottom-end",
  role = "dialog",
  label,
  width,
  focusOnOpen = true,
  className,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  /** `menu` = arrow-key navigation between `MenuItem`s. */
  role?: "dialog" | "menu" | "listbox";
  /** Accessible name of the overlay. */
  label?: string;
  /** Fixed width in px (default: fit content, min 200). */
  width?: number;
  /** Move focus into the overlay when it opens (first focusable element). */
  focusOnOpen?: boolean;
  className?: string;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const id = useId();
  const { anchorRef, floatingRef, style } = useFloating<HTMLButtonElement>(open, placement);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen) {
      const first = floatingRef.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? focusables(floatingRef.current)[0];
      first?.focus({ preventScroll: true });
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!floatingRef.current?.contains(t) && !anchorRef.current?.contains(t)) close();
    };
    // Escape closes even when focus isn't inside (e.g. after a mouse open); focus returns to the trigger.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      close();
      if (floatingRef.current?.contains(document.activeElement)) anchorRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, focusOnOpen, close, anchorRef, floatingRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Handled here so an enclosing Dialog doesn't also close (React events bubble through portals).
      e.preventDefault();
      e.stopPropagation();
      close();
      anchorRef.current?.focus();
      return;
    }
    if (role !== "menu") return;
    const items = Array.from(floatingRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (move === undefined || !items.length) return;
    e.preventDefault();
    items[(move + items.length) % items.length]?.focus();
  };

  return (
    <>
      {trigger({
        ref: anchorRef,
        onClick: () => setOpen(!open),
        "aria-expanded": open,
        "aria-haspopup": role,
        "aria-controls": open ? id : undefined,
      })}
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              onClick={(e) => {
                if (role === "menu" && (e.target as HTMLElement).closest('[role="menuitem"]')) close();
              }}
              id={id}
              role={role}
              aria-label={label}
              style={{ ...style, width }}
              onKeyDown={onKeyDown}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && !floatingRef.current?.contains(next) && !anchorRef.current?.contains(next)) close();
              }}
              className={cn(
                "z-50 max-h-[min(480px,calc(100dvh-16px))] min-w-[200px] animate-pop-in overflow-auto rounded-md bg-raised text-ink shadow-pop",
                className,
              )}
            >
              {typeof children === "function" ? children(close) : children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const ITEM =
  "ui flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-ink-2 outline-none transition-colors " +
  "hover:bg-ink/[0.06] hover:text-ink focus-visible:bg-ink/[0.06] focus-visible:text-ink focus-visible:outline-none";

type MenuItemProps = { icon?: ReactNode; tone?: "default" | "danger"; children: ReactNode; className?: string };

/** A row in a `role="menu"` Popover: a button, an internal link (`href`) or an external link (`external`). */
export function MenuItem(
  props: MenuItemProps &
    (
      | ({ href?: undefined } & Omit<ComponentProps<"button">, "children" | "className">)
      | ({ href: string; external?: false } & Omit<ComponentProps<typeof Link>, "children" | "className" | "href">)
      | ({ href: string; external: true } & Omit<ComponentProps<"a">, "children" | "className" | "href">)
    ),
) {
  const { icon, tone = "default", children, className, ...rest } = props;
  const cls = cn(ITEM, tone === "danger" && "hover:text-down focus-visible:text-down", className);
  const body = (
    <>
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
  if ("external" in rest && rest.external) {
    const { external: _e, ...a } = rest;
    return (
      <a role="menuitem" target="_blank" rel="noreferrer" className={cls} {...a}>
        {body}
      </a>
    );
  }
  if (rest.href !== undefined) {
    const { external: _e, ...l } = rest as ComponentProps<typeof Link> & { external?: false };
    return (
      <Link role="menuitem" className={cls} {...l}>
        {body}
      </Link>
    );
  }
  const b = rest as ComponentProps<"button">;
  return (
    <button type="button" role="menuitem" className={cls} {...b}>
      {body}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}
