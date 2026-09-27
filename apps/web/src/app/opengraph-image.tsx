import { ImageResponse } from "next/og";
import { JAW_LEFT, JAW_RIGHT } from "@/components/brand/mark";
import { ogFonts } from "@/lib/og-fonts";

export const alt = "Holdfast — launches that can't be dumped";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Paper tokens (§3.4); OG images render outside the CSS, so the values are spelled out here.
const PAPER = "#f6f5f1";
const INK = "#0e0f0c";
const INK_3 = "#66675f";
const LINE = "#e3e1da";
const ACCENT = "#ff4f00";

/** A static band drawing: a price line through an EMA channel (illustrative shape, no data values). */
const W = 1040;
const H = 190;
const price = [0.55, 0.5, 0.58, 0.45, 0.4, 0.62, 0.7, 0.52, 0.3, 0.26, 0.38, 0.5, 0.47, 0.6, 0.72, 0.66, 0.58];
const ema = price.map((_, i) => {
  const w = price.slice(Math.max(0, i - 4), i + 1);
  return w.reduce((a, b) => a + b, 0) / w.length;
});
const pt = (v: number, i: number, off = 0) => `${((i / (price.length - 1)) * W).toFixed(1)},${((1 - v - off) * H).toFixed(1)}`;
const pathOf = (vals: number[], off = 0) => vals.map((v, i) => `${i ? "L" : "M"}${pt(v, i, off)}`).join("");

/** Default share card (§3.9): "Launches that can't be dumped." on Paper with a static band drawing. */
export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: PAPER, padding: "64px 80px" }}>
        <div style={{ display: "flex", fontFamily: "Mona Sans Display", fontSize: 84, lineHeight: 1, letterSpacing: "-0.04em", color: INK }}>
          Launches that can&rsquo;t be dumped.
        </div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 48 }}>
          <path d={`${pathOf(ema, 0.08)}L${[...ema].reverse().map((v, i) => pt(v, ema.length - 1 - i, -0.08)).join("L")}Z`} fill={ACCENT} fillOpacity={0.07} />
          <path d={pathOf(ema, 0.08)} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="8 8" />
          <path d={pathOf(ema, -0.08)} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="8 8" />
          <path d={pathOf(ema)} fill="none" stroke={INK_3} strokeWidth={2} strokeDasharray="2 6" />
          <path d={pathOf(price)} fill="none" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        </svg>
        <div style={{ display: "flex", alignItems: "center", marginTop: "auto", borderTop: `1px solid ${LINE}`, paddingTop: 28 }}>
          <svg width={44} height={44} viewBox="0 0 32 32">
            <path d={JAW_LEFT} fill={INK} />
            <path d={JAW_RIGHT} fill={INK} />
            <circle cx={16} cy={16} r={5.5} fill={ACCENT} />
          </svg>
          <div style={{ display: "flex", marginLeft: 14, fontFamily: "Mona Sans Display", fontSize: 36, color: INK, letterSpacing: "-0.03em" }}>
            holdfast
          </div>
          <div style={{ display: "flex", marginLeft: "auto", fontFamily: "Mona Sans", fontSize: 26, color: INK_3 }}>Hold fast.</div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
