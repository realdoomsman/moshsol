"use client";

import { usePathname } from "next/navigation";

const PAGES = ["launch", "create", "portfolio", "agents", "how-it-works"] as const;

/** Page-level backdrop: drifting grid, breathing radial accents tinted per section, film grain. */
export function AppBackground() {
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const page =
    segment === "" ? "home" : (PAGES as readonly string[]).includes(segment) ? (segment === "how-it-works" ? "how" : segment) : "other";
  return (
    <div className="app-bg" data-page={page} aria-hidden>
      <div className="app-bg-glow" />
      <div className="app-bg-grid" />
    </div>
  );
}
