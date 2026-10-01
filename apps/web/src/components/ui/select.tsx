"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { Popover } from "./popover";

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  /** One line under the label in the list (not in the trigger). */
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * Dropdown select (sort menus, filters): a secondary-style trigger showing the current option and
 * a `raised` listbox. Arrow keys move, Enter/Space picks, Escape closes; Home/End jump.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  prefix,
  size = "md",
  align = "start",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** Accessible name, e.g. "Sort launches". */
  label: string;
  /** Visible lead-in inside the trigger, e.g. "Sort". */
  prefix?: ReactNode;
  size?: "sm" | "md";
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const enabled = options.filter((o) => !o.disabled);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    items[Math.min(Math.max(next, 0), items.length - 1)]?.focus();
  };

  return (
    <Popover
      role="listbox"
      label={label}
      open={open}
      onOpenChange={setOpen}
      placement={align === "end" ? "bottom-end" : "bottom-start"}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`${label}: ${typeof current?.label === "string" ? current.label : value}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "ui inline-flex items-center gap-2 rounded-sm border border-line-2 bg-surface pr-2 pl-3 text-ink transition-colors hover:border-ink-3 hover:bg-raised",
            size === "sm" ? "h-8 pointer-coarse:h-10" : "h-10",
            className,
          )}
        >
          {prefix ? <span className="text-ink-3">{prefix}</span> : null}
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-2)", open && "rotate-180")}
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
      )}
    >
      {(close) => (
        <div className="py-1" onKeyDown={onListKey}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <div
                key={o.value}
                role="option"
                tabIndex={o.disabled ? undefined : -1}
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                onClick={() => {
                  if (o.disabled) return;
                  onChange(o.value);
                  close();
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !o.disabled) {
                    e.preventDefault();
                    onChange(o.value);
                    close();
                  }
                }}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-2 outline-none transition-colors",
                  o.disabled ? "cursor-not-allowed text-ink-3" : "hover:bg-ink/[0.06] focus:bg-ink/[0.06]",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("ui block", selected ? "text-ink" : "text-ink-2")}>{o.label}</span>
                  {o.hint ? <span className="small block text-ink-3">{o.hint}</span> : null}
                </span>
                {selected ? <Check className="size-4 shrink-0 text-ink" strokeWidth={1.5} aria-hidden /> : null}
              </div>
            );
          })}
          {enabled.length === 0 ? <p className="small px-3 py-2 text-ink-3">No options</p> : null}
        </div>
      )}
    </Popover>
  );
}
