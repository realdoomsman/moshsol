"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../ui/cn";

/**
 * Landing scroll reveal (§3.8 rule 2): the direct children fade in and rise 12px over 600 ms, once,
 * when 15% of the group is visible, with a 60 ms stagger. The hidden state is only applied after
 * hydration and only to groups still below the fold, so content is visible without JS and nothing
 * already on screen flickers. Reduced motion: never hidden.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    el.dataset.reveal = "hidden";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.reveal = "shown";
        io.disconnect();
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn(
        "[&>*]:transition-[opacity,translate] [&>*]:duration-(--dur-5) [&>*]:ease-(--ease-out)",
        "data-[reveal=hidden]:[&>*]:translate-y-3 data-[reveal=hidden]:[&>*]:opacity-0",
        "[&>*:nth-child(2)]:delay-60 [&>*:nth-child(3)]:delay-120 [&>*:nth-child(4)]:delay-180",
        className,
      )}
    >
      {children}
    </div>
  );
}
