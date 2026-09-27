import { Loader2 } from "lucide-react";
import { cn } from "./cn";

/** 16px busy indicator for buttons and inline "working" states (only while something is in flight). */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <Loader2
      className={cn("size-4 shrink-0 animate-spin", className)}
      strokeWidth={1.5}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
