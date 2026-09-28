/** Primary navigation, in header order (§4.3). One list for every route: landing, docs and app. */
export const NAV = [
  { href: "/app", label: "Discover" },
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/agents", label: "Agents" },
  { href: "/docs", label: "Docs" },
] as const;

/** Token pages belong to Discover. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app" || pathname.startsWith("/app/") || pathname.startsWith("/launch/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
