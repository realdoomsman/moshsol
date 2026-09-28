import { countdown, fmtPrice, lamportsToSol } from "@holdfast/sdk";
import { ImageResponse } from "next/og";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { phaseOf } from "@/lib/launch";
import { OG as C, OgLockup } from "@/lib/og-brand";
import { ogFonts } from "@/lib/og-fonts";
import { loadLaunch, parseMint } from "@/lib/server";
import type { LaunchSummary } from "@/lib/types";

export const alt = "Holdfast launch: the first buy is locked in the vault forever";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Formats the OG renderer can decode; anything else falls back to the ticker tile. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];

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

function Label({ children }: { children: string }) {
  return <div style={{ fontSize: 20, fontWeight: 600, color: C.ink3, letterSpacing: 1.6, textTransform: "uppercase" }}>{children}</div>;
}

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 44, fontWeight: 600, color: color ?? C.ink, letterSpacing: -0.5 }}>{value}</div>
    </div>
  );
}

function Chip({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 40,
        padding: "0 16px",
        borderRadius: 6,
        background: bg,
        color: fg,
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: 1.6,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
}

function LiveFooter({ l }: { l: LaunchSummary }) {
  const change = l.change24h;
  return (
    <div style={{ display: "flex", gap: 72 }}>
      <Figure label="Market cap" value={`${fmtSolValue(l.marketCapSol)} SOL`} />
      {change !== null && Number.isFinite(change) ? (
        <Figure
          label="24h"
          value={`${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
          color={change > 0 ? C.up : change < 0 ? C.down : C.ink2}
        />
      ) : null}
      <Figure label="Price" value={fmtPrice(l.priceSol)} />
      <Figure label="Vault" value={`${fmtSolValue(lamportsToSol(l.vaultSol))} SOL + ${fmtTokens(l.vaultTokens)}`} color={C.accentInk} />
    </div>
  );
}

function RaiseFooter({ l, nowSec }: { l: LaunchSummary; nowSec: number }) {
  const raised = lamportsToSol(l.raised);
  const max = lamportsToSol(l.raiseMax);
  const min = lamportsToSol(l.raiseMin);
  const pct = max > 0 ? Math.min(100, (raised / max) * 100) : 0;
  const minPct = max > 0 ? Math.min(100, (min / max) * 100) : 0;
  const minMet = raised >= min;
  const open = l.raiseDeadline > nowSec;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: -1, color: C.ink }}>{fmtSolValue(raised)}</div>
          <div style={{ fontSize: 36, color: C.ink3 }}>{`/ ${fmtSolValue(max)} SOL raised`}</div>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: C.ink2 }}>
          {`${open ? `Closes in ${countdown(l.raiseDeadline, nowSec)}` : "Raise closed"} · ${l.backerCount} backer${l.backerCount === 1 ? "" : "s"}`}
        </div>
      </div>
      <div style={{ display: "flex", position: "relative", height: 16, borderRadius: 4, background: C.sunken, border: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", width: `${pct}%`, height: "100%", borderRadius: 4, background: minMet ? C.accent : C.ink }} />
        <div style={{ display: "flex", position: "absolute", left: `${minPct}%`, top: -6, width: 3, height: 28, background: minMet ? C.accentInk : C.ink3 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: C.ink3 }}>
        <div style={{ display: "flex" }}>{`min ${fmtSolValue(min)} SOL · 100% refundable if it isn't met`}</div>
        <div style={{ display: "flex" }}>{`${l.terms.backerFeeShareBps / 100}% of trading fees to backers`}</div>
      </div>
    </div>
  );
}

/** Share card for a launch (§5.1 #27): live (market cap, vault) or raising (progress, countdown). */
export default async function Image({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const r = parseMint(mint) ? await loadLaunch(mint) : ({ state: "missing" } as const);
  const l = r.state === "found" ? r.launch : null;
  const [fonts, art] = await Promise.all([ogFonts(), imageDataUri(l?.image ?? null)]);
  const nowSec = Math.floor(Date.now() / 1000);
  const phase = l ? phaseOf(l, nowSec) : null;
  const chip =
    phase === "live"
      ? { text: "Live · Locked", bg: C.accentWash, fg: C.accentInk }
      : phase === "raising" || phase === "ready"
        ? BigInt(l!.raised) >= BigInt(l!.raiseMin)
          ? { text: "Min reached", bg: C.accentWash, fg: C.accentInk }
          : { text: "Raising", bg: C.warnWash, fg: C.warn }
        : phase
          ? { text: "Refunding", bg: C.surface, fg: C.ink2 }
          : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          background: C.paper,
          color: C.ink,
          fontFamily: "Mona Sans",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <OgLockup height={34} />
          {chip ? <Chip {...chip} /> : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          {art ? (
            <img src={art} width={152} height={152} style={{ borderRadius: 16, objectFit: "cover", border: `1px solid ${C.line}` }} alt="" />
          ) : (
            <div
              style={{
                width: 152,
                height: 152,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: C.surface,
                border: `1px solid ${C.line}`,
                fontSize: 56,
                fontWeight: 600,
                color: C.ink2,
              }}
            >
              {(l?.symbol ?? "H").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900 }}>
            <div style={{ fontFamily: "Mona Sans Display", fontSize: 76, fontWeight: 600, letterSpacing: -2, lineHeight: 1.02 }}>
              {l ? l.name : "Holdfast"}
            </div>
            <div style={{ fontSize: 36, color: C.ink2 }}>
              {l ? `$${l.symbol}` : "The Solana launchpad where the first buy can never be dumped."}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", paddingTop: 28, borderTop: `1px solid ${C.line}` }}>
          {!l || !phase ? (
            <div style={{ fontSize: 30, color: C.ink2 }}>Launches that can&apos;t be dumped.</div>
          ) : phase === "live" ? (
            <LiveFooter l={l} />
          ) : phase === "raising" || phase === "ready" ? (
            <RaiseFooter l={l} nowSec={nowSec} />
          ) : (
            <div style={{ display: "flex", fontSize: 34, color: C.ink2 }}>
              The raise closed without launching. Every backer can refund 100%.
            </div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
