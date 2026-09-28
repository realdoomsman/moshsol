import { JAW_LEFT, JAW_RIGHT } from "@/components/brand/mark";
import { LOCKUP_VIEW_H, LOCKUP_VIEW_W, WORDMARK } from "@/components/brand/lockup";

/**
 * The site palette (app/globals.css, = the brand kit / X banner) as literals for `next/og` share
 * cards: Satori can't read CSS variables. Every OG image draws from this one table.
 */
export const OG = {
  paper: "#0f100e",
  surface: "#161714",
  sunken: "#0b0c0a",
  ink: "#f2f1ec",
  ink2: "#a9a89f",
  ink3: "#85857c",
  line: "#2a2b27",
  line2: "#3a3b35",
  accent: "#ff5b1a",
  accentInk: "#ff7a45",
  accentWash: "#2a1a10",
  up: "#3ccb7f",
  down: "#f0575c",
  warn: "#f2b33d",
  warnWash: "#2b2211",
} as const;

/** The real lockup (outlined wordmark + Clamp, coin in accent) at a given height in px. */
export function OgLockup({ height = 40 }: { height?: number }) {
  return (
    <svg width={(height * LOCKUP_VIEW_W) / LOCKUP_VIEW_H} height={height} viewBox={`0 0 ${LOCKUP_VIEW_W} ${LOCKUP_VIEW_H}`}>
      <g transform="scale(36.875)">
        <path d={JAW_LEFT} fill={OG.ink} />
        <path d={JAW_RIGHT} fill={OG.ink} />
        <circle cx="16" cy="16" r="5.5" fill={OG.accent} />
      </g>
      <path d={WORDMARK} fill={OG.ink} />
    </svg>
  );
}
