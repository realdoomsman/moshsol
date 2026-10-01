import type { PlatformInfo } from "@/lib/types";
import { pumpSplit } from "@/lib/pump-terms";
import { Term } from "../glossary";
import { LiveEyebrow } from "../shell/live-eyebrow";
import { ButtonLink } from "../ui/button";
import { BandInstrument } from "../band/band-instrument";

/**
 * §1 Hero, composed like the brand banner: the one-sentence promise set full-width in display type
 * on two lines, then the plain-English sub-head, the two CTAs (back first, create second) and a
 * spec-sheet of the splits every launch freezes, beside the live Band instrument.
 */
export function Hero({ params }: { params: PlatformInfo["params"] | null }) {
  const s = pumpSplit(params);
  const proof = [
    { label: "Backer share of agent profit", value: `${s.backerPct}%` },
    { label: "Buys and burns Holdfast", value: `${s.burnPct}%` },
    { label: "Creator cut of fees", value: "0%" },
    { label: "Holdfast takes", value: `${s.launchFeePct}% launch fee` },
  ];
  return (
    <section aria-labelledby="hero-title" className="frame-marketing pb-16 pt-10 md:pb-24 md:pt-12">
      <LiveEyebrow />
      <h1 id="hero-title" className="display-xl mt-5 text-ink">
        Back a token before <br className="hidden sm:block" />
        it hits pump.fun.
      </h1>
      <div className="mt-10 grid grid-cols-1 gap-12 md:mt-12 lg:grid-cols-12 lg:gap-6">
        <div className="flex flex-col lg:col-span-4 lg:pr-4">
          <p className="body-l max-w-[30em] text-ink-2">
            Your SOL makes the first buy. A <Term k="vaultAgent" split={s}>vault agent</Term> trades it; you keep {s.backerPct}% of the
            profit.
          </p>
          <div className="mt-8 grid gap-3 sm:flex">
            <ButtonLink href="/app" variant="accent" size="lg">
              Back a launch
            </ButtonLink>
            <ButtonLink href="/create" variant="secondary" size="lg">
              Launch a token
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
