"use client";

import { Check, Info, TriangleAlert, X } from "lucide-react";
import { Toaster } from "sonner";
import { useMediaQuery } from "@/lib/hooks";
import { Spinner } from "./spinner";

const icon = "size-4 shrink-0";

/**
 * The app's single toaster (§4.12): `raised`, elevation 2, 360px, 12px radius; icon · title (`ui`)
 * · description (`small ink-2`) · action link. Bottom-right on desktop, top on mobile.
 *
 * Call sonner's `toast` directly. Transactions already toast through `useTx()` (lib/tx.tsx):
 * "Confirm in wallet" → "Sending" → explorer link → success (6 s) or error (stays until closed).
 * Voice: errors say what happened and what to do next; dry wit only in success toasts.
 */
export function AppToaster() {
  const narrow = useMediaQuery("(max-width: 767px)");
  return (
    <Toaster
      position={narrow ? "top-center" : "bottom-right"}
      gap={8}
      // Clears the 28px desktop status bar.
      offset={{ bottom: 44, right: 24 }}
      mobileOffset={16}
      closeButton
      icons={{
        success: <Check className={icon} strokeWidth={1.75} aria-hidden />,
        error: <TriangleAlert className={`${icon} text-warn`} strokeWidth={1.75} aria-hidden />,
        warning: <TriangleAlert className={`${icon} text-warn`} strokeWidth={1.75} aria-hidden />,
        info: <Info className={icon} strokeWidth={1.75} aria-hidden />,
        loading: <Spinner className="text-ink-3" />,
        close: <X className="size-3.5" strokeWidth={1.5} aria-hidden />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group/toast relative flex w-[var(--width)] max-w-[calc(100vw-32px)] items-start gap-3 rounded-md bg-raised p-4 pr-10 text-ink shadow-pop",
          icon: "mt-0.5 flex size-4 shrink-0 items-center justify-center",
          content: "min-w-0 flex-1",
          title: "ui text-ink",
          description: "small mt-0.5 text-ink-2 [overflow-wrap:anywhere]",
          actionButton: "ui ml-auto shrink-0 rounded-sm px-2 text-ink underline decoration-ink-3/60 underline-offset-2",
          cancelButton: "ui shrink-0 rounded-sm px-2 text-ink-2",
          closeButton:
            "absolute top-3 right-3 flex size-6 items-center justify-center rounded-xs text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink",
        },
      }}
    />
  );
}
