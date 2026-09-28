import type { ReactNode } from "react";
import { cn } from "../ui/cn";
import { MobileTabs } from "./mobile-tabs";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * The page chrome every route shares (landing, docs, app, 404): top bar, content, footer + live
 * status strip, and the mobile bottom tab bar. Only the `<main>` framing differs per route group.
 * Below 768px the wrapper reserves the tab bar's height so the footer never hides under it.
 */
export function SiteShell({ mainClassName, children }: { mainClassName?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
      <SiteHeader />
      <main className={cn("flex-1", mainClassName)}>{children}</main>
      <SiteFooter />
      <MobileTabs />
    </div>
  );
}
