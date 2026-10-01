"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { pumpSplit } from "@/lib/pump-terms";
import { usePlatform } from "@/lib/queries";
import { Term } from "../glossary";
import { Button, IconButton } from "../ui/button";
import { cn } from "../ui/cn";

const KEY = "holdfast:new-here:dismissed";
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

const isDismissed = () => window.localStorage.getItem(KEY) === "1";

function dismiss() {
  window.localStorage.setItem(KEY, "1");
  listeners.forEach((fn) => fn());
}

/**
 * The 60-second explainer for a first visit (Discover and launch pages): three sentences a
 * pump.fun user needs before the numbers make sense, a link to the 2-minute doc, and "Got it".
 * Shown to signed-out visitors only; the dismissal lives in localStorage. Renders nothing on the
 * server and until hydration so a returning visitor never sees it flash.
 */
export function NewHere({ className }: { className?: string }) {
  // Server snapshot = dismissed, so SSR and the first client paint agree.
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => true);
  const { publicKey, connecting } = useWallet();
  const platform = usePlatform();
  if (dismissed || publicKey || connecting) return null;
  const s = pumpSplit(platform.data?.params);

  return (
    <section aria-labelledby="new-here-title" className={cn("rounded-md border border-line bg-surface p-4 md:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="new-here-title" className="h3 text-ink">
          New here?
        </h2>
        <span className="-mt-1 -mr-1.5">
          <IconButton label="Dismiss" size="sm" onClick={dismiss}>
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          </IconButton>
        </span>
      </div>
      <ul className="body mt-2 grid max-w-[66ch] gap-1.5 text-ink-2">
        <li>
          Launches here are pump.fun tokens. Backers put SOL in before launch; at launch that SOL makes the token&rsquo;s first buy, the{" "}
          <Term k="bundle" split={s} />, before anyone else can trade.
        </li>
        <li>
          The bundle sits in a <Term k="vault" split={s} /> traded only by a rate-limited <Term k="vaultAgent" split={s} />. Backers get{" "}
          {s.backerPct}% of its realized profit; {s.burnPct}% buys and burns the Holdfast token.
        </li>
        <li>
          Miss the minimum raise and backers get 100% back. Buying and selling the token itself happens on pump.fun.
        </li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={dismiss}>
          Got it
        </Button>
        <Link href="/docs/how-it-works" className="ui text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink">
          How it works (2 min) ›
        </Link>
      </div>
    </section>
  );
}
