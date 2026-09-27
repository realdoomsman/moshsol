import type { ReactNode } from "react";
import { cn } from "../ui/cn";

/**
 * A landing section (§3.6): full-bleed 1px `line` rule on top, content in the marketing frame,
 * 128px vertical padding on desktop and 72px on mobile. Sections are separated by rules, not cards.
 */
export function Section({
  id,
  label,
  className,
  frameClassName,
  children,
}: {
  id?: string;
  /** Accessible name when the section has no visible heading of its own. */
  label?: string;
  className?: string;
  frameClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={label} className={cn("border-t border-line", className)}>
      <div className={cn("frame-marketing py-18 md:py-32", frameClassName)}>{children}</div>
    </section>
  );
}

/** Two-column section header: `display-l` title on the left, lead + link on the right (Vercel pattern). */
export function SectionHeader({ title, children, id }: { title: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-12 md:gap-6">
      <h2 id={id} className="display-l text-ink md:col-span-6">
        {title}
      </h2>
      {children ? <div className="md:col-span-5 md:col-start-8 md:self-end">{children}</div> : null}
    </div>
  );
}
