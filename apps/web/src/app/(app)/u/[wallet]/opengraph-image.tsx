import { shortAddr } from "@holdfast/sdk";
import { ImageResponse } from "next/og";
import { JAW_LEFT, JAW_RIGHT } from "@/components/brand/mark";
import { fmtSolValue } from "@/lib/format";
import { ogFonts } from "@/lib/og-fonts";
import { parseMint } from "@/lib/server";
import { usersApi, type UserProfile } from "@/lib/users";

export const alt = "Holdfast profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Night tokens from app/globals.css (§3.4). The OG renderer can't read CSS variables, so the
 * literals are repeated here.
 */
const C = {
  paper: "#0f100e",
  surface: "#161714",
  ink: "#f2f1ec",
  ink2: "#a9a89f",
  ink3: "#85857c",
  line: "#2a2b27",
  accent: "#ff5b1a",
  accentInk: "#ff7a45",
};

/** Formats the OG renderer can decode. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif"];

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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, paddingLeft: 28, borderLeft: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 18, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 600, color: accent ? C.accentInk : C.ink, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ wallet: string }> }) {
  const key = parseMint(decodeURIComponent((await params).wallet));
  const wallet = key?.toBase58() ?? null;
  const user: UserProfile | null = wallet ? await usersApi.user(wallet).catch(() => null) : null;
  const avatar = await imageDataUri(user?.avatar ?? null);
  const name = user?.name ?? (wallet ? shortAddr(wallet) : "Unknown wallet");
  const s = user?.stats;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: C.paper,
        color: C.ink,
        fontFamily: "Mona Sans",
        padding: 72,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg width="44" height="44" viewBox="0 0 32 32">
          <path d={JAW_LEFT} fill={C.ink} />
          <path d={JAW_RIGHT} fill={C.ink} />
          <circle cx="16" cy="16" r="5.5" fill={C.accent} />
        </svg>
        <div style={{ fontFamily: "Mona Sans Display", fontWeight: 600, fontSize: 36, letterSpacing: "-0.02em" }}>holdfast</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} width={168} height={168} style={{ borderRadius: 84, objectFit: "cover" }} alt="" />
        ) : (
          <div
            style={{
              width: 168,
              height: 168,
              borderRadius: 84,
              background: C.surface,
              border: `1px solid ${C.line}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "JetBrains Mono",
              fontSize: 52,
              color: C.ink2,
            }}
          >
            {(wallet ?? "??").slice(0, 2)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
          <div style={{ fontFamily: "Mona Sans Display", fontWeight: 600, fontSize: 76, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {name}
          </div>
          {wallet && user?.name ? <div style={{ fontFamily: "JetBrains Mono", fontSize: 26, color: C.ink3 }}>{shortAddr(wallet, 6)}</div> : null}
          {user?.bio ? <div style={{ fontSize: 28, color: C.ink2, lineHeight: 1.3 }}>{user.bio}</div> : null}
        </div>
      </div>

      {s ? (
        <div style={{ display: "flex", gap: 28 }}>
          <Stat label="Launches created" value={String(s.launchesCreated)} />
          <Stat label="Backed" value={String(s.backedLaunches)} />
          <Stat label="Backer fees earned" value={`${fmtSolValue(s.backerFeesEarnedSol)} SOL`} accent={s.backerFeesEarnedSol > 0} />
          <Stat label="Volume" value={`${fmtSolValue(s.volumeSol)} SOL`} />
        </div>
      ) : (
        <div style={{ fontSize: 28, color: C.ink2 }}>The Solana launchpad where the first buy can never be dumped.</div>
      )}
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
