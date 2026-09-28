"use client";

import { useEffect, useState } from "react";
import { cn } from "../ui/cn";

/** "On this page" (§4.11, ≥ 1280px only): section links on a hairline rail; the one being read gets the 2px ink bar, like the docs nav. */
export function DocsToc({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const onScroll = () => {
      // The last heading above the top third of the viewport is the one being read.
      const line = window.innerHeight / 3;
      let current = els[0]?.id ?? "";
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);
  return (
    <nav aria-label="On this page">
      <p className="label mb-3 text-ink-3">On this page</p>
      <div className="grid border-l border-line">
        {items.map((i) => (
          <a
            key={i.id}
            href={`#${i.id}`}
            aria-current={i.id === active ? "location" : undefined}
            className={cn(
              "small -ml-px border-l-2 py-1.5 pl-3 transition-colors hover:text-ink focus-visible:outline-offset-0",
              i.id === active ? "border-ink text-ink" : "border-transparent text-ink-3",
            )}
          >
            {i.title}
          </a>
        ))}
      </div>
    </nav>
  );
}
