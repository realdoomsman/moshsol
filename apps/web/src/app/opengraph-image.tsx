import { ImageResponse } from "next/og";
import { OG, OgLockup } from "@/lib/og-brand";
import { ogFonts } from "@/lib/og-fonts";

export const alt = "Holdfast — launches that can't be dumped";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** A static band drawing: a price line through an EMA channel (illustrative shape, no data values). */
const W = 1056;
const H = 150;
const BAND = 0.08;
const price = [0.55, 0.5, 0.58, 0.45, 0.4, 0.62, 0.7, 0.52, 0.3, 0.26, 0.38, 0.5, 0.47, 0.6, 0.72, 0.66, 0.58];
const ema = price.map((_, i) => {
  const w = price.slice(Math.max(0, i - 4), i + 1);
  return w.reduce((a, b) => a + b, 0) / w.length;
});
const px = (i: number) => (i / (price.length - 1)) * W;
/** The drawn values span ~0.2–0.8; map that band onto the full drawing height. */
const py = (v: number) => (1 - (v - 0.14) / 0.72) * H;
const pt = (v: number, i: number, off = 0) => `${px(i).toFixed(1)},${py(v + off).toFixed(1)}`;
const pathOf = (vals: number[], off = 0) => vals.map((v, i) => `${i ? "L" : "M"}${pt(v, i, off)}`).join("");
/** Where the drawn price leaves the band: filled diamonds under dips (vault buys), outlined over rallies (vault sells). */
const marks = price.flatMap((v, i) =>
  v < ema[i] - BAND ? [{ i, v, buy: true }] : v > ema[i] + BAND ? [{ i, v, buy: false }] : [],
);
const diamond = (x: number, y: number, r = 7) => `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`;

function Legend({ children, mark }: { children: string; mark: "band" | "buy" | "sell" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={mark === "band" ? 28 : 14} height={14} viewBox={mark === "band" ? "0 0 28 14" : "0 0 14 14"}>
        {mark === "band" ? (
          <line x1={0} x2={28} y1={7} y2={7} stroke={OG.accent} strokeWidth={2} strokeDasharray="4 4" />
        ) : (
          <path d={diamond(7, 7, 6)} fill={mark === "buy" ? OG.accent : "none"} stroke={OG.accent} strokeWidth={mark === "buy" ? 0 : 2} />
        )}
      </svg>
      {children}
    </div>
  );
}

/**
 * Default share card (§3.9), composed like the X banner: lockup, the promise on two lines in the
 * display cut, and a band drawing with vault-agent diamonds on the dark ground.
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: OG.paper,
          padding: "60px 72px 52px",
          fontFamily: "Mona Sans",
        }}
      >
        <OgLockup height={34} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            fontFamily: "Mona Sans Display",
            fontSize: 88,
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
            color: OG.ink,
          }}
        >
          <div style={{ display: "flex" }}>Launches that</div>
          <div style={{ display: "flex" }}>can&rsquo;t be dumped.</div>
        </div>
        <svg width={W} height={H} viewBox={`-8 -8 ${W + 16} ${H + 16}`} style={{ marginTop: "auto" }}>
          <line x1={0} x2={W} y1={H * 0.25} y2={H * 0.25} stroke={OG.line} strokeWidth={1} />
          <line x1={0} x2={W} y1={H * 0.75} y2={H * 0.75} stroke={OG.line} strokeWidth={1} />
          <path
            d={`${pathOf(ema, BAND)}L${[...ema].reverse().map((v, i) => pt(v, ema.length - 1 - i, -BAND)).join("L")}Z`}
            fill={OG.accent}
            fillOpacity={0.08}
          />
          <path d={pathOf(ema, BAND)} fill="none" stroke={OG.accent} strokeOpacity={0.8} strokeWidth={2} strokeDasharray="6 6" />
          <path d={pathOf(ema, -BAND)} fill="none" stroke={OG.accent} strokeOpacity={0.8} strokeWidth={2} strokeDasharray="6 6" />
          <path d={pathOf(ema)} fill="none" stroke={OG.ink3} strokeWidth={2} strokeDasharray="2 6" strokeLinecap="round" />
          <path d={pathOf(price)} fill="none" stroke={OG.ink} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" />
          {marks.map((m) => (
            <path
              key={m.i}
              d={diamond(px(m.i), py(m.v) + (m.buy ? 18 : -18))}
              fill={m.buy ? OG.accent : OG.paper}
              stroke={OG.accent}
              strokeWidth={m.buy ? 0 : 2}
            />
          ))}
        </svg>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            marginTop: 22,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: OG.ink3,
          }}
        >
          <Legend mark="band">Agent band</Legend>
          <Legend mark="buy">Vault buys</Legend>
          <Legend mark="sell">Vault sells</Legend>
          <div style={{ display: "flex", marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: 22 }}>
            Hold fast.
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
