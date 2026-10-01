"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Check, Link2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SITE_URL } from "@/lib/env";
import { fmtLamports } from "@/lib/format";
import { launchHref } from "@/lib/launch";
import { useMounted } from "@/lib/hooks";
import { useLaunch } from "@/lib/queries";
import { ClampLock } from "../brand/clamp-lock-animation";
import { Address } from "../ui/address";
import { Button, ButtonAnchor, ButtonLink } from "../ui/button";
import { Countdown } from "../ui/countdown";
import { ErrorState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { TokenAvatar } from "../ui/token-avatar";

/** The title waits for the clamp to shut (960 ms, §3.3) before it appears. */
const AFTER_CLAMP = "animate-pop-in [animation-delay:720ms] [animation-fill-mode:both]";

/**
 * Success screen (§4.6): the clamp animation, "Your raise is open.", the share card (the launch's
 * OG image), Copy link, Share on X and View launch. Everything shown is read back from the
 * indexer for `id` (the launch address of a pump launch, the mint of a Holdfast launch); `signature` is the create transaction.
 */
export function CreateSuccess({ id, signature }: { id: string; signature: string | null }) {
  const mounted = useMounted();
  const { publicKey } = useWallet();
  const launch = useLaunch(id);
  const [copied, setCopied] = useState(false);
  const [cardFailed, setCardFailed] = useState(false);
  const l = launch.data;
  const url = `${SITE_URL}${l ? launchHref(l) : `/launch/${id}`}`;
  const mine = mounted && !!l && publicKey?.toBase58() === l.creator;
  const tweet = !l
    ? ""
    : l.status === "live"
      ? `$${l.symbol} is live on @holdfast. Backers bought first and get 100% of the vault agent's profit:`
      : mine
        ? `I just opened a raise on @holdfast: $${l.symbol}. Backers buy first and share the profit. Back it:`
        : `The $${l.symbol} raise is open on @holdfast. Backers buy first and share the profit. Back it:`;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  // The screen stays addressable after the raise moves on, so the copy follows the launch's status.
  const whose = l && !mine ? `The $${l.symbol}` : "Your";
  const headline =
    l?.status === "live"
      ? `${l && !mine ? `$${l.symbol}` : "Your launch"} is live.`
      : l?.status === "refunding"
        ? `${whose} raise closed without its minimum.`
        : `${whose} raise is open.`;
  const subline =
    l?.status === "live"
      ? "The bundle bought at launch sits in the vault, traded only by the vault agent."
      : l?.status === "refunding"
        ? "Backers can claim a full refund from the launch page."
        : "Share it with backers. When the raise closes above its minimum, the bundle buys first.";

  return (
    <div className="mx-auto grid w-full max-w-[640px] gap-8 pt-4 pb-8 md:pt-10">
      <header className="grid justify-items-center gap-4 text-center">
        <ClampLock playKey={id} size={64} className="text-ink" title="Bundle vault" />
        <div className={`grid gap-2 ${AFTER_CLAMP}`}>
          <h1 className="display-m text-ink">{headline}</h1>
          <p className="body text-ink-2">{subline}</p>
        </div>
      </header>

      {launch.isError && !l ? (
        <ErrorState onRetry={() => void launch.refetch()} retrying={launch.isFetching}>
          Couldn&apos;t load the launch yet. The indexer may still be catching up.
        </ErrorState>
      ) : null}

      <section aria-label="Share card" className="grid gap-4">
        {l && !cardFailed ? (
          // The launch's own share card (its OG image), exactly what X and Telegram will show.
          <img
            src={`/create/card/${id}`}
            alt={`Share card for ${l.name} ($${l.symbol})`}
            width={1200}
            height={630}
            // An error can land before hydration attaches onError.
            ref={(el) => {
              if (el?.complete && el.naturalWidth === 0) setCardFailed(true);
            }}
            onError={() => setCardFailed(true)}
            className="aspect-[1200/630] w-full rounded-md border border-line bg-sunken object-cover"
          />
        ) : !l ? (
          <Skeleton className="aspect-[1200/630] w-full rounded-md" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={copied ? <Check className="size-4" strokeWidth={1.5} aria-hidden /> : <Link2 className="size-4" strokeWidth={1.5} aria-hidden />}
            onClick={() => void copy()}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <ButtonAnchor
            variant="secondary"
            aria-disabled={!l || undefined}
            href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`}
          >
            Share on X
          </ButtonAnchor>
          <ButtonLink href={l ? launchHref(l) : `/launch/${id}`} variant="primary" arrow className="sm:ml-auto">
            View launch
          </ButtonLink>
        </div>
      </section>

      <section aria-label="Launch summary" className="rounded-md border border-line bg-surface p-4">
        {l ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3">
              <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={40} />
              <span className="min-w-0">
                <span className="ui block truncate text-ink">{l.name}</span>
                <span className="small block text-ink-2">${l.symbol}</span>
              </span>
            </div>
            <dl className="small num grid gap-2">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Raise</dt>
                <dd className="text-ink">
                  {fmtLamports(l.raiseMin)}–{fmtLamports(l.raiseMax)} SOL
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Deadline</dt>
                <dd className="text-ink">
                  <Countdown to={l.raiseDeadline} prefix="Closes in" endedLabel="Raise closed" />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">{l.venue === "pump" ? "Launch" : "Mint"}</dt>
                <dd className="min-w-0">
                  <Address address={l.venue === "pump" ? l.address : l.mint} />
                </dd>
              </div>
              {signature ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Transaction</dt>
                  <dd className="min-w-0">
                    <Address address={signature} kind="tx" />
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : (
          <div className="grid gap-3">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
      </section>

      <p className="small text-center text-ink-3">
        <Link href="/create" className="underline decoration-ink-3/60 underline-offset-2 hover:text-ink hover:decoration-ink">
          Create another launch
        </Link>
      </p>
    </div>
  );
}
