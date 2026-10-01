import { Mark } from "../brand/mark";
import { ButtonLink } from "../ui/button";

/** Main-area framing for a 404 body, shared by the root not-found (via `SiteShell`) and in-shell ones. */
export const NOT_FOUND_FRAME = "frame-marketing grid content-center py-24 md:py-32";

/**
 * The 404 body: mark, heading, hint and two ways out. The root `not-found` wraps it in `SiteShell`;
 * a `not-found` inside a route group renders it bare, because that group's layout already brings the shell.
 */
export function NotFoundBody({
  title = "This page doesn’t exist.",
  primary = { href: "/app", label: "Discover launches" },
}: {
  title?: string;
  primary?: { href: string; label: string };
}) {
  return (
    <div className="max-w-2xl">
      <Mark size={40} className="text-ink" />
      <p className="label mt-10 text-ink-3">Error 404</p>
      <h1 className="display-l mt-4 text-ink">{title}</h1>
      <p className="body-l mt-5 max-w-[34em] text-ink-2">The link may be broken, or the page may have moved.</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href={primary.href} variant="primary" size="lg" arrow>
          {primary.label}
        </ButtonLink>
        <ButtonLink href="/" variant="secondary" size="lg">
          Home
        </ButtonLink>
      </div>
    </div>
  );
}
