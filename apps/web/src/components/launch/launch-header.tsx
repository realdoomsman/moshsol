"use client";

import { fmtPrice, shortAddr } from "@moshsol/sdk";
import { AtSign, Globe, Lock, Send } from "lucide-react";
import { fmtSolValue } from "@/lib/format";
import type { Phase } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";
import { AddressLink, AnimatedNumber, CopyButton, TokenAvatar } from "../ui/interactive";
import { Badge } from "../ui/primitives";
import { ChangeText, PhasePill } from "../ui/status";

function Social({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Globe }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg border border-line bg-white/[0.04] text-muted transition hover:border-line-strong hover:text-ink"
    >
      <Icon className="size-3.5" aria-hidden />
    </a>
  );
}

export function LaunchHeader({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  return (
    <header className="flex flex-col gap-5 pb-6 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 gap-4">
        <TokenAvatar src={l.image} symbol={l.symbol} size={72} className="hidden sm:block" />
        <TokenAvatar src={l.image} symbol={l.symbol} size={56} className="sm:hidden" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{l.name}</h1>
            <span className="text-lg font-medium text-muted">${l.symbol}</span>
            <PhasePill phase={phase} />
            {l.whitelisted ? (
              <Badge tone="warn">
                <Lock className="size-3" aria-hidden /> Whitelist
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              Mint <AddressLink address={l.mint} label={shortAddr(l.mint, 6)} />
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
          {l.description ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{l.description}</p> : null}
        </div>
      </div>
      {phase === "live" ? (
        <div className="shrink-0 md:text-right">
          <div className="text-xs font-medium text-dim">Price (SOL)</div>
          <div className="text-3xl font-semibold tracking-tight">
            <AnimatedNumber value={l.priceSol} format={fmtPrice} />
          </div>
          <div className="mt-0.5 text-sm tabular-nums">
            <ChangeText value={l.change24h} /> <span className="text-dim">24h · mcap {fmtSolValue(l.marketCapSol)} SOL</span>
          </div>
        </div>
      ) : null}
    </header>
  );
}
