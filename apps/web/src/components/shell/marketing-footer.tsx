import { PROGRAM_ID } from "@holdfast/sdk";
import Link from "next/link";
import { Address } from "../ui/address";
import { StatusBar } from "./status";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/app", label: "Launches" },
      { href: "/create", label: "Create" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { href: "/docs/how-it-works", label: "How it works" },
      { href: "/docs/vault-and-agent", label: "Agent rules" },
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

/**
 * Paper footer (§4.2 §12): link columns, the program ID, and the live status bar (indexer, agent,
 * network). No watermark, no duplicated nav blocks.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="frame-marketing grid grid-cols-2 gap-x-6 gap-y-10 py-16 md:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.title} className="grid content-start gap-2">
            <h2 className="label mb-1 text-ink-3">{col.title}</h2>
            {col.links.map((l) => (
              <Link key={l.href} href={l.href} className="ui w-fit text-ink-2 transition-colors hover:text-ink">
                {l.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="col-span-2 grid content-start gap-2 md:col-span-1">
          <h2 className="label mb-1 text-ink-3">On-chain</h2>
          <span className="small text-ink-2">Program</span>
          <Address address={PROGRAM_ID.toBase58()} chars={6} />
        </div>
      </div>
      <div className="border-t border-line">
        <div className="frame-marketing flex flex-col gap-2 py-4 md:flex-row md:items-center md:justify-between">
          <StatusBar />
          <div className="micro flex items-center gap-4 text-ink-3">
            <span>© {new Date().getFullYear()} Holdfast</span>
            <Link href="/docs/risks" className="transition-colors hover:text-ink">
              Risks
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
