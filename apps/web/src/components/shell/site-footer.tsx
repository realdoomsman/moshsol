import { PROGRAM_ID } from "@holdfast/sdk";
import Link from "next/link";
import { Lockup } from "../brand/lockup";
import { Address } from "../ui/address";
import { StatusBar } from "./status";
import { X_HANDLE, X_URL, XLogo } from "../brand/x-link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/app", label: "Discover" },
      { href: "/create", label: "Create" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { href: "/docs/how-it-works", label: "How it works" },
      { href: "/docs/agents", label: "Agent rules" },
      { href: "/agents", label: "Transparency" },
      { href: "/docs/fees", label: "Fees" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/docs/api", label: "API" },
      { href: "/docs/program", label: "Program IDL" },
      { href: "/docs/brand", label: "Brand kit" },
    ],
  },
] as const;

const STRIP_LINKS = [
  { href: "/docs/risks", label: "Risks" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

/**
 * The one footer for every route (§4.2 §12, #25): lockup + program ID, link columns, then the live
 * status strip (indexer sync, agent heartbeat, network). The strip is its own element so it can pin
 * to the bottom of the viewport on desktop (terminal status line) and dock under the columns at the
 * end of the page; on mobile it sits in the flow above the bottom tab bar.
 */
export function SiteFooter() {
  return (
    <>
      <footer className="border-t border-line">
        <div className="frame-app grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-12 md:py-16">
          <div className="col-span-2 grid content-start gap-5 md:col-span-6">
            <Link href="/" aria-label="Holdfast home" className="w-fit rounded-xs text-ink">
              <Lockup size={20} />
            </Link>
            <p className="small max-w-[34ch] text-ink-3">Backers make the first buy; a vault agent holds it. Every vault move is on-chain.</p>
            <div className="grid gap-1">
              <span className="label text-ink-3">Program</span>
              <Address address={PROGRAM_ID.toBase58()} chars={6} />
            </div>
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Holdfast on X (${X_HANDLE})`}
              className="ui flex w-fit items-center gap-2 rounded-xs text-ink-2 transition-colors hover:text-ink"
            >
              <XLogo className="size-4" />
              {X_HANDLE}
            </a>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="grid content-start gap-2.5 md:col-span-2">
              <h2 className="label mb-1 text-ink-3">{col.title}</h2>
              {col.links.map((l) => (
                <Link key={l.href} href={l.href} className="ui w-fit rounded-xs text-ink-2 transition-colors hover:text-ink">
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </footer>
      <div
        role="region"
        aria-label="Network status"
        className="z-30 border-t border-line bg-paper md:sticky md:bottom-0"
      >
        <div className="frame-app flex flex-col gap-2 py-3 md:h-8 md:flex-row md:items-center md:justify-between md:gap-4 md:py-0">
          <StatusBar className="md:flex-nowrap md:overflow-hidden" />
          <div className="micro flex shrink-0 items-center gap-4 text-ink-3">
            {STRIP_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-xs transition-colors hover:text-ink">
                {l.label}
              </Link>
            ))}
            <a href={X_URL} target="_blank" rel="noopener noreferrer" className="rounded-xs transition-colors hover:text-ink">
              X
            </a>
            <span>© {new Date().getFullYear()} Holdfast</span>
          </div>
        </div>
      </div>
    </>
  );
}
