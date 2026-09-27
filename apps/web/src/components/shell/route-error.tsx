"use client";

import { Button, ButtonLink } from "../ui/button";

/** Error boundary body for every route group: what happened, that funds are unaffected, and next steps. */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto grid max-w-xl gap-4 py-24 text-center">
      <h1 className="display-m text-ink">This page hit an error.</h1>
      <p className="body text-ink-2">
        Nothing on-chain is affected: vaults stay locked and your funds are where you left them. Try again, or head back to
        the launches.
      </p>
      {error.digest ? <p className="mono text-ink-3">ref {error.digest}</p> : null}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/app" variant="secondary">
          Back to launches
        </ButtonLink>
      </div>
    </section>
  );
}
