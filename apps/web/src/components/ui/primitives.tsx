import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...rest} />;
}

export function CardHeader({
  title,
  icon,
  right,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
        {icon}
        <span className="truncate">{title}</span>
      </h2>
      {right}
    </div>
  );
}

export type Tone = "neutral" | "lime" | "violet" | "cyan" | "up" | "down" | "warn";

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-white/[0.04] text-muted",
  lime: "border-lime/25 bg-lime/10 text-lime",
  violet: "border-violet/30 bg-violet/10 text-[#c2a6ff]",
  cyan: "border-cyan/25 bg-cyan/10 text-cyan",
  up: "border-up/25 bg-up/10 text-up",
  down: "border-down/30 bg-down/10 text-down",
  warn: "border-warn/30 bg-warn/10 text-warn",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  title,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-semibold leading-none",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full bg-current", pulse && "animate-pulse-dot", className)}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function Stat({
  label,
  value,
  sub,
  className,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-xs font-medium text-dim">{label}</div>
      <div className={cn("mt-1 truncate text-[15px] font-semibold tabular-nums text-ink", valueClassName)}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-xs tabular-nums text-dim">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-white/[0.04] text-muted">
          {icon}
        </div>
      ) : null}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children ? <div className="mt-1.5 max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Label/value line used in quotes and summaries. */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 text-[13px]", className)}>
      <span className="min-w-0 text-dim">{label}</span>
      <span className="shrink-0 text-right font-medium whitespace-nowrap tabular-nums text-ink">{children}</span>
    </div>
  );
}

export function Meter({
  value,
  tone = "lime",
  className,
  label,
}: {
  /** 0–100 */
  value: number;
  tone?: "lime" | "up" | "down" | "violet";
  className?: string;
  label?: string;
}) {
  const fill = { lime: "bg-lime", up: "bg-up", down: "bg-down", violet: "bg-violet" }[tone];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 overflow-hidden rounded-full bg-white/[0.07]", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out", fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
