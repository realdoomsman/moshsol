"use client";

import { useEffect, useRef, useState } from "react";
import { Mark } from "../brand/mark";
import { ButtonLink } from "../ui/button";

/**
 * §11 Final CTA: the sign-off, 520px tall on the ground, framed by the section rule. "Hold fast."
 * at display size with the Clamp at 72px, which plays its lock once when the section scrolls into view.
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
    <section ref={ref} aria-labelledby="final-cta" className="border-t border-line">
      <div className="frame-marketing flex min-h-[440px] flex-col items-start justify-center gap-8 py-20 md:min-h-[520px] md:items-center md:text-center">
        <Mark size={72} animate={played ? "clamp" : "none"} className="text-ink" />
        <h2 id="final-cta" className="display-xl text-ink">
          Hold fast.
        </h2>
        <div className="grid w-full gap-3 sm:flex sm:w-auto">
          <ButtonLink href="/create" variant="accent" size="lg">
            Launch a token
          </ButtonLink>
          <ButtonLink href="/app" variant="secondary" size="lg" arrow>
            Discover launches
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
