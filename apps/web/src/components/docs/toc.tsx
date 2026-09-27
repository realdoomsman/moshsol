"use client";

import { useEffect, useState } from "react";
import { cn } from "../ui/cn";

/** "On this page" (§4.11, ≥ 1280px only): section links; the one being read is marked in ink. */
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
    <nav aria-label="On this page" className="grid gap-1">
      <p className="label mb-2 text-ink-3">On this page</p>
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          aria-current={i.id === active ? "location" : undefined}
          className={cn("small py-1 transition-colors hover:text-ink", i.id === active ? "text-ink" : "text-ink-3")}
        >
          {i.title}
        </a>
      ))}
    </nav>
  );
}
