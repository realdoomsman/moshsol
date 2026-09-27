import type { ReactNode, SVGProps } from "react";

/**
 * Protocol glyphs (§3.7): 16-unit grid, stroke 1.5, square caps — drawn to sit next to lucide
 * icons. Colour inherits `currentColor`; size defaults to 16 (never above 24 in the app).
 */
type GlyphProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; title?: string };

function Glyph({ size = 16, title, children, ...rest }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Locked, vault: the mark's jaws in outline around a solid coin. */
export function ClampGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 2.75H2.75v10.5H6" />
      <path d="M10 2.75h3.25v10.5H10" />
      <circle cx="8" cy="8" r="2.25" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Agent action / agent filter: the chart marker diamond. `outline` = agent sell marker. */
export function AgentGlyph({ outline, ...props }: GlyphProps & { outline?: boolean }) {
  return (
    <Glyph {...props}>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" fill={outline ? "none" : "currentColor"} strokeLinejoin="miter" />
    </Glyph>
  );
}

/** Band / EMA: outer edges dashed, the EMA dotted. */
export function BandGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M1.75 3.75h12.5" strokeDasharray="3 2" />
      <path d="M1.75 8h12.5" strokeDasharray="0.01 2.5" strokeLinecap="round" />
      <path d="M1.75 12.25h12.5" strokeDasharray="3 2" />
    </Glyph>
  );
}

/** Backer / backer fees: a coin with a small plus at the top right. */
export function BackerGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="7" cy="9" r="4.75" />
      <path d="M13 1.75v4M11 3.75h4" />
    </Glyph>
  );
}

/** Raise / progress: a bar with the minimum tick. */
export function RaiseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M1.75 6.25h12.5v3.5H1.75Z" />
      <path d="M1.75 8h6" strokeWidth={3.5} strokeLinecap="butt" />
      <path d="M10.5 3.5v9" />
    </Glyph>
  );
}

/** Refund: a U-turn arrow back into a bracket. */
export function RefundGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M11.75 2.75h1.5v10.5h-1.5" />
      <path d="M9 4.75H5.25a2.75 2.75 0 0 0 0 5.5H9" />
      <path d="M7.25 8.5 9 10.25 7.25 12" />
    </Glyph>
  );
}

/** Verified on-chain: a check inside brackets. */
export function VerifyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 2.75H2.75v10.5H4.5" />
      <path d="M11.5 2.75h1.75v10.5H11.5" />
      <path d="m5.5 8.25 1.75 1.75 3.25-3.75" />
    </Glyph>
  );
}

/** Fee split: one bar cut into 50 / 30 / 20. */
export function SplitGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M1.75 5.5h6v5h-6Z" fill="currentColor" />
      <path d="M9.25 5.5h3v5h-3Z" />
      <path d="M13.75 5.5h.5v5h-.5Z" />
    </Glyph>
  );
}
