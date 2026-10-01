import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";

/** On a 404 Next takes the title from this module, not from the page's `generateMetadata`. */
export const metadata: Metadata = { title: "Profile not found" };

/** Inside the app shell (the root 404 brings its own): the URL segment isn't a Solana wallet address. */
export default function ProfileNotFound() {
  return (
    <div className="max-w-xl py-16 md:py-24">
      <p className="label text-ink-3">404</p>
      <h1 className="display-m mt-3 text-ink">No wallet at this address.</h1>
      <p className="body mt-3 text-ink-2">It isn&apos;t a valid Solana wallet address. Check the link, or search for a wallet or token.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/app" variant="primary" arrow>
          Discover launches
        </ButtonLink>
        <ButtonLink href="/leaderboard" variant="secondary">
          Leaderboard
        </ButtonLink>
      </div>
    </div>
  );
}
