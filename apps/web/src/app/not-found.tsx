import type { Metadata } from "next";
import { NOT_FOUND_FRAME, NotFoundBody } from "@/components/shell/not-found-body";
import { SiteShell } from "@/components/shell/site-shell";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown URLs render outside the route groups, so this brings the shared shell itself. */
export default function NotFound() {
  return (
    <SiteShell mainClassName={NOT_FOUND_FRAME}>
      <NotFoundBody />
    </SiteShell>
  );
}
