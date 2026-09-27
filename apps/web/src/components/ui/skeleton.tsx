import { cn } from "./cn";

/**
 * Static `sunken` block shaped like the content it stands in for (§4.12). No shimmer. It appears
 * only after 300 ms so fast loads never flash it; pass `immediate` for SSR `loading.tsx` shells.
 */
export function Skeleton({ className, immediate }: { className?: string; immediate?: boolean }) {
  return <div aria-hidden className={cn("rounded-sm bg-sunken", !immediate && "animate-appear", className)} />;
}
