import { LiveEyebrow } from "../shell/live-eyebrow";
import { ButtonLink } from "../ui/button";
import { BandInstrument } from "../band/band-instrument";
import { pctFromBps } from "../band/model";

/**
 * §1 Hero, composed like the brand banner: the promise set full-width in display type on two lines,
 * then the verbatim sub-head, the two CTAs and a spec-sheet of invariants (never volume) beside
 * the live Band instrument.
 */
export function Hero({ backerFeeShareBps }: { backerFeeShareBps: number | null }) {
  const proof = [
    { label: "Mint authority", value: "Revoked" },
    ...(backerFeeShareBps === null ? [] : [{ label: "Backer share of fees", value: pctFromBps(backerFeeShareBps) }]),
    { label: "Backer share of agent profit", value: "100%" },
  ];
  return (
    <section aria-labelledby="hero-title" className="frame-marketing pb-16 pt-10 md:pb-24 md:pt-12">
      <LiveEyebrow />
      <h1 id="hero-title" className="display-xl mt-5 text-ink">
        Backers buy first <br className="hidden sm:block" />
        and share the profit.
      </h1>
      <div className="mt-10 grid grid-cols-1 gap-12 md:mt-12 lg:grid-cols-12 lg:gap-6">
        <div className="flex flex-col lg:col-span-4 lg:pr-4">
          <p className="body-l max-w-[30em] text-ink-2">
            Backers fund the first buy.
            <span className="hidden sm:inline">
              {" "}
              It&rsquo;s held in a vault and traded only by a rate-limited agent — backers get all of its realized profit
              and half of every trading fee.
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
          <dl className="mt-10 border-t border-line lg:mt-auto lg:pt-0">
            {proof.map((p) => (
              <div key={p.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3.5">
                <dt className="label text-ink-3">{p.label}</dt>
                <dd className="ui num text-ink">{p.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:col-span-8">
          <BandInstrument />
        </div>
      </div>
    </section>
  );
}
