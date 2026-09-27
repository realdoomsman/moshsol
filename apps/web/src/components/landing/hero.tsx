import { LiveEyebrow } from "../shell/live-eyebrow";
import { ButtonLink } from "../ui/button";
import { BandInstrument } from "../band/band-instrument";
import { pctFromBps } from "../band/model";

/**
 * §1 Hero: the promise (H1 + the verbatim sub-head), the two CTAs, a proof row of invariants (never
 * volume), and the live Band instrument on the right.
 */
export function Hero({ withdrawInstructions, backerFeeShareBps }: { withdrawInstructions: number; backerFeeShareBps: number | null }) {
  const proof = [
    { label: "Withdraw instructions", value: String(withdrawInstructions) },
    { label: "Mint authority", value: "Revoked" },
    ...(backerFeeShareBps === null ? [] : [{ label: "Backer share of fees", value: pctFromBps(backerFeeShareBps) }]),
  ];
  return (
    <section aria-labelledby="hero-title" className="frame-marketing pb-12 pt-10 md:pb-16 md:pt-20">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-5 lg:pt-6">
          <LiveEyebrow />
          <h1 id="hero-title" className="display-xl mt-5 text-ink">
            Launches that can&rsquo;t be dumped.
          </h1>
          <p className="body-l mt-6 max-w-[34em] text-ink-2">
            Backers fund the first buy.
            <span className="hidden sm:inline">
              {" "}
              It&rsquo;s locked in a vault forever, traded only by a rate-limited agent — and backers earn half of every
              trading fee.
            </span>
          </p>
          <div className="mt-8 grid gap-3 sm:flex">
            <ButtonLink href="/create" variant="accent" size="lg">
              Launch a token
            </ButtonLink>
            <ButtonLink href="/app" variant="secondary" size="lg">
              Explore launches
            </ButtonLink>
          </div>
          <dl className="mt-10 grid border-t border-line sm:grid-cols-3">
            {proof.map((p) => (
              <div
                key={p.label}
                className="flex items-baseline justify-between gap-4 border-b border-line py-3 sm:block sm:border-b-0 sm:py-5 sm:pr-4"
              >
                <dt className="label text-ink-3">{p.label}</dt>
                <dd className="num-l text-ink sm:mt-2">{p.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:col-span-7">
          <BandInstrument />
        </div>
      </div>
    </section>
  );
}
