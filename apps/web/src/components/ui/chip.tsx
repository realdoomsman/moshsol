import type { ReactNode } from "react";
import { AgentGlyph, ClampGlyph } from "../brand/glyphs";
import { cn } from "./cn";

export type ChipTone = "neutral" | "muted" | "faint" | "ink" | "accent" | "warn";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-sunken text-ink",
  muted: "bg-sunken text-ink-2",
  faint: "bg-sunken text-ink-3",
  ink: "bg-ink text-paper",
  accent: "bg-accent-wash text-accent-ink",
  warn: "bg-warn-wash text-warn",
};

/**
 * 22px tag: 4px radius, 11px uppercase `label` type (§3.4 rule 3). The only badge/tag primitive —
 * status and role chips below are presets of it. Never use up/down colours on a chip.
 */
export function Chip({
  tone = "neutral",
  icon,
  title,
  className,
  children,
}: {
  tone?: ChipTone;
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "label inline-flex h-[22px] shrink-0 items-center gap-1 rounded-xs px-1.5 whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export type LaunchChipStatus = "raising" | "min-reached" | "live" | "locked" | "refunding" | "ended";

const STATUS: Record<LaunchChipStatus, { tone: ChipTone; label: string }> = {
  raising: { tone: "warn", label: "Raising" },
  "min-reached": { tone: "accent", label: "Min reached" },
  live: { tone: "neutral", label: "Live" },
  locked: { tone: "accent", label: "Locked" },
  refunding: { tone: "muted", label: "Refunding" },
  ended: { tone: "faint", label: "Ended" },
};

/** Launch lifecycle chip with the exact colours of §3.4 (Live gets a 6px ink dot, Locked the clamp). */
export function StatusChip({ status, className }: { status: LaunchChipStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Chip
      tone={s.tone}
      className={className}
      icon={
        status === "live" ? (
          <span aria-hidden className="size-1.5 rounded-full bg-ink" />
        ) : status === "locked" ? (
          <ClampGlyph size={12} />
        ) : undefined
      }
    >
      {s.label}
    </Chip>
  );
}

export type Role = "creator" | "backer" | "agent" | "holder";

const ROLE: Record<Role, { tone: ChipTone; label: string }> = {
  creator: { tone: "accent", label: "Creator" },
  backer: { tone: "ink", label: "Backer" },
  agent: { tone: "accent", label: "Agent" },
  holder: { tone: "neutral", label: "Holder" },
};

/**
 * Receipt/role chip for makers, holders and comment authors (§4.5): Creator (accent), Backer (ink,
 * optionally "Backer · 4.2% share" via `detail`), Agent (accent + ◆), Holder (sunken).
 */
export function RoleChip({ role, detail, className }: { role: Role; detail?: string; className?: string }) {
  const r = ROLE[role];
  return (
    <Chip tone={r.tone} className={className} icon={role === "agent" ? <AgentGlyph size={10} /> : undefined}>
      {detail ? `${r.label} · ${detail}` : r.label}
    </Chip>
  );
}

export type DotTone = "up" | "warn" | "down" | "unknown";

const DOT: Record<DotTone, string> = {
  up: "bg-up",
  warn: "bg-warn",
  down: "bg-down",
  unknown: "bg-ink-3",
};

/**
 * 6px health dot (● online/synced = up, stale = warn, offline = down). `live` adds the 2 s opacity
 * pulse — the one idle animation a page may run, so use it on one dot per page (the header status).
 */
export function StatusDot({ tone, live, className }: { tone: DotTone; live?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[tone], live && tone === "up" && "animate-live", className)}
    />
  );
}
