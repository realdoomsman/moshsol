import type { Metadata } from "next";
import { MarketingFooter } from "@/components/shell/marketing-footer";
import { MarketingHeader } from "@/components/shell/marketing-header";
import { ThemeRoot } from "@/components/shell/theme-root";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown URLs render outside the route groups, so this brings its own Paper shell. */
export default function NotFound() {
  return (
    <ThemeRoot theme="paper">
      <MarketingHeader />
      <main className="frame-marketing flex-1 py-24 md:py-32">
        <div className="max-w-xl">
          <p className="label text-ink-3">404</p>
          <h1 className="display-m mt-3 text-ink">This page doesn&rsquo;t exist.</h1>
          <p className="body mt-4 text-ink-2">The link may be broken, or the page may have moved.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/app" variant="primary" arrow>
              Open app
            </ButtonLink>
            <ButtonLink href="/" variant="secondary">
              Home
            </ButtonLink>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </ThemeRoot>
  );
}
