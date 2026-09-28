"use client";

import { Search } from "lucide-react";
import { IconButton } from "../ui/button";
import { cn } from "../ui/cn";
import { useCommandPalette } from "./command-palette";

/** Header search field (§4.3): 360px, `sunken` with a hairline, 8px radius, `/` hint; opens the command palette. */
export function SearchTrigger({ className }: { className?: string }) {
  const { setOpen } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search tokens and wallets"
      aria-keyshortcuts="/ Control+K Meta+K"
      className={cn(
        "ui flex h-8 w-full max-w-[360px] items-center gap-2 rounded-sm bg-sunken pr-1.5 pl-3 text-ink-3 ring-1 ring-line ring-inset transition-[color,box-shadow] hover:text-ink-2 hover:ring-line-2",
        className,
      )}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="flex-1 truncate text-left">Search tokens, wallets…</span>
      <kbd className="micro rounded-xs border border-line-2 px-1.5 font-sans text-ink-3">/</kbd>
    </button>
  );
}

/** Mobile top-bar search icon; the palette opens full-screen below 768px. */
export function SearchIconButton({ className }: { className?: string }) {
  const { setOpen } = useCommandPalette();
  return (
    <IconButton label="Search" size="sm" onClick={() => setOpen(true)} className={className}>
      <Search className="size-5" strokeWidth={1.5} aria-hidden />
    </IconButton>
  );
}
