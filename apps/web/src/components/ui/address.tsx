"use client";

import { shortAddr } from "@holdfast/sdk";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { cn } from "./cn";
import { Identicon } from "./identicon";
import { Popover } from "./popover";

function useCopy(value: string) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1_400);
    return () => window.clearTimeout(id);
  }, [done]);
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => setDone(true),
      () => toast.error("Couldn't copy", { description: "Your browser blocked clipboard access." }),
    );
  return { done, copy };
}

/** Copy-to-clipboard icon button (14px glyph, 40px touch area). */
export function CopyButton({ value, label = "Copy address", className }: { value: string; label?: string; className?: string }) {
  const { done, copy } = useCopy(value);
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Copied" : label}
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center text-ink-3 transition-colors before:absolute before:-inset-3 hover:text-ink",
        className,
      )}
    >
      {done ? <Check className="size-3.5" strokeWidth={1.5} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.5} aria-hidden />}
    </button>
  );
}

/**
 * An on-chain address in `mono`, truncated 4…4 (§3.5), with explorer ↗. What a click on the
 * text does, in order of precedence:
 *   - `peek`: opens a 320px popover with that content (the wallet peek, Jupiter maker modal);
 *   - `href`: navigates (e.g. `/u/<wallet>`, `/launch/<mint>`);
 *   - otherwise copies the full address.
 * `kind="tx"` links the explorer to the transaction. `label` replaces the short address (a profile
 * name, "Holdfast vault"); the full address stays in the title.
 */
export function Address({
  address,
  kind = "address",
  label,
  chars = 4,
  href,
  peek,
  identicon,
  copy = true,
  explorer = true,
  className,
}: {
  address: string;
  kind?: "address" | "tx";
  label?: ReactNode;
  chars?: number;
  href?: string;
  peek?: ReactNode;
  /** Leading identicon (wallets). */
  identicon?: boolean;
  /** Show a copy button next to the text (click-to-copy is used when there's no peek/href). */
  copy?: boolean;
  explorer?: boolean;
  className?: string;
}) {
  const { done, copy: doCopy } = useCopy(address);
  const text = label ?? shortAddr(address, chars);
  const textClass = cn(
    "relative min-w-0 truncate transition-colors before:absolute before:-inset-x-1 before:-inset-y-2.5 hover:text-ink",
    label ? "" : "mono",
  );

  let main: ReactNode;
  if (peek) {
    main = (
      <Popover
        width={320}
        placement="bottom-start"
        label="Wallet details"
        trigger={(p) => (
          <button type="button" {...p} title={address} className={cn(textClass, "text-left")}>
            {text}
          </button>
        )}
      >
        {peek}
      </Popover>
    );
  } else if (href) {
    main = (
      <Link href={href} title={address} className={textClass}>
        {text}
      </Link>
    );
  } else {
    main = (
      <button type="button" onClick={doCopy} title={`${address} — click to copy`} className={cn(textClass, "text-left")}>
        {done ? "Copied" : text}
      </button>
    );
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-ink-2", className)}>
      {identicon ? <Identicon address={address} size={18} /> : null}
      {main}
      {copy && (peek || href) ? <CopyButton value={address} label={kind === "tx" ? "Copy signature" : "Copy address"} /> : null}
      {explorer ? (
        <a
          href={kind === "tx" ? explorerTx(address) : explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          aria-label="View on explorer"
          title="View on explorer"
          className="relative inline-flex shrink-0 text-ink-3 transition-colors before:absolute before:-inset-3 hover:text-ink"
        >
          <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
        </a>
      ) : null}
    </span>
  );
}
