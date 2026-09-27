"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { Spinner } from "./spinner";

/**
 * Data table (§3.6/§4.5): `small` tabular type, 1px `line` row rules, a sticky `sunken` header.
 * Rows are 40px (`dense`) or 48px (`comfortable`, default for discover/portfolio). Wrap in a
 * `maxHeight` scroll area to get the sticky header; without it the table scrolls with the page.
 */
export function Table({
  density = "comfortable",
  maxHeight,
  label,
  className,
  children,
}: {
  density?: "dense" | "comfortable";
  /** Scroll inside the panel (the header sticks), e.g. 480. */
  maxHeight?: number | string;
  /** Accessible caption. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `contain: inline-size` stops a wide table from stretching its grid/flex parents; it scrolls instead.
    <div
      className={cn("relative w-full overflow-x-auto [contain:inline-size]", maxHeight !== undefined && "overflow-y-auto", className)}
      style={{ maxHeight }}
    >
      <table
        aria-label={label}
        className={cn(
          "small num w-full border-separate border-spacing-0 text-ink",
          density === "dense" ? "[--row-h:40px]" : "[--row-h:48px]",
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-[1]">
      <tr>{children}</tr>
    </thead>
  );
}

export type SortDir = "asc" | "desc";

/**
 * Header cell: `label` type on `sunken`. Pass `sort` + `onSort` to make it a sortable button;
 * `sort` is this column's current direction (undefined = not the sort column).
 */
export function TH({
  align = "left",
  sortable,
  sort,
  onSort,
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sort?: SortDir;
  onSort?: () => void;
}) {
  const content = sortable ? (
    <button
      type="button"
      onClick={onSort}
      className={cn("label inline-flex items-center gap-1 transition-colors hover:text-ink", sort ? "text-ink" : "text-ink-3")}
    >
      {children}
      {sort === "asc" ? (
        <ChevronUp className="size-3" strokeWidth={2} aria-hidden />
      ) : sort === "desc" ? (
        <ChevronDown className="size-3" strokeWidth={2} aria-hidden />
      ) : null}
    </button>
  ) : (
    children
  );
  return (
    <th
      scope="col"
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
      className={cn(
        "label h-9 border-b border-line bg-sunken px-3 whitespace-nowrap text-ink-3 first:pl-4 last:pr-4",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
      {...rest}
    >
      {content}
    </th>
  );
}

export type RowFlash = "up" | "down" | "agent";

const FLASH: Record<RowFlash, string> = {
  up: "animate-row-up",
  down: "animate-row-down",
  agent: "animate-row-agent",
};

/**
 * Body row. `flash` plays the 800 ms wash once on mount — set it only on rows that just arrived
 * (live inserts), never on the initial page. `agent` tints the row `accent-wash` (agent trades).
 * `onClick` makes the row interactive (hover `raised`).
 */
export function TR({
  flash,
  agent,
  className,
  onClick,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { flash?: RowFlash; agent?: boolean }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "group/row transition-colors",
        agent && "bg-accent-wash/60",
        onClick && "cursor-pointer hover:bg-raised",
        flash && FLASH[flash],
        className,
      )}
      {...rest}
    />
  );
}

export function TD({
  align = "left",
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "h-(--row-h) border-b border-line px-3 whitespace-nowrap first:pl-4 last:pr-4 group-last/row:border-b-0",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
      {...rest}
    />
  );
}

/** A full-width body row for empty/error/loading messages. */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}

/**
 * Infinite scroll: returns a ref for a sentinel element; `onLoadMore` fires when it comes within
 * `rootMargin` of the viewport (or of `root`, the scrolling panel) while `hasMore && !loading`.
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = "240px",
  root,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
  root?: HTMLElement | null;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const load = useRef(onLoadMore);
  useEffect(() => {
    load.current = onLoadMore;
  });
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load.current(), {
      root: root ?? null,
      rootMargin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, rootMargin, root]);
  return sentinel;
}

/**
 * Footer for paged tables: the infinite-scroll sentinel plus a visible "Load more" fallback
 * (keyboard users, observers that don't fire) and the spinner while a page loads.
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  root,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  root?: HTMLElement | null;
}) {
  const sentinel = useInfiniteScroll({ hasMore, loading, onLoadMore, root });
  if (!hasMore) return null;
  return (
    <div ref={sentinel} className="flex h-12 items-center justify-center">
      {loading ? (
        <Spinner label="Loading more" className="text-ink-3" />
      ) : (
        <Button size="sm" variant="ghost" onClick={onLoadMore}>
          Load more
        </Button>
      )}
    </div>
  );
}
