import { LiveEyebrow } from "@/components/shell/live-eyebrow";
import { ButtonLink } from "@/components/ui/button";

/** Minimal landing until the full §4.2 page lands: the promise, the sub-head and the way in. */
export default function LandingPage() {
  return (
    <section className="frame-marketing py-18 md:py-32">
      <div className="max-w-[760px]">
        <LiveEyebrow />
        <h1 className="display-xl mt-5 text-ink">Launches that can&rsquo;t be dumped.</h1>
        <p className="body-l mt-6 max-w-[36em] text-ink-2">
          Backers fund the first buy. It&rsquo;s locked in a vault forever, traded only by a rate-limited agent — and backers
          earn half of every trading fee.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/create" variant="accent" size="lg">
            Launch a token
          </ButtonLink>
          <ButtonLink href="/app" variant="secondary" size="lg" arrow>
            Open app
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
