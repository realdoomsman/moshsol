"use client";

import { Globe, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fmtSolValue } from "@/lib/format";
import type { LaunchSummary } from "@/lib/types";
import { userQuery } from "@/lib/users";
import { ButtonLink } from "../ui/button";
import { cn } from "../ui/cn";
import { Identicon } from "../ui/identicon";
import { Skeleton } from "../ui/skeleton";
import { displayName } from "../wallet-peek/wallet-peek";
import { Panel } from "./shared";

/** X's logo (lucide has no brand marks). */
export function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export interface SocialLink {
  kind: "x" | "telegram" | "website";
  href: string;
  label: string;
}

/** A handle or URL from the metadata → a link; anything that isn't http(s) is dropped. */
function toUrl(v: string | null, base: string): string | null {
  const s = v?.trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : base ? `${base}${s.replace(/^@/, "")}` : null;
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The launch's X / Telegram / website links from its metadata. */
export function socialLinks(l: LaunchSummary): SocialLink[] {
  const out: SocialLink[] = [];
  const x = toUrl(l.twitter, "https://x.com/");
  const tg = toUrl(l.telegram, "https://t.me/");
  const web = toUrl(l.website, "https://");
  if (x) out.push({ kind: "x", href: x, label: "X" });
  if (tg) out.push({ kind: "telegram", href: tg, label: "Telegram" });
  if (web) out.push({ kind: "website", href: web, label: new URL(web).hostname.replace(/^www\./, "") });
  return out;
}

export function SocialIcon({ kind, className }: { kind: SocialLink["kind"]; className?: string }) {
  if (kind === "x") return <XLogo className={cn("size-3.5", className)} />;
  if (kind === "telegram") return <Send className={cn("size-4", className)} strokeWidth={1.5} aria-hidden />;
  return <Globe className={cn("size-4", className)} strokeWidth={1.5} aria-hidden />;
}

/**
 * Creator + About (§4.5): who launched it (profile, launches, creator fees earned, → profile) and
 * the token's description and links from its metadata.
 */
export function CreatorCard({ launch: l, className }: { launch: LaunchSummary; className?: string }) {
  const user = useQuery(userQuery(l.creator));
  const u = user.data;
  const links = socialLinks(l);
  const byStatus = u?.stats.launchesByStatus;
  return (
    <Panel title="Creator" className={className}>
      <div className="grid gap-4 px-4 pb-4">
        <div className="flex items-center gap-3">
          <Identicon address={l.creator} src={u?.avatar} size={40} />
          <div className="min-w-0 flex-1">
            <div className="ui truncate text-ink">{displayName(l.creator, u?.name ?? l.creatorName)}</div>
            <div className="small num text-ink-3">
              {u ? (
                <>
                  {u.stats.launchesCreated} launch{u.stats.launchesCreated === 1 ? "" : "es"}
                  {byStatus && byStatus.live > 0 ? ` · ${byStatus.live} live` : ""} ·{" "}
                  {fmtSolValue(u.stats.creatorFeesEarnedSol)} SOL creator fees
                </>
              ) : user.isError ? (
                "Profile unavailable"
              ) : (
                <Skeleton className="mt-1 h-3.5 w-40" />
              )}
            </div>
          </div>
        </div>
        <ButtonLink href={`/u/${l.creator}`} variant="secondary" size="sm" arrow className="justify-self-start">
          View profile
        </ButtonLink>

        {l.description || links.length ? (
          <div className="grid gap-3 border-t border-line pt-4">
            <h3 className="label text-ink-3">About ${l.symbol}</h3>
            {l.description ? <p className="small whitespace-pre-line text-pretty text-ink-2">{l.description}</p> : null}
            {links.length ? (
              <div className="flex flex-wrap gap-2">
                {links.map((s) => (
                  <a
                    key={s.kind}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer nofollow"
                    className="small inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 text-ink-2 transition-colors hover:bg-sunken hover:text-ink pointer-coarse:h-10"
                  >
                    <SocialIcon kind={s.kind} />
                    {s.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
