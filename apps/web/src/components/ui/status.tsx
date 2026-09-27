import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { fmtChange } from "@/lib/format";
import { PHASE_LABEL, type Phase } from "@/lib/launch";
import { cn } from "./cn";
import { AnimatedNumber } from "./interactive";
import { Badge, Dot, type Tone } from "./primitives";

const PHASE_TONE: Record<Phase, Tone> = {
  raising: "violet",
  ready: "lime",
  failed: "down",
  live: "up",
  refunding: "warn",
};

export function PhasePill({ phase, className }: { phase: Phase; className?: string }) {
  return (
    <Badge tone={PHASE_TONE[phase]} className={className}>
      <Dot pulse={phase === "live" || phase === "raising" || phase === "ready"} />
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

export function ChangeText({ value, className }: { value: number | null | undefined; className?: string }) {
  const tone = !value || !isFinite(value) ? "text-muted" : value > 0 ? "text-up" : "text-down";
  return <span className={cn("tabular-nums", tone, className)}>{fmtChange(value)}</span>;
}

const PILL_TONE = {
  up: "border-up/30 bg-up/12 text-up shadow-[0_0_24px_-8px_rgb(47_230_167/0.7)]",
  down: "border-down/30 bg-down/12 text-down shadow-[0_0_24px_-8px_rgb(255_92_124/0.7)]",
  flat: "border-line bg-white/[0.05] text-muted",
};

/** Percent change with direction arrow; the number springs to new values and the pill pops when the direction flips. */
export function ChangePill({
  value,
  label,
  size = "md",
  className,
}: {
  value: number | null | undefined;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const v = value !== null && value !== undefined && isFinite(value) ? value : null;
  const dir = v === null || v === 0 ? "flat" : v > 0 ? "up" : "down";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <span
      key={dir}
      className={cn(
        "inline-flex shrink-0 animate-pop items-center gap-1 rounded-full border font-semibold whitespace-nowrap tabular-nums",
        PILL_TONE[dir],
        size === "md" ? "h-7 px-2.5 text-[13px]" : "h-6 px-2 text-xs",
        className,
      )}
    >
      <Icon className={size === "md" ? "size-3.5" : "size-3"} aria-hidden />
      <span className="sr-only">{dir === "up" ? "up " : dir === "down" ? "down " : ""}</span>
      {v === null ? "—" : <AnimatedNumber value={v} format={(n) => fmtChange(n).replace(/^[+-]/, "")} />}
      {label ? <span className="font-medium opacity-70">{label}</span> : null}
    </span>
  );
}
