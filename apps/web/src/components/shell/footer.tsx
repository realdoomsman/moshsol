import { PROGRAM_ID, shortAddr } from "@moshsol/sdk";
import { ArrowUpRight, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CLUSTER, CLUSTER_LABEL } from "@/lib/env";
import { explorerAddress } from "@/lib/explorer";
import { cn } from "../ui/cn";
import { Logo } from "./logo";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Explore launches" },
      { href: "/create", label: "Create a launch" },
      { href: "/portfolio", label: "Portfolio" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/how-it-works", label: "Docs" },
      { href: "/agents", label: "Agent rules" },
      { href: "/how-it-works#faq", label: "FAQ" },
    ],
  },
];

const linkClass =
  "inline-flex min-h-10 w-fit items-center gap-1 rounded-md text-muted transition-colors hover:text-ink md:min-h-8";

function Column({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid content-start gap-1", className)}>
      <div className="type-eyebrow mb-2 text-dim">{title}</div>
      {children}
    </div>
  );
}

export function Footer() {
  const programId = PROGRAM_ID.toBase58();
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-line bg-black/40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime/40 to-transparent"
      />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-64 w-[48rem] -translate-x-1/2 rounded-full bg-violet/[0.07] blur-3xl" />
      <div className="relative mx-auto grid max-w-[1400px] grid-cols-2 gap-x-6 gap-y-10 px-4 pt-14 pb-10 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1.3fr] lg:px-8">
        <div className="col-span-2 max-w-sm md:col-span-1">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Launches that can&apos;t be dumped. Every bundle is locked forever in an on-chain vault and traded only by
            rate-limited agents — backers earn the trading fees.
          </p>
          <div className="mt-5 inline-flex h-8 items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 text-xs font-medium text-muted">
            <Lock className="size-3.5 text-lime" aria-hidden />
            No withdraw instruction exists for vaults
          </div>
        </div>
        {COLUMNS.map((col) => (
          <Column key={col.title} title={col.title}>
            <nav aria-label={col.title} className="grid gap-0.5 text-sm">
              {col.links.map((l) => (
                <Link key={l.href} href={l.href} className={linkClass}>
                  {l.label}
                </Link>
              ))}
            </nav>
          </Column>
        ))}
        <Column title="On-chain" className="col-span-2 md:col-span-1">
          <div className="grid gap-0.5 text-sm">
            <a href={explorerAddress(programId)} target="_blank" rel="noreferrer" className={`${linkClass} group`}>
              Program on Solana Explorer
              <ArrowUpRight className="size-3.5 text-dim transition group-hover:text-lime" aria-hidden />
            </a>
            <div className="mt-2 grid gap-2 rounded-xl border border-line bg-white/[0.02] p-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-dim">Network</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                  <span className="size-1.5 rounded-full bg-up" aria-hidden />
                  {CLUSTER_LABEL[CLUSTER]}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-dim">Program</span>
                <span className="font-mono text-muted" title={programId}>
                  {shortAddr(programId, 6)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-dim">Supply</span>
                <span className="text-muted">1B fixed · mint revoked</span>
              </div>
            </div>
          </div>
        </Column>
      </div>
      <div className="relative mx-auto flex max-w-[1400px] flex-col gap-2 border-t border-line px-4 py-5 text-xs text-dim sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <span>moshsol · bundle-locked launches on Solana</span>
        <span>Prices, vaults and trades are read from Solana via the moshsol indexer.</span>
      </div>
      <div
        aria-hidden
        className="pointer-events-none relative -mb-[2.6vw] text-center text-[15vw] leading-[0.8] font-bold tracking-[-0.06em] text-white/[0.025] select-none"
      >
        moshsol
      </div>
    </footer>
  );
}
