"use client";

import { shortAddr } from "@moshsol/sdk";
import { Rocket } from "lucide-react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { NotFoundPanel } from "@/components/ui/not-found-panel";

export default function LaunchNotFound() {
  const { mint } = useParams<{ mint: string }>();
  const label = mint ? decodeURIComponent(mint) : "";
  return (
    <NotFoundPanel
      art="vault"
      title="No launch at this address"
      actions={
        <>
          <ButtonLink href="/" variant="primary" size="lg">
            Explore launches
          </ButtonLink>
          <ButtonLink href="/create" variant="secondary" size="lg">
            <Rocket className="size-4" aria-hidden /> Create one
          </ButtonLink>
        </>
      }
    >
      {label ? (
        <span className="mb-2 inline-block max-w-full truncate rounded-lg border border-line bg-black/30 px-2.5 py-1 font-mono text-xs text-muted">
          {label.length > 48 ? shortAddr(label, 10) : label}
        </span>
      ) : null}
      <span className="block">
        That isn&apos;t a moshsol launch mint on this cluster. Double-check the link, or find it on the explore page.
      </span>
    </NotFoundPanel>
  );
}
