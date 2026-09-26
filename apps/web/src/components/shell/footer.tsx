import { PROGRAM_ID } from "@moshsol/sdk";
import Link from "next/link";
import { CLUSTER, CLUSTER_LABEL } from "@/lib/env";
import { explorerAddress } from "@/lib/explorer";
import { Logo } from "./logo";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create a launch" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/agents", label: "Agent transparency" },
  { href: "/how-it-works", label: "How it works" },
];

export function Footer() {
  const programId = PROGRAM_ID.toBase58();
  return (
    <footer className="mt-24 border-t border-line bg-black/30">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Launches that can&apos;t be dumped. Every bundle is locked forever in an on-chain vault and traded only by
            rate-limited agents — backers earn the trading fees.
          </p>
        </div>
        <nav aria-label="Footer" className="grid content-start gap-2.5 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-dim">Product</div>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="w-fit text-muted transition hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="grid content-start gap-2.5 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-dim">On-chain</div>
          <div className="text-muted">
            Network <span className="font-medium text-ink">{CLUSTER_LABEL[CLUSTER]}</span>
          </div>
          <div className="min-w-0 text-muted">
            Program{" "}
            <a
              href={explorerAddress(programId)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12.5px] break-all text-ink transition hover:text-lime"
            >
              {programId}
            </a>
          </div>
          <p className="text-xs leading-relaxed text-dim">
            Fixed 1B supply · mint authority revoked · no withdraw instruction exists for vaults.
          </p>
        </div>
      </div>
    </footer>
  );
}
