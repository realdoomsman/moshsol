"use client";

import { BookOpen, Briefcase, Compass, Ellipsis, Plus, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AgentGlyph } from "../brand/glyphs";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/dialog";
import { FaucetButton } from "./faucet";
import { isNavActive } from "./nav";
import { StatusBar } from "./status";

const ICON = { className: "size-5", strokeWidth: 1.5, "aria-hidden": true } as const;

function Tab({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("micro flex flex-1 flex-col items-center justify-center gap-1", active ? "text-ink" : "text-ink-3")}
    >
      {icon}
      {label}
    </Link>
  );
}

const MORE = [
  { href: "/leaderboard", label: "Leaderboard", icon: <Trophy {...ICON} /> },
  { href: "/agents", label: "Agents", icon: <AgentGlyph size={20} /> },
  { href: "/docs", label: "Docs", icon: <BookOpen {...ICON} /> },
];

/**
 * Mobile bottom tab bar (§4.3, below 768px): Discover · Create · Portfolio · More. "More" opens a
 * sheet with the rest of the navigation, the test-SOL faucet and the connection status.
 */
export function MobileTabs() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const moreActive = MORE.some((m) => isNavActive(pathname, m.href));
  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Tab href="/app" label="Discover" icon={<Compass {...ICON} />} active={isNavActive(pathname, "/app")} />
        <Tab href="/create" label="Create" icon={<Plus {...ICON} />} active={isNavActive(pathname, "/create")} />
        <Tab href="/portfolio" label="Portfolio" icon={<Briefcase {...ICON} />} active={isNavActive(pathname, "/portfolio")} />
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          aria-expanded={more}
          className={cn("micro flex flex-1 flex-col items-center justify-center gap-1", moreActive ? "text-ink" : "text-ink-3")}
        >
          <Ellipsis {...ICON} />
          More
        </button>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="More" hideTitle>
        <nav aria-label="More" className="grid px-2 pb-2">
          {MORE.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              onClick={() => setMore(false)}
              aria-current={isNavActive(pathname, m.href) ? "page" : undefined}
              className="ui flex h-14 items-center gap-3 border-b border-line px-3 text-ink last:border-b-0"
            >
              <span className="text-ink-2">{m.icon}</span>
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="grid gap-3 border-t border-line px-5 py-4">
          <FaucetButton className="w-full" />
          <StatusBar />
        </div>
      </Sheet>
    </>
  );
}
