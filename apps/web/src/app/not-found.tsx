import type { Metadata } from "next";
import { Mark } from "@/components/brand/mark";
import { SiteShell } from "@/components/shell/site-shell";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown URLs render outside the route groups, so this brings the shared shell itself. */
export default function NotFound() {
  return (
    <SiteShell mainClassName="frame-marketing grid content-center py-24 md:py-32">
      <div className="max-w-2xl">
        <Mark size={40} className="text-ink" />
        <p className="label mt-10 text-ink-3">Error 404</p>
        <h1 className="display-l mt-4 text-ink">This page doesn&rsquo;t exist.</h1>
        <p className="body-l mt-5 max-w-[34em] text-ink-2">The link may be broken, or the page may have moved.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/app" variant="primary" size="lg" arrow>
            Discover launches
          </ButtonLink>
          <ButtonLink href="/" variant="secondary" size="lg">
            Home
          </ButtonLink>
        </div>
      </div>
    </SiteShell>
  );
}
