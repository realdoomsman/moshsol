"use client";

import { fmtPrice } from "@moshsol/sdk";
import { Check, Link2, Share2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fmtSolValue } from "@/lib/format";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function shareText(l: LaunchSummary): string {
  if (l.status === "live") {
    return `$${l.symbol} on @moshsol — ${fmtPrice(l.priceSol)} SOL, ${fmtSolValue(l.marketCapSol)} SOL mcap. The bundle is locked in the vault forever.`;
  }
  if (l.status === "raising") {
    return `Backing $${l.symbol} on @moshsol — the bundle gets locked in the vault forever and backers earn every trade fee.`;
  }
  return `$${l.symbol} on @moshsol`;
}

export function ShareButton({ launch: l, compact, className }: { launch: LaunchSummary; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-muted transition hover:bg-white/[0.06] hover:text-ink focus-visible:bg-white/[0.06]";

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={compact ? "Share" : undefined}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition",
          compact ? "w-10" : "px-3.5",
          open ? "border-line-strong bg-white/[0.09] text-ink" : "border-line bg-white/[0.04] text-muted hover:border-line-strong hover:text-ink",
        )}
      >
        <Share2 className="size-4" aria-hidden />
        {compact ? null : "Share"}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-2xl border border-line-strong bg-[#101317]/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/launch/${l.mint}`).then(
                  () => {
                    setCopied(true);
                    toast.success("Link copied");
                  },
                  () => toast.error("Couldn't copy the link"),
                );
                setOpen(false);
              }}
            >
              {copied ? <Check className="size-4 text-up" aria-hidden /> : <Link2 className="size-4" aria-hidden />} Copy link
            </button>
            <a
              role="menuitem"
              className={item}
              href="https://x.com"
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => {
                // Built at click time so the link always carries this page's origin.
                const intent = new URL("https://x.com/intent/post");
                intent.searchParams.set("text", shareText(l));
                intent.searchParams.set("url", `${window.location.origin}/launch/${l.mint}`);
                e.currentTarget.href = intent.toString();
                setOpen(false);
              }}
            >
              <XLogo className="size-3.5" /> Post on X
            </a>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
