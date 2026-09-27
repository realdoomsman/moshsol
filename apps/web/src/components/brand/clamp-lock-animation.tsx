"use client";

import { useEffect, useState } from "react";
import { cn } from "../ui/cn";
import { Mark } from "./mark";

/**
 * Launch moment / deposit success (§3.3, §3.8.5): the jaws shut on the coin once, then one ring
 * pulse (960 ms). Plays on mount and again every time `playKey` changes — pass e.g. the launch
 * status so the clamp closes when a `launch` message flips it to live. Reduced motion shows the
 * closed mark.
 */
export function ClampLock({
  playKey,
  size = 40,
  title,
  className,
}: {
  playKey?: string | number;
  size?: number;
  title?: string;
  className?: string;
}) {
  return <Mark key={playKey} size={size} animate="clamp" title={title} className={className} />;
}

/**
 * Page/route loader: the looping clamp, shown only once loading has taken longer than `delayMs`
 * (400 ms per §3.3) so fast loads never flash it. Announces `label` to screen readers.
 */
export function ClampLoader({
  label = "Loading",
  size = 32,
  delayMs = 400,
  className,
}: {
  label?: string;
  size?: number;
  delayMs?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);
  return (
    <div role="status" aria-live="polite" className={cn("inline-flex items-center justify-center text-ink", className)}>
      {visible ? <Mark size={size} animate="loop" /> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}
