"use client";

import { fmtPrice, shortAddr } from "@holdfast/sdk";
import { AtSign, Globe, Lock, Send } from "lucide-react";
import type { CSSProperties } from "react";
import { fmtSolValue } from "@/lib/format";
import type { Phase } from "@/lib/launch";
import { useTokenColor } from "@/lib/token-color";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { AddressLink, AnimatedNumber, CopyButton, TokenAvatar } from "../ui/interactive";
import { Badge } from "../ui/primitives";
import { ChangePill, PhasePill } from "../ui/status";
import { ShareButton } from "./share-button";

function Social({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Globe }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-xl border border-line bg-white/[0.04] text-muted transition hover:border-line-strong hover:text-ink sm:size-8 sm:rounded-lg"
    >
      <Icon className="size-3.5" aria-hidden />
    </a>
  );
}

/**
 * Banner themed with the token's own colour (sampled from its logo, mint-derived until then):
 * a soft glow and the blurred logo behind the header, and the colour carried into the price.
 */
export function LaunchHeader({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const live = phase === "live";
  const tc = useTokenColor(l.image, l.mint);
  return (
    <header
      className="tc-ease relative z-10 mb-6 animate-in rounded-[24px] border border-line bg-[#08090c]/70 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
      style={{ "--tc": tc } as CSSProperties}
    >
      {/* Backdrop (clipped on its own so the share menu can overflow the banner): token glow, a
          blurred copy of the logo, a masked grid and a coloured top edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        <div className="absolute -top-40 -left-24 h-96 w-[42rem] max-w-full rounded-full bg-(--tc)/20 blur-3xl" />
        <div className="absolute -right-16 -bottom-48 h-80 w-[30rem] rounded-full bg-(--tc)/10 blur-3xl" />
        {l.image ? (
          // Indexer-hosted user upload; decorative only.
          <img
            src={l.image}
            alt=""
            className="absolute top-1/2 right-[6%] hidden size-72 -translate-y-1/2 rotate-12 rounded-[64px] object-cover opacity-[0.07] blur-md md:block"
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.04)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_70%_90%_at_20%_0%,#000,transparent_70%)] bg-[size:32px_32px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-(--tc)/70 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-6 p-5 sm:p-7 md:flex-row md:items-end md:justify-between">
        {/* Phones: avatar + name on the first row, everything else full width below it. */}
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-x-5">
          <div className="relative shrink-0 self-start sm:row-span-2">
            <div aria-hidden className="absolute -inset-3 rounded-[28px] bg-(--tc)/25 blur-xl" />
            <TokenAvatar src={l.image} symbol={l.symbol} size={76} className="relative hidden sm:block" />
            <TokenAvatar src={l.image} symbol={l.symbol} size={56} className="relative sm:hidden" />
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="type-title min-w-0 truncate text-[28px] sm:text-[40px]">{l.name}</h1>
            <span className="text-lg font-semibold text-(--tc) sm:text-xl">${l.symbol}</span>
          </div>
          <ShareButton launch={l} compact className="self-center sm:hidden" />
          <div className="col-span-3 min-w-0 sm:col-span-1 sm:col-start-2">
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-2.5">
              <PhasePill phase={phase} />
              {l.whitelisted ? (
                <Badge tone="warn">
                  <Lock className="size-3" aria-hidden /> Whitelist
                </Badge>
              ) : null}
              <span className="inline-flex h-6 items-center gap-2 rounded-full border border-line bg-black/30 px-2.5 text-[12px] text-dim">
                Mint <AddressLink address={l.mint} label={shortAddr(l.mint, 5)} className="text-[12px]" />
                <CopyButton value={l.mint} label="Copy mint address" />
              </span>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-black/30 px-2.5 text-[12px] text-dim">
                by <AddressLink address={l.creator} className="text-[12px]" />
              </span>
            </div>
            {l.description ? (
              <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted" title={l.description}>
                {l.description}
              </p>
            ) : null}
            {l.twitter || l.telegram || l.website ? (
              <div className="mt-3 flex items-center gap-1.5">
                {l.twitter ? <Social href={l.twitter} label="X / Twitter" icon={AtSign} /> : null}
                {l.telegram ? <Social href={l.telegram} label="Telegram" icon={Send} /> : null}
                {l.website ? <Social href={l.website} label="Website" icon={Globe} /> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "flex shrink-0 items-end justify-between gap-4 md:flex-col md:items-end md:justify-end",
            !live && "hidden sm:flex sm:justify-end",
          )}
        >
          {live ? (
            <div className="md:text-right">
              <div className="type-eyebrow text-dim">Price · SOL</div>
              <div className="type-display mt-1.5 text-[40px] text-(--tc) drop-shadow-[0_0_24px_color-mix(in_srgb,var(--tc)_45%,transparent)] sm:text-5xl">
                <AnimatedNumber value={l.priceSol} format={fmtPrice} flash />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 md:justify-end">
                <ChangePill value={l.change24h} label="24h" />
                <span className="text-sm text-dim tabular-nums">mcap {fmtSolValue(l.marketCapSol)} SOL</span>
              </div>
            </div>
          ) : null}
          <ShareButton launch={l} className="hidden sm:block" />
        </div>
      </div>
    </header>
  );
}
