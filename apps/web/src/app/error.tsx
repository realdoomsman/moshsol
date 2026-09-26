"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { NotFoundPanel } from "@/components/ui/not-found-panel";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <NotFoundPanel
      code="error"
      icon={<AlertTriangle className="size-6 text-warn" aria-hidden />}
      title="Something broke on this page"
      actions={
        <>
          <Button variant="primary" size="lg" icon={<RotateCcw className="size-4" aria-hidden />} onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary" size="lg">
            Back to explore
          </ButtonLink>
        </>
      }
    >
      Nothing on-chain is affected — vaults stay locked and your funds are where you left them.
      {error.digest ? <span className="mt-2 block font-mono text-xs text-dim">ref {error.digest}</span> : null}
    </NotFoundPanel>
  );
}
