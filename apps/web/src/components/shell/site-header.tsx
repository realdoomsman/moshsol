"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lockup } from "../brand/lockup";
import { Mark } from "../brand/mark";
import { SearchIconButton, SearchTrigger } from "../search/search-trigger";
import { cn } from "../ui/cn";
import { FaucetButton } from "./faucet";
import { NAV, isNavActive } from "./nav";
import { NetworkPill } from "./status";
import { WalletButton } from "./wallet-menu";

/**
 * The one top bar for every route (§4.3) — landing, docs and app share it, so moving between them
 * never changes the chrome. Desktop 56px: lockup · nav · search · network · test SOL · wallet.
 * Below 768px: 52px with the mark, network dot, search icon and an identicon-only wallet button;
 * primary navigation moves to the bottom tab bar.
 */
export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-[12px]">
      <div className="frame-app flex h-[52px] items-center gap-1 md:h-14 md:gap-7">
        <Link
          href="/"
          aria-label="Holdfast home"
          className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-sm text-ink md:ml-0 md:size-auto"
        >
          <Lockup size={22} className="hidden lg:block" />
          <Mark size={26} className="lg:hidden" />
        </Link>
        <nav aria-label="Primary" className="hidden h-full items-stretch gap-6 md:flex">
          {NAV.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "ui relative flex items-center whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]",
                  active ? "text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {item.label}
                {active ? <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" /> : null}
              </Link>
            );
          })}
        </nav>
        {/* Visibility lives on wrappers: `cn` appends classes, so `hidden` can't override a component's own display. */}
        <div className="flex md:hidden">
          <NetworkPill dotOnly />
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          <div className="hidden w-full max-w-[360px] lg:flex">
            <SearchTrigger />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <div className="flex lg:hidden">
            <SearchIconButton />
          </div>
          <div className="hidden md:flex">
            <NetworkPill />
          </div>
          <div className="hidden xl:flex">
            <FaucetButton />
          </div>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
