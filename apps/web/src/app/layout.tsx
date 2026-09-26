import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ActivityTicker } from "@/components/shell/activity-ticker";
import { Footer } from "@/components/shell/footer";
import { Header } from "@/components/shell/header";
import { SITE_URL } from "@/lib/env";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { activityQuery } from "@/lib/query-options";
import "./globals.css";
import { Providers } from "./providers";

const description =
  "Solana memecoin launchpad where the backer-funded bundle is locked forever in an on-chain vault and traded only by rate-limited agents. Backers earn the trading fees.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "moshsol — launches that can't be dumped", template: "%s · moshsol" },
  description,
  applicationName: "moshsol",
  openGraph: { siteName: "moshsol", type: "website", title: "moshsol — launches that can't be dumped", description },
};

export const viewport: Viewport = {
  themeColor: "#060708",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Renders alongside the page (both prefetch concurrently), so the ticker's first paint shows events. */
async function PrefetchedTicker() {
  const client = serverQueryClient();
  await prefetch(client, activityQuery());
  return (
    <Hydrate client={client}>
      <ActivityTicker />
    </Hydrate>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders live indexer data per request (never prerendered at build time).
  await connection();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="app-bg" aria-hidden />
        <Providers now={Math.floor(Date.now() / 1000)}>
          <Header />
          <PrefetchedTicker />
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
