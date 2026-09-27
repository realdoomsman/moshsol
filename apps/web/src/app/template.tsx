import type { ReactNode } from "react";

/**
 * Re-mounts on every navigation, so each page fades in (180ms, CSS only — no JS gate on content).
 * `backwards` fill leaves no transform behind, so fixed-position children still pin to the viewport.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
