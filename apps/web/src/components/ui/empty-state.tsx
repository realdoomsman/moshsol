import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";

/**
 * Empty state (§4.12): one sentence plus at most one action — no illustration, no icon tile.
 * Say what's empty and what to do: "No trades yet. Be the first." Dry wit is allowed here (and
 * only here): "Nothing to claim yet. The vault is patient."
 */
export function EmptyState({
  children,
  action,
  align = "center",
  className,
}: {
  children: ReactNode;
  /** A link or button, e.g. `<Link href="/create">Start one →</Link>` or `<ButtonLink size="sm">`. */
  action?: ReactNode;
  align?: "center" | "start";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "body flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-10 text-ink-2",
        align === "center" ? "justify-center text-center" : "justify-start",
        className,
      )}
    >
      <p className="max-w-[68ch] text-pretty">{children}</p>
      {action}
    </div>
  );
}

/**
 * Inline load failure inside a panel (§4.12): `warn` left border, what happened, and Retry.
 * e.g. `<ErrorState onRetry={refetch}>Couldn't load trades. Indexer unreachable.</ErrorState>`
 */
export function ErrorState({
  children,
  onRetry,
  retrying,
  className,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "small flex flex-wrap items-center justify-between gap-3 border-l-2 border-warn bg-warn-wash/40 py-3 pr-3 pl-4 text-ink",
        className,
      )}
    >
      <p className="text-pretty">{children}</p>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} busy={retrying}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
