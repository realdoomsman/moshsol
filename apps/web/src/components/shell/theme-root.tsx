import type { ReactNode } from "react";
import type { Theme } from "@/lib/theme";

/**
 * Route-group surface: `paper` for (marketing), `night` for (app). `data-theme-root` also themes
 * <html> (see globals.css), so overlays portalled to <body> get the same tokens and the overscroll
 * area matches. Use exactly one per page, in the group layout.
 */
export function ThemeRoot({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div data-theme={theme} data-theme-root={theme} className="flex min-h-dvh flex-col bg-paper text-ink">
      {children}
    </div>
  );
}
