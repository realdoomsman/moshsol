"use client";

import { timeAgo } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import { Download, Ellipsis, Link2, Share2, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { fmtMcap, fmtSolValue, mcapTicker } from "@/lib/format";
import { SITE_URL } from "@/lib/env";
import { launchHref, launchId, phaseExplainer, type Phase } from "@/lib/launch";
import { fmtMult, pumpSplit } from "@/lib/pump-terms";
import type { LaunchSummary } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { chipStatus } from "../discover/model";
import { Address } from "../ui/address";
import { Button, buttonClass, IconButton } from "../ui/button";
import { StatusChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { Dialog, Sheet } from "../ui/dialog";
import { Identicon } from "../ui/identicon";
import { NumberTicker } from "../ui/number-ticker";
import { MenuItem, Popover } from "../ui/popover";
import { TokenAvatar } from "../ui/token-avatar";
import { displayName } from "../wallet-peek/wallet-peek";
import { SocialIcon, socialLinks, XLogo } from "./creator-card";
import { VenueChip } from "./venue-panel";

function shareText(l: LaunchSummary): string {
  const split = pumpSplit(l.terms);
  const earn =
    l.venue === "pump"
      ? `${split.backerPct}% of its pump.fun creator fees`
      : `${l.terms.backerFeeShareBps / 100}% of every trading fee`;
  const payback = `a vault agent holds the bundle and may pay them back once it's ${fmtMult(split.payoutMult)}`;
  if (l.status === "live") {
    return `$${l.symbol} on Holdfast: ${fmtMcap(l)} mcap${l.venue === "pump" ? " on pump.fun" : ""}. Backers bought first and earn ${earn}; ${payback}.`;
  }
  if (l.status === "raising") {
    return `Backing $${l.symbol} on Holdfast: backers make the first buy${l.venue === "pump" ? " on pump.fun" : ""} and earn ${earn}; ${payback}.`;
  }
  return `$${l.symbol} on Holdfast`;
}

function useShare(l: LaunchSummary) {
  const url = `${SITE_URL}${launchHref(l)}`;
  return {
    url,
    copy: () =>
      navigator.clipboard.writeText(url).then(
        () => toast.success("Link copied"),
        () => toast.error("Couldn't copy", { description: "Your browser blocked clipboard access." }),
      ),
    intent: `https://x.com/intent/post?text=${encodeURIComponent(shareText(l))}&url=${encodeURIComponent(url)}`,
    card: `${launchHref(l)}/card`,
  };
}

function ShareMenu({ launch: l }: { launch: LaunchSummary }) {
  const share = useShare(l);
  return (
    <Popover
      role="menu"
      label="Share"
      placement="bottom-end"
      width={220}
      trigger={(p) => (
        <Button {...p} variant="secondary" size="sm" icon={<Share2 className="size-4" strokeWidth={1.5} aria-hidden />}>
          Share
        </Button>
      )}
    >
      {(close) => (
        <div className="py-1">
          <MenuItem
            icon={<Link2 className="size-4" strokeWidth={1.5} />}
            onClick={() => {
              void share.copy();
              close();
            }}
          >
            Copy link
          </MenuItem>
          <MenuItem href={share.intent} external icon={<XLogo className="size-3.5" />} onClick={close}>
            Share on X
          </MenuItem>
          <MenuItem
            href={share.card}
            external
            download={`holdfast-${l.symbol}.png`}
            icon={<Download className="size-4" strokeWidth={1.5} />}
            onClick={close}
          >
            Download card
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

function WatchButton({ id, className }: { id: string; className?: string }) {
  const { has, toggle } = useWatchlist();
  const on = has(id);
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-pressed={on}
      onClick={() => toggle(id)}
      className={className}
      icon={<Star className={cn("size-4", on && "fill-current")} strokeWidth={1.5} aria-hidden />}
    >
      {on ? "Watching" : "Watch"}
    </Button>
  );
}

/**
 * Token header (§4.5): no card, no banner. Art (click → lightbox), name, ticker, status chips, mint,
 * creator, age and links; market cap is the primary number (live). On phones the mint, links and
 * actions collapse into a "⋯" sheet.
 */
export function TokenHeader({ launch: l, phase, now }: { launch: LaunchSummary; phase: Phase; now: number }) {
  const [lightbox, setLightbox] = useState(false);
  const [more, setMore] = useState(false);
  const share = useShare(l);
  const links = socialLinks(l);
  const age = timeAgo(l.launchedAt > 0 ? l.launchedAt : l.createdAt, now).replace(" ago", "");
  const creator = displayName(l.creator, l.creatorName);
  const live = phase === "live";
  const change = l.change24h;

  const meta = (
    <>
      <Address address={l.mint === PublicKey.default.toBase58() ? l.address : l.mint} />
      <span aria-hidden className="text-ink-3">
        ·
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        by
        <Link
          href={`/u/${l.creator}`}
          className="inline-flex min-w-0 items-center gap-1.5 text-ink-2 transition-colors hover:text-ink"
        >
          <Identicon address={l.creator} size={16} />
          <span className={cn("truncate", !l.creatorName && "mono")}>{creator}</span>
        </Link>
      </span>
      <span aria-hidden className="text-ink-3">
        ·
      </span>
      <span className="num">{age}</span>
    </>
  );

  return (
    <header className="flex min-w-0 items-start gap-3 md:gap-4">
      <button
        type="button"
        onClick={() => setLightbox(true)}
        aria-label={`View $${l.symbol} art`}
        className="shrink-0 rounded-md transition-opacity hover:opacity-90"
      >
        <span className="block max-md:hidden">
          <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={64} />
        </span>
        <span className="block md:hidden">
          <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={48} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="h1 min-w-0 truncate text-ink">{l.name}</h1>
          <span className="ui text-ink-2">${l.symbol}</span>
          <span className="flex items-center gap-1.5">
            <StatusChip status={chipStatus(l, now)} />
            <VenueChip launch={l} />
          </span>
        </div>
        <p className="small mt-1.5 max-w-[60ch] text-ink-2">{phaseExplainer(phase, l.venue)}</p>
        <div className="small mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-3 max-md:hidden">
          {meta}
          {links.length ? (
            <span className="ml-1 flex items-center gap-0.5">
              {links.map((s) => (
                <a
                  key={s.kind}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer nofollow"
                  aria-label={s.label}
                  title={s.label}
                  className="inline-flex size-8 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-raised hover:text-ink pointer-coarse:size-10"
                >
                  <SocialIcon kind={s.kind} />
                </a>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        {live ? (
          <div className="text-right">
            <div className="label text-ink-3 max-md:hidden">Market cap</div>
            <NumberTicker {...mcapTicker(l)} roll className="num-xl text-ink" />
            {l.marketCapUsd != null ? <div className="small num text-ink-3">{fmtSolValue(l.marketCapSol)} SOL</div> : null}
            {change !== null && Number.isFinite(change) ? (
              <div className={cn("small num", change > 0 ? "text-up" : change < 0 ? "text-down" : "text-ink-2")}>
                {change > 0 ? "▲ +" : change < 0 ? "▼ " : ""}
                {change.toFixed(Math.abs(change) >= 100 ? 0 : 1)}% <span className="text-ink-3">24h</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <span className="-mr-2 md:hidden">
          <IconButton label="More about this token" size="sm" onClick={() => setMore(true)}>
            <Ellipsis className="size-5" strokeWidth={1.5} aria-hidden />
          </IconButton>
        </span>
        <div className="flex items-center gap-2 max-md:hidden">
          <WatchButton id={launchId(l)} />
          <ShareMenu launch={l} />
        </div>
      </div>

      <Dialog open={lightbox} onOpenChange={setLightbox} title={`${l.name} ($${l.symbol})`} width={560} mobile="dialog">
        <div className="flex justify-center px-5 pt-3 pb-5">
          {l.image ? (
            <img src={l.image} alt={`$${l.symbol} art`} className="aspect-square w-full max-w-[480px] rounded-md bg-sunken object-cover" />
          ) : (
            <TokenAvatar src={null} symbol={l.symbol} mint={l.mint} size={240} />
          )}
        </div>
      </Dialog>

      <Sheet open={more} onOpenChange={setMore} title={`$${l.symbol}`}>
        <div className="grid gap-4 px-5 pt-3 pb-5">
          <div className="small flex flex-wrap items-center gap-x-2 gap-y-2 text-ink-3">{meta}</div>
          {links.length ? (
            <div className="flex flex-wrap gap-2">
              {links.map((s) => (
                <a
                  key={s.kind}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="small inline-flex h-10 items-center gap-1.5 rounded-sm border border-line px-3 text-ink-2 transition-colors hover:border-line-2 hover:bg-raised hover:text-ink"
                >
                  <SocialIcon kind={s.kind} />
                  {s.label}
                </a>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <WatchButton id={launchId(l)} className="w-full" />
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              icon={<Link2 className="size-4" strokeWidth={1.5} aria-hidden />}
              onClick={() => void share.copy()}
            >
              Copy link
            </Button>
            <a href={share.intent} target="_blank" rel="noreferrer" className={buttonClass({ size: "sm", className: "w-full" })}>
              <XLogo className="size-3.5" /> Share on X
            </a>
            <a href={share.card} download={`holdfast-${l.symbol}.png`} className={buttonClass({ size: "sm", className: "w-full" })}>
              <Download className="size-4" strokeWidth={1.5} aria-hidden /> Download card
            </a>
          </div>
        </div>
      </Sheet>
    </header>
  );
}
