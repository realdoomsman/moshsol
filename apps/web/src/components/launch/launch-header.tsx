"use client";

import { fmtPrice, shortAddr } from "@moshsol/sdk";
import { AtSign, Globe, Lock, Send } from "lucide-react";
import { fmtSolValue } from "@/lib/format";
import type { Phase } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { AddressLink, AnimatedNumber, CopyButton, TokenAvatar } from "../ui/interactive";
import { Badge } from "../ui/primitives";
import { ChangeText, PhasePill } from "../ui/status";
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

export function LaunchHeader({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const live = phase === "live";
  return (
    <header className="animate-in flex flex-col gap-5 pb-6 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 gap-4">
        <TokenAvatar src={l.image} symbol={l.symbol} size={64} className="hidden sm:block" />
        <TokenAvatar src={l.image} symbol={l.symbol} size={52} className="sm:hidden" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight sm:text-[28px]">{l.name}</h1>
            <span className="text-lg font-medium text-muted">${l.symbol}</span>
            <PhasePill phase={phase} />
            {l.whitelisted ? (
              <Badge tone="warn">
                <Lock className="size-3" aria-hidden /> Whitelist
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-dim">
            <span className="inline-flex items-center gap-2">
              Mint <AddressLink address={l.mint} label={shortAddr(l.mint, 5)} />
              <CopyButton value={l.mint} label="Copy mint address" />
            </span>
            <span className="inline-flex items-center gap-1.5">
              by <AddressLink address={l.creator} />
            </span>
            {l.twitter || l.telegram || l.website ? (
              <span className="flex items-center gap-1.5">
                {l.twitter ? <Social href={l.twitter} label="X / Twitter" icon={AtSign} /> : null}
                {l.telegram ? <Social href={l.telegram} label="Telegram" icon={Send} /> : null}
                {l.website ? <Social href={l.website} label="Website" icon={Globe} /> : null}
              </span>
            ) : null}
          </div>
          {l.description ? (
            <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted" title={l.description}>
              {l.description}
            </p>
          ) : null}
        </div>
        <ShareButton launch={l} compact className="self-start md:hidden" />
      </div>
      <div className={cn("flex shrink-0 items-end gap-4 md:justify-end", !live && "hidden md:flex")}>
        {live ? (
          <div className="md:text-right">
            <div className="text-xs font-medium text-dim">Price · SOL</div>
            <div className="text-[32px] leading-tight font-semibold tracking-tight">
              <AnimatedNumber value={l.priceSol} format={fmtPrice} flash />
            </div>
            <div className="mt-0.5 text-sm">
              <ChangeText value={l.change24h} /> <span className="text-dim">24h · mcap {fmtSolValue(l.marketCapSol)} SOL</span>
            </div>
          </div>
        ) : null}
        <ShareButton launch={l} className="hidden md:block" />
      </div>
    </header>
  );
}
