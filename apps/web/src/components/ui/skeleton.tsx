import { cn } from "./cn";

/**
 * Static `raised` block shaped like the content it stands in for (§4.12): one step up from the
 * ground, so it reads on the page and inside panels alike. No shimmer. It appears only after 300 ms
 * so fast loads never flash it; pass `immediate` for SSR `loading.tsx` shells.
 */
export function Skeleton({ className, immediate }: { className?: string; immediate?: boolean }) {
  return <div aria-hidden className={cn("rounded-sm bg-raised", !immediate && "animate-appear", className)} />;
}
