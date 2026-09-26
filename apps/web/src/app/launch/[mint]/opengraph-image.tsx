import { fmtPrice, lamportsToSol } from "@moshsol/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { loadLaunch, parseMint } from "@/lib/server";
import type { LaunchSummary } from "@/lib/types";

export const alt = "moshsol launch — bundle locked forever";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#f3f5f7";
const MUTED = "#a3a9b5";
const DIM = "#7f8795";
const LIME = "#c6ff3d";
const UP = "#2fe6a7";
const DOWN = "#ff5c7c";
/** Formats the OG renderer can decode; anything else falls back to the symbol monogram. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];

async function font(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans", file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

async function imageDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPES.includes(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 2 * 1024 * 1024) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 22, color: DIM, textTransform: "uppercase", letterSpacing: 2 }}>{label}</div>
      <div style={{ fontSize: 44, fontWeight: 600, color: tone ?? INK }}>{value}</div>
    </div>
  );
}

function stats(l: LaunchSummary): { label: string; value: string; tone?: string }[] {
  if (l.status === "live") {
    const change = l.change24h;
    return [
      { label: "Price", value: `${fmtPrice(l.priceSol)} SOL` },
      { label: "Market cap", value: `${fmtSolValue(l.marketCapSol)} SOL` },
      ...(change !== null && isFinite(change)
        ? [{ label: "24h", value: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`, tone: change >= 0 ? UP : DOWN }]
        : []),
    ];
  }
  if (l.status === "raising") {
    return [
      { label: "Raised", value: `${fmtSolValue(lamportsToSol(l.raised))} / ${fmtSolValue(lamportsToSol(l.raiseMax))} SOL` },
      { label: "Backers", value: String(l.backerCount) },
    ];
  }
  return [{ label: "Status", value: "Refunds open", tone: "#ffc857" }];
}

export default async function Image({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const r = parseMint(mint) ? await loadLaunch(mint) : ({ state: "missing" } as const);
  const [semibold, regular] = await Promise.all([font("Geist-SemiBold.ttf"), font("Geist-Regular.ttf")]);
  const fonts = [
    ...(regular ? [{ name: "Geist", data: regular, weight: 400 as const, style: "normal" as const }] : []),
    ...(semibold ? [{ name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const }] : []),
  ];
  const l = r.state === "found" ? r.launch : null;
  const logo = l ? await imageDataUri(l.image) : null;
  const badge = !l
    ? "Launches that can't be dumped"
    : l.status === "live"
      ? `Bundle locked forever · ${fmtSolValue(lamportsToSol(l.vaultSol))} SOL + ${fmtTokens(l.vaultTokens)} $${l.symbol}`
      : l.status === "raising"
        ? `Bundle ≤ ${l.bundleSupplyBps / 100}% of supply · locked forever at launch`
        : "Raise ended · 100% refunds";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "#060708",
          backgroundImage:
            "radial-gradient(circle at 12% -10%, rgba(157,107,255,0.35), transparent 45%), radial-gradient(circle at 95% 0%, rgba(61,227,255,0.18), transparent 40%), radial-gradient(circle at 60% 120%, rgba(198,255,61,0.12), transparent 45%)",
          fontFamily: fonts.length ? "Geist" : undefined,
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="48" height="48" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="9" fill={LIME} />
              <path d="M10.5 14.5v-3a5.5 5.5 0 0 1 11 0v3" stroke="#060708" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              <rect x="8" y="15" width="16" height="11" rx="3" fill="#060708" />
              <path
                d="M11 22.4l2.1-2.6 2.1 1.8 2.3-3.2 3.5 3.2"
                stroke={LIME}
                strokeWidth="1.7"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -1 }}>
              <span>mosh</span>
              <span style={{ color: LIME }}>sol</span>
            </div>
          </div>
          {l ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                borderRadius: 999,
                border: `1px solid ${l.status === "live" ? "rgba(47,230,167,0.4)" : "rgba(157,107,255,0.45)"}`,
                color: l.status === "live" ? UP : "#c2a6ff",
                fontSize: 24,
                fontWeight: 600,
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 999, background: l.status === "live" ? UP : "#c2a6ff" }} />
              {l.status === "live" ? "Live" : l.status === "raising" ? "Raising" : "Refunding"}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          {logo ? (
            <img src={logo} width={168} height={168} style={{ borderRadius: 36, objectFit: "cover" }} alt="" />
          ) : (
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, rgba(157,107,255,0.8), rgba(61,227,255,0.7))",
                fontSize: 64,
                fontWeight: 600,
              }}
            >
              {(l?.symbol ?? "M").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, maxWidth: 820 }}>
            <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1.02 }}>
              {l ? l.name : "moshsol"}
            </div>
            <div style={{ fontSize: 38, color: MUTED }}>{l ? `$${l.symbol}` : "Solana launchpad"}</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 10,
                padding: "10px 18px",
                borderRadius: 14,
                background: "rgba(198,255,61,0.1)",
                border: "1px solid rgba(198,255,61,0.35)",
                color: LIME,
                fontSize: 24,
                fontWeight: 600,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={LIME} strokeWidth="2.2" strokeLinecap="round">
                <rect x="4" y="11" width="16" height="10" rx="2.5" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              {badge}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 64,
            paddingTop: 28,
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {l ? stats(l).map((s) => <Stat key={s.label} {...s} />) : null}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
