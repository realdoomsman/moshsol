import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Mona_Sans } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/env";
import { DEFAULT_PUMP_SPLIT, fmtMult } from "@/lib/pump-terms";
import { THEME_COLOR } from "@/lib/theme";
import "./globals.css";
import { Providers } from "./providers";

const sans = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-mona", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });

const title = "Holdfast — back a token before it launches; a vault agent holds the first buy";
const description = `The Solana launchpad where backers fund a token's first buy on pump.fun. It's held in a vault and traded only by a rate-limited vault agent that sells slowly into strength and buys back dips. When the vault is ${fmtMult(DEFAULT_PUMP_SPLIT.payoutMult)} its start and the chart is strong, backers get paid back.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: "%s · Holdfast" },
  description,
  applicationName: "Holdfast",
  openGraph: { siteName: "Holdfast", type: "website", title, description },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
};

/** Header, footer and page framing come from the route group layouts (all through `SiteShell`). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders live indexer data per request (never prerendered at build time).
  await connection();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers now={Math.floor(Date.now() / 1000)}>{children}</Providers>
      </body>
    </html>
  );
}
