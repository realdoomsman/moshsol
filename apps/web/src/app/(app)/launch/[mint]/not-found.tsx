"use client";

import { shortAddr } from "@holdfast/sdk";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";

/** Inside the app shell: the mint in the URL isn't a Holdfast launch on this cluster. */
export default function LaunchNotFound() {
  const { mint } = useParams<{ mint: string }>();
  const label = mint ? decodeURIComponent(mint) : "";
  return (
    <div className="max-w-xl py-16 md:py-24">
      <p className="label text-ink-3">404</p>
      <h1 className="display-m mt-3 text-ink">No launch at this address.</h1>
      {label ? <p className="mono mt-4 truncate text-ink-2">{label.length > 48 ? shortAddr(label, 10) : label}</p> : null}
      <p className="body mt-3 text-ink-2">It isn&apos;t a Holdfast launch mint on this cluster. Check the link, or find the token on Discover.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/app" variant="primary" arrow>
          Discover launches
        </ButtonLink>
        <ButtonLink href="/create" variant="secondary">
          Create one
        </ButtonLink>
      </div>
    </div>
  );
}
