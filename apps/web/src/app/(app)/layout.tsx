import type { Viewport } from "next";
import type { ReactNode } from "react";
import { AppFooter } from "@/components/shell/app-footer";
import { AppHeader } from "@/components/shell/app-header";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { ThemeRoot } from "@/components/shell/theme-root";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, healthQuery } from "@/lib/query-options";
import { THEME_COLOR } from "@/lib/theme";

export const viewport: Viewport = { themeColor: THEME_COLOR.night };

/** Status dots are shell chrome: never hold the page for them longer than this. */
const STATUS_DEADLINE_MS = 600;

/** Night app shell (§4.3): top bar, content frame, desktop status bar, mobile bottom tabs. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, healthQuery(), STATUS_DEADLINE_MS),
    prefetch(client, agentStatusQuery(), STATUS_DEADLINE_MS),
  ]);
  return (
    <ThemeRoot theme="night">
      <Hydrate client={client}>
        <AppHeader />
        <main className="frame-app flex-1 pt-6 pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-16">{children}</main>
        <AppFooter />
        <MobileTabs />
      </Hydrate>
    </ThemeRoot>
  );
}
