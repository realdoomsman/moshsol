"use client";

import { Check } from "lucide-react";
import { cn } from "../ui/cn";
import { STEPS, type StepIndex } from "./validate";

/**
 * Desktop stepper (§4.6, 240px): numbered steps joined by a hairline, the current one in `ink`,
 * finished ones checked with a one-line summary. Steps are clickable once visited.
 */
export function Stepper({
  step,
  visited,
  summaries,
  invalid,
  onStep,
}: {
  step: StepIndex;
  visited: StepIndex;
  /** One-line recap under each finished step. */
  summaries: (string | null)[];
  /** Steps that currently have validation errors. */
  invalid: boolean[];
  onStep: (s: StepIndex) => void;
}) {
  return (
    <nav aria-label="Create steps">
      <ol className="grid">
        {STEPS.map((s, i) => {
          const idx = i as StepIndex;
          const current = idx === step;
          const reachable = idx <= visited;
          const done = idx < visited && !current && !invalid[i];
          return (
            <li key={s.id} className="relative pb-6 last:pb-0">
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="absolute top-8 bottom-1 left-[13px] w-px bg-line" />
              ) : null}
              <button
                type="button"
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                onClick={() => onStep(idx)}
                className="group flex w-full items-start gap-3 text-left disabled:cursor-default"
              >
                <span
                  className={cn(
                    "ui num grid size-7 shrink-0 place-items-center rounded-full border transition-colors",
                    current
                      ? "border-ink bg-ink text-paper"
                      : done
                        ? "border-line-2 bg-surface text-ink"
                        : invalid[i] && reachable
                          ? "border-warn text-warn"
                          : "border-line-2 text-ink-3",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : i + 1}
                </span>
                <span className="grid min-w-0 gap-0.5 pt-1">
                  <span
                    className={cn(
                      "ui transition-colors",
                      current ? "text-ink" : reachable ? "text-ink-2 group-hover:text-ink" : "text-ink-3",
                    )}
                  >
                    {s.label}
                  </span>
                  {summaries[i] && idx !== step && reachable ? (
                    <span className="small num truncate text-ink-3">{summaries[i]}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Mobile/tablet progress (§4.6): four segments, filled up to the current step. */
export function StepProgress({ step }: { step: StepIndex }) {
  return (
    <div className="grid gap-2">
      <div
        role="progressbar"
        aria-label="Create progress"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}
        className="grid grid-cols-4 gap-1"
      >
        {STEPS.map((s, i) => (
          <span
            key={s.id}
            className={cn("h-1 rounded-full transition-colors duration-(--dur-3)", i <= step ? "bg-ink" : "bg-line-2")}
          />
        ))}
      </div>
    </div>
  );
}
