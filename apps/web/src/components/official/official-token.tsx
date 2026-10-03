"use client";

import { shortAddr, timeAgo } from "@holdfast/sdk";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useNow } from "@/lib/hooks";
import { launchHref, pumpCoinUrl, pumpTradeUrl } from "@/lib/launch";
import { useAgentStatus, useOfficial, useOfficialMint } from "@/lib/queries";
import { mcapTicker } from "@/lib/format";
import { ActionChip } from "../agents/decision-log";
import { decisionClause } from "../band/model";
import { AgentGlyph } from "../brand/glyphs";
import { Change } from "../discover/launch-card";
import { CopyButton } from "../ui/address";
import { ButtonAnchor, ButtonLink } from "../ui/button";
import { Chip } from "../ui/chip";
import { cn } from "../ui/cn";
import { NumberTicker } from "../ui/number-ticker";
import { TokenAvatar } from "../ui/token-avatar";

/** Small "Official" tag on the official Holdfast token wherever it is listed. */
export function OfficialChip({ className }: { className?: string }) {
  return (
    <Chip tone="accent" className={className} title="The official Holdfast token: every launch's buyback pool buys and burns it">
      Official
    </Chip>
  );
}

/** `<OfficialChip>` when `mint` is the official token's. */
export function OfficialBadge({ mint, className }: { mint: string; className?: string }) {
  return useOfficialMint() === mint ? <OfficialChip className={className} /> : null;
}

/**
 * Names the official Holdfast token after "the Holdfast token" in running copy: " ($SYMBOL · CA …)", linking to
 * its launch page (pump.fun when no Holdfast launch has the mint). Nothing while `params.buybackMint` is unset.
 */
export function OfficialTokenRef() {
  const { mint, launch } = useOfficial();
  if (!mint) return null;
  const body = (
    <>
      {launch ? `$${launch.symbol} · ` : null}CA <span className="mono text-[0.92em]">{shortAddr(mint, 4)}</span>
    </>
  );
  const link = "text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink";
  return (
    <>
      {" ("}
      {launch ? (
        <Link href={launchHref(launch)} className={link}>
          {body}
        </Link>
      ) : (
        <a href={pumpCoinUrl(mint)} target="_blank" rel="noopener noreferrer" className={link}>
          {body}
        </a>
      )}
      )
    </>
  );
}

/**
 * The official Holdfast token (`params.buybackMint`), pinned at the top of the landing and Discover: image, name,
 * live mcap and 24h change, the CA with copy, View / Buy, and the vault agent's latest decision. Nothing while
 * the mint is unset (no `frame` wrapper either); CA + pump.fun only when no Holdfast launch has the mint.
 */
export function OfficialTokenPanel({ className, frame }: { className?: string; frame?: string }) {
  const { mint, launch: l } = useOfficial();
  const status = useAgentStatus();
  const nowSec = useNow(15_000);
  if (!mint) return null;
  const decision = status.data?.decisions.find((d) => d.mint === mint);
  const pump = !l || l.venue === "pump";
  const buyHref = l ? (l.venue === "pump" ? pumpTradeUrl(l) : launchHref(l)) : pumpCoinUrl(mint);
  const buyLabel = l && l.venue === "pump" && l.pump.graduated ? "Buy on PumpSwap" : pump ? "Buy on pump.fun" : "Buy";
  const panel = (
    <section aria-label="Official Holdfast token" className={cn("rounded-md border border-line bg-surface", className)}>
      <div className="grid gap-4 p-4 md:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          {l ? <TokenAvatar src={l.image} symbol={l.symbol} mint={l.mint} size={56} /> : null}
          <div className="min-w-0 flex-1">
            <div className="label text-accent-ink">Official Holdfast token</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="h3 truncate text-ink">{l ? l.name : "Holdfast"}</span>
              {l ? <span className="ui text-ink-2">${l.symbol}</span> : null}
            </div>
            <div className="small mt-1 flex min-w-0 items-center gap-1 text-ink-3">
              <span className="shrink-0">CA</span>
              <span className="mono min-w-0 truncate text-ink-2 max-md:hidden">{mint}</span>
              <span className="mono text-ink-2 md:hidden">{shortAddr(mint, 6)}</span>
              <CopyButton value={mint} label="Copy contract address" className="-my-2" />
            </div>
          </div>
          {l ? (
            <div className="shrink-0 text-right lg:hidden">
              <NumberTicker {...mcapTicker(l)} className="ui num block text-ink" />
              <Change value={l.change24h} className="small" />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap lg:gap-6">
          {l ? (
            <div className="shrink-0 text-right max-lg:hidden">
              <NumberTicker {...mcapTicker(l)} className="h3 num block text-ink" />
              <div className="small num text-ink-3">
                mcap · <Change value={l.change24h} /> 24h
              </div>
            </div>
          ) : null}
          <div className="grid flex-1 grid-cols-2 gap-2 lg:flex lg:flex-none">
            {l ? (
              <ButtonLink href={launchHref(l)} variant="secondary">
                View
              </ButtonLink>
            ) : null}
            <ButtonAnchor
              href={buyHref}
              target={buyHref.startsWith("http") ? "_blank" : undefined}
              variant="accent"
              className={cn(!l && "col-span-2")}
              icon={buyHref.startsWith("http") ? <ArrowUpRight className="size-4" strokeWidth={1.5} aria-hidden /> : undefined}
            >
              {buyLabel}
            </ButtonAnchor>
          </div>
        </div>
      </div>
      {l && decision ? (
        <div className="small flex min-w-0 items-center gap-2 border-t border-line px-4 py-2.5 text-ink-2 md:px-5">
          <AgentGlyph className="shrink-0 text-accent-ink" />
          <span className="shrink-0 text-ink-3 max-sm:hidden">Vault agent</span>
          <ActionChip d={decision} />
          <span className="min-w-0 truncate first-letter:uppercase" title={decision.reason}>
            {decision.error && (decision.action === "buy" || decision.action === "sell") ? decision.error : decisionClause(decision.reason)}
          </span>
          <span className="num ml-auto shrink-0 text-ink-3">{timeAgo(decision.at, nowSec)}</span>
        </div>
      ) : null}
    </section>
  );
  return frame ? <div className={frame}>{panel}</div> : panel;
}
