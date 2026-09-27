"use client";

import { useEffect, useRef, useState } from "react";
import { Mark } from "../brand/mark";
import { ButtonLink } from "../ui/button";

/**
 * §11 Final CTA: the one dark band on Paper, 480px tall. "Hold fast." with the Clamp at 64px, which
 * plays its lock once when the band scrolls into view.
 */
export function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setPlayed(true);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section ref={ref} aria-labelledby="final-cta" className="relative z-10 bg-ink">
      <div className="frame-marketing flex min-h-[480px] flex-col items-start justify-center gap-8 py-18 md:items-center md:text-center">
        <Mark size={64} animate={played ? "clamp" : "none"} className="text-paper" />
        <h2 id="final-cta" className="display-l text-paper">
          Hold fast.
        </h2>
        <div className="grid w-full gap-3 sm:flex sm:w-auto">
          <ButtonLink href="/create" variant="accent" size="lg">
            Launch a token
          </ButtonLink>
          <ButtonLink href="/app" variant="inverse" size="lg" arrow>
            Open app
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
