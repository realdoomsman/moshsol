import Link from "next/link";
import { StatusBar } from "./status";

/**
 * App footer (#25): a 28px status bar pinned to the bottom of the viewport on desktop — indexer
 * sync, agent heartbeat, network — plus docs/risks links. On mobile the status lives in the "More"
 * sheet (the bottom tab bar owns the bottom edge).
 */
export function AppFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 hidden h-7 border-t border-line bg-paper md:block">
      <div className="frame-app flex h-full items-center justify-between gap-4">
        <StatusBar className="flex-nowrap overflow-hidden" />
        <div className="micro flex shrink-0 items-center gap-4 text-ink-3">
          <Link href="/docs" className="transition-colors hover:text-ink">
            Docs
          </Link>
          <Link href="/docs/risks" className="transition-colors hover:text-ink">
            Risks
          </Link>
          <span>© {new Date().getFullYear()} Holdfast</span>
        </div>
      </div>
    </footer>
  );
}
