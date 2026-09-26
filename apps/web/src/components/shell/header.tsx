"use client";

import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CLUSTER, CLUSTER_LABEL, IS_TEST_CLUSTER } from "@/lib/env";
import { useLive } from "@/lib/live";
import { cn } from "../ui/cn";
import { Logo } from "./logo";
import { AirdropButton, WalletButton } from "./wallet-button";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/agents", label: "Agents" },
  { href: "/how-it-works", label: "How it works" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/launch") : pathname.startsWith(href);
}

function NetworkBadge() {
  const { connected } = useLive();
  return (
    <span
      className="hidden h-8 items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 text-xs font-semibold text-muted lg:inline-flex"
      title={connected ? "Indexer stream connected" : "Indexer stream reconnecting — polling"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "animate-pulse-dot bg-up text-up" : "bg-warn text-warn",
        )}
      />
      {CLUSTER_LABEL[CLUSTER]}
    </span>
  );
}

export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled || menuOpen ? "border-line bg-bg/80 backdrop-blur-xl" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "text-ink" : "text-dim hover:text-ink",
                )}
              >
                {n.label}
                {active ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-lime"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NetworkBadge />
          {IS_TEST_CLUSTER ? (
            <>
              <span className="hidden sm:block">
                <AirdropButton />
              </span>
              <span className="sm:hidden">
                <AirdropButton compact />
              </span>
            </>
          ) : null}
          <WalletButton />
          <button
            type="button"
            className="grid size-10 place-items-center rounded-xl border border-line bg-white/[0.04] text-muted md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {menuOpen ? (
          <motion.nav
            aria-label="Mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-line md:hidden"
          >
            <div className="grid gap-1 px-4 py-3">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "rounded-xl px-3 py-3 text-[15px] font-medium",
                    isActive(pathname, n.href) ? "bg-white/[0.06] text-ink" : "text-muted",
                  )}
                >
                  {n.label}
                </Link>
              ))}
              <div className="mt-2 flex items-center gap-2 px-3 text-xs text-dim">
                <span className="size-1.5 rounded-full bg-up" /> {CLUSTER_LABEL[CLUSTER]}
              </div>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
