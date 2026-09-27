"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/dialog";

export interface NavGroup {
  group: string;
  items: { href: string; label: string }[];
}

/** The docs page list, grouped; the current page gets a 2px ink bar. */
export function DocsNavList({ groups, current, onNavigate }: { groups: NavGroup[]; current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Docs" className="grid gap-6">
      {groups.map((g) => (
        <div key={g.group}>
          <p className="label mb-2 text-ink-3">{g.group}</p>
          <ul className="grid border-l border-line">
            {g.items.map((item) => {
              const active = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "ui -ml-px flex min-h-9 items-center border-l-2 pl-3 transition-colors pointer-coarse:min-h-11",
                      active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Below 1024px the nav collapses into a "Menu" sheet (§4.11). */
export function DocsMobileNav({ groups, current, title }: { groups: NavGroup[]; current: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <Button variant="secondary" size="sm" icon={<Menu className="size-4" strokeWidth={1.5} />} onClick={() => setOpen(true)}>
        Docs menu
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Docs" description={title}>
        <div className="px-5 pb-6">
          <DocsNavList groups={groups} current={current} onNavigate={() => setOpen(false)} />
        </div>
      </Sheet>
    </div>
  );
}
