import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { NotFoundAddress } from "./not-found-address";

/** A 404 takes its metadata from this file, not from the page's `generateMetadata`. */
export const metadata: Metadata = { title: "Launch not found" };

/** Inside the app shell: the mint in the URL isn't a Holdfast launch on this cluster. */
export default function LaunchNotFound() {
  return (
    <div className="max-w-xl py-16 md:py-24">
      <p className="label text-ink-3">404</p>
      <h1 className="display-m mt-3 text-ink">No launch at this address.</h1>
      <NotFoundAddress />
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
