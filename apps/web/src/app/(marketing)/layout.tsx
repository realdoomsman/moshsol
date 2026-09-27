import type { Viewport } from "next";
import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/shell/marketing-footer";
import { MarketingHeader } from "@/components/shell/marketing-header";
import { ThemeRoot } from "@/components/shell/theme-root";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { agentStatusQuery, healthQuery } from "@/lib/query-options";
import { THEME_COLOR } from "@/lib/theme";

export const viewport: Viewport = { themeColor: THEME_COLOR.paper };

/** Status dots are chrome: never hold the page for them longer than this. */
const STATUS_DEADLINE_MS = 600;

/** Paper surface (§4.2): sticky marketing header, page, footer with the live status bar. */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const client = serverQueryClient();
  await Promise.all([
    prefetch(client, healthQuery(), STATUS_DEADLINE_MS),
    prefetch(client, agentStatusQuery(), STATUS_DEADLINE_MS),
  ]);
  return (
    <ThemeRoot theme="paper">
      <Hydrate client={client}>
        <MarketingHeader />
        <main className="flex-1">{children}</main>
        <MarketingFooter />
      </Hydrate>
    </ThemeRoot>
  );
}
