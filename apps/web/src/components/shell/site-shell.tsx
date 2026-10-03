import type { ReactNode } from "react";
import { NoLaunchNotice } from "../official/no-launch-notice";
import { cn } from "../ui/cn";
import { MobileTabs } from "./mobile-tabs";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * The page chrome every route shares (landing, docs, app, 404): top bar, content, footer + live
 * status strip, and the mobile bottom tab bar. Only the `<main>` framing differs per route group.
 * Below 768px the wrapper reserves the tab bar's height so the footer never hides under it.
 * The first tab stop is a skip link past the header to `#main`.
 */
export function SiteShell({ mainClassName, children }: { mainClassName?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="ui sr-only rounded-sm bg-raised px-3 py-2 text-ink focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[70]"
      >
        Skip to content
      </a>
      <SiteHeader />
      <NoLaunchNotice />
      <main id="main" tabIndex={-1} className={cn("flex-1 outline-none", mainClassName)}>
        {children}
      </main>
      <SiteFooter />
      <MobileTabs />
    </div>
  );
}
