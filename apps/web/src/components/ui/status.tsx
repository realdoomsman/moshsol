import { fmtChange } from "@/lib/format";
import { PHASE_LABEL, type Phase } from "@/lib/launch";
import { cn } from "./cn";
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
