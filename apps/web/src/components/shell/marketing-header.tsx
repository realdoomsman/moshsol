"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Lockup } from "../brand/lockup";
import { ButtonLink, IconButton } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { MARKETING_NAV } from "./nav";
import { NetworkPill } from "./status";

/**
 * Paper header (§4.2 §0): sticky 64px; lockup · centre links · network pill + "Open app →".
 * Transparent at the top; past 8px of scroll it gets `paper` at 85%, blur(12px) and a hairline.
 * Mobile: lockup, "Open app" (sm) and a menu icon opening a full-screen sheet.
 */
export function MarketingHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors",
        scrolled ? "border-line bg-paper/85 backdrop-blur-[12px]" : "border-transparent",
      )}
    >
      <div className="frame-marketing flex h-16 items-center gap-6">
        <Link href="/" aria-label="Holdfast home" className="shrink-0 text-ink">
          <Lockup size={22} />
        </Link>
        <nav aria-label="Primary" className="hidden flex-1 justify-center gap-7 md:flex">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className="ui text-ink-2 transition-colors hover:text-ink aria-[current=page]:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          {/* Visibility lives on wrappers: `cn` appends classes, so `hidden` can't override a component's own display. */}
          <div className="hidden items-center gap-3 md:flex">
            <NetworkPill />
            <ButtonLink href="/app" variant="primary" size="md" arrow>
              Open app
            </ButtonLink>
          </div>
          <div className="flex items-center gap-1 md:hidden">
            <ButtonLink href="/app" variant="primary" size="sm">
              Open app
            </ButtonLink>
            <IconButton label="Menu" onClick={() => setMenu(true)} className="-mr-2" aria-haspopup="dialog">
              <Menu className="size-5" strokeWidth={1.5} aria-hidden />
            </IconButton>
          </div>
        </div>
      </div>

      <Dialog
        open={menu}
        onOpenChange={setMenu}
        title="Menu"
        mobile="fullscreen"
        footer={
          <ButtonLink href="/app" variant="primary" size="lg" arrow className="w-full" onClick={() => setMenu(false)}>
            Open app
          </ButtonLink>
        }
      >
        <nav aria-label="Menu" className="grid px-5">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenu(false)}
              className="flex h-16 items-center border-b border-line text-[24px] [font-weight:560] tracking-[-0.015em] text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-5">
          <NetworkPill />
        </div>
      </Dialog>
    </header>
  );
}
