"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../ui/cn";

export interface HowStep {
  title: string;
  description: ReactNode;
  /** The on-chain rule behind the step, rendered from platform params ("Bundle: follows the raise, ≤ 75% of supply"). */
  rule: string | null;
  frame: ReactNode;
}

/**
 * §4 How a launch works. Desktop: a sticky step list (4/12) beside four frames (8/12), each given
 * ~72% of the viewport so one beat fills the screen at a time without dead air; the active step
 * is the frame whose centre is nearest the viewport centre, marked by a 2px ink bar that slides
 * over 160 ms. Mobile: title, description and frame stacked, no sticky column.
 */
export function HowSteps({ steps }: { steps: HowStep[] }) {
  const [active, setActive] = useState(0);
  const frames = useRef<(HTMLDivElement | null)[]>([]);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      let bestDist = Infinity;
      frames.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const el = items.current[active];
    if (el) setBar({ top: el.offsetTop, height: el.offsetHeight });
  }, [active]);

  return (
    <div className="mt-12 lg:mt-4 lg:grid lg:grid-cols-12 lg:gap-6">
      <ol className="relative hidden self-start border-l border-line lg:sticky lg:top-[max(88px,calc(50dvh-280px))] lg:col-span-4 lg:block">
        {bar ? (
          <span
            aria-hidden
            className="absolute -left-px w-0.5 bg-ink transition-[translate,height] duration-(--dur-2) ease-(--ease-out)"
            style={{ translate: `0 ${bar.top}px`, height: bar.height }}
          />
        ) : null}
        {steps.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              items.current[i] = el;
            }}
            aria-current={i === active ? "step" : undefined}
            className="py-5 pl-6"
          >
            <StepText step={s} index={i} dim={i !== active} />
          </li>
        ))}
      </ol>
      <div className="grid gap-16 lg:col-span-8 lg:gap-0">
        {steps.map((s, i) => (
          <div
            key={s.title}
            ref={(el) => {
              frames.current[i] = el;
            }}
            className="lg:flex lg:h-[72dvh] lg:min-h-[520px] lg:items-center lg:justify-center"
          >
            <div className="mb-6 lg:hidden">
              <StepText step={s} index={i} />
            </div>
            <div className="w-full max-w-[640px]">{s.frame}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepText({ step, index, dim }: { step: HowStep; index: number; dim?: boolean }) {
  return (
    <>
      <p className="label num text-ink-3">{String(index + 1).padStart(2, "0")}</p>
      <h3 className={cn("h2 mt-2 transition-colors duration-(--dur-2)", dim ? "text-ink-3" : "text-ink")}>{step.title}</h3>
      <p className={cn("body mt-2 transition-colors duration-(--dur-2)", dim ? "text-ink-3" : "text-ink-2")}>{step.description}</p>
      {step.rule ? <p className="mono mt-3 text-ink-3">{step.rule}</p> : null}
    </>
  );
}

/**
 * The same four beats for a narrow column (docs): each step's text, then its live frame, stacked
 * and divided by hairlines — no sticky list, no scroll tracking.
 */
export function HowStepsStacked({ steps }: { steps: HowStep[] }) {
  return (
    <ol className="mt-6 grid border-t border-line">
      {steps.map((s, i) => (
        <li key={s.title} className="grid gap-5 border-b border-line py-8">
          <div className="max-w-[560px]">
            <StepText step={s} index={i} />
          </div>
          {s.frame}
        </li>
      ))}
    </ol>
  );
}
