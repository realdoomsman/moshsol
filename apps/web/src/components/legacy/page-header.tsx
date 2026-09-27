import type { ReactNode } from "react";
import { cn } from "../ui/cn";

const TONE = {
  lime: "text-lime",
  violet: "text-[#c2a6ff]",
  cyan: "text-cyan",
  up: "text-up",
};
const DOT = {
  lime: "bg-lime text-lime",
  violet: "bg-violet text-violet",
  cyan: "bg-cyan text-cyan",
  up: "bg-up text-up",
};

/** Page title block: pulsing eyebrow, display-weight title, lead paragraph. */
export function PageHeader({
  eyebrow,
  title,
  children,
  tone = "lime",
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <div className={cn("mb-10 max-w-2xl", className)}>
      <div className={cn("type-eyebrow flex items-center gap-2", TONE[tone])}>
        <span className={cn("size-1.5 animate-pulse-dot rounded-full", DOT[tone])} aria-hidden />
        {eyebrow}
      </div>
      <h1 className="type-title mt-3 text-4xl sm:text-5xl">{title}</h1>
      {children ? <p className="mt-3 text-[15px] leading-relaxed text-muted text-pretty sm:text-base">{children}</p> : null}
    </div>
  );
}
