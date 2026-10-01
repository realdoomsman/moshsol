import { shortAddr } from "@holdfast/sdk";
import { ImageResponse } from "next/og";
import { fmtSolValue } from "@/lib/format";
import { OG as C, OgLockup } from "@/lib/og-brand";
import { ogFonts } from "@/lib/og-fonts";
import { imageDataUri } from "@/lib/og-image";
import { parseMint } from "@/lib/server";
import { usersApi, type UserProfile } from "@/lib/users";

export const alt = "Holdfast profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Formats the OG renderer can decode. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif"];

/** Same figure style as the launch card's footer: label over a 44px value. */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: C.ink3, letterSpacing: 1.6, textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {label}
      </div>
      <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -0.5, color: accent ? C.accentInk : C.ink, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ wallet: string }> }) {
  const key = parseMint(decodeURIComponent((await params).wallet));
  const wallet = key?.toBase58() ?? null;
  const user: UserProfile | null = wallet ? await usersApi.user(wallet).catch(() => null) : null;
  const avatar = await imageDataUri(user?.avatar ?? null, IMAGE_TYPES);
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
        padding: "56px 64px",
      }}
    >
      <OgLockup height={34} />

      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} width={152} height={152} style={{ borderRadius: 76, objectFit: "cover", border: `1px solid ${C.line}` }} alt="" />
        ) : (
          <div
            style={{
              width: 152,
              height: 152,
              borderRadius: 76,
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

      <div style={{ display: "flex", gap: 64, paddingTop: 28, borderTop: `1px solid ${C.line}` }}>
        {s ? (
          <>
            <Stat label="Launches created" value={String(s.launchesCreated)} />
            <Stat label="Backed" value={String(s.backedLaunches)} />
            <Stat label="Backer fees earned" value={`${fmtSolValue(s.backerFeesEarnedSol)} SOL`} accent={s.backerFeesEarnedSol > 0} />
            <Stat label="Volume" value={`${fmtSolValue(s.volumeSol)} SOL`} />
          </>
        ) : (
          <div style={{ display: "flex", fontSize: 30, color: C.ink2 }}>Back a token before it launches. A vault agent holds the first buy.</div>
        )}
      </div>
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
