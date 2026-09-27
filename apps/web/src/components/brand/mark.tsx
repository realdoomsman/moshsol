import { cn } from "../ui/cn";

/** Clamp jaws on the 32-unit grid (§3.3). Square corners — rounded jaws read as a checkbox. */
export const JAW_LEFT = "M3 3h10v5H8v16h5v5H3z";
export const JAW_RIGHT = "M29 3H19v5h5v16h-5v5h10z";

export type MarkAnimation = "none" | "clamp" | "loop";

/**
 * The Clamp: two jaws (currentColor) gripping the accent coin. `size` is the 32-unit box in px
 * (minimum 16). `animate="clamp"` plays the lock once on mount — remount (change `key`) to replay;
 * `"loop"` is for loaders only (see `ClampLoader`). Decorative unless `title` is given.
 */
export function Mark({
  size = 26,
  animate = "none",
  title,
  className,
}: {
  size?: number;
  animate?: MarkAnimation;
  title?: string;
  className?: string;
}) {
  const animated = animate !== "none";
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", animate === "clamp" && "clamp-once", animate === "loop" && "clamp-loop", className)}
    >
      <path className="clamp-jaw-l" d={JAW_LEFT} fill="currentColor" />
      <path className="clamp-jaw-r" d={JAW_RIGHT} fill="currentColor" />
      <circle className="clamp-coin" cx="16" cy="16" r="5.5" fill="var(--color-accent)" />
      {animated ? (
        <circle className="clamp-ring" cx="16" cy="16" r="5.5" fill="none" stroke="var(--color-accent)" strokeWidth="1" />
      ) : null}
    </svg>
  );
}
