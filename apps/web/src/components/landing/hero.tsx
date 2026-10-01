import Link from "next/link";
import { CLUSTER_NAME } from "@/lib/env";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { Term } from "../glossary";
import { LiveEyebrow } from "../shell/live-eyebrow";
import { ButtonLink } from "../ui/button";
import { HeroLaunches } from "./live-launches";
import { VideoSlot } from "./video-slot";

/**
 * §1 Hero, composed like the brand banner: the promise set full-width in display type on two lines,
 * then three plain sentences on the mechanism (bundle, vault agent, payback), the two CTAs (back
 * first, create second) and the spec sheet every pump launch freezes, beside the launch recording
 * (or, until it exists, what is live on the cluster).
 */
export function Hero({ params }: { params: PlatformInfo["params"] | null }) {
  const s = pumpSplit(params);
  const spec = [
    { label: "Creator fee split", value: `${s.vaultPct}% vault · ${s.burnPct}% burn · ${s.backerPct}% backers` },
    { label: "Backer payback", value: `${fmtMult(s.payoutMult)}, then ${s.payoutSharePct}% per ${fmtInterval(s.payoutIntervalHours)}` },
    { label: "Creator cut of fees", value: "0%" },
    { label: "Holdfast takes", value: `${s.launchFeePct}% launch fee + create fee` },
  ];
  return (
    <section aria-labelledby="hero-title" className="frame-marketing pb-16 pt-10 md:pb-24 md:pt-12">
      <LiveEyebrow />
      <h1 id="hero-title" className="display-xl mt-5 text-ink">
        Back a token before <br className="hidden sm:block" />
        it hits pump.fun.
      </h1>
      <div className="mt-10 grid grid-cols-1 gap-12 md:mt-12 lg:grid-cols-12 lg:gap-6">
        <div className="flex flex-col lg:col-span-5 lg:pr-4">
          <p className="body-l max-w-[34em] text-ink-2">
            Your SOL makes the first buy, the <Term k="bundle" split={s} />, in the same instruction that creates the token on pump.fun.
            A <Term k="vaultAgent" split={s} /> holds it: it sells slowly when the chart is strong and buys back when it dips, growing
            the <Term k="vault" split={s} />. When the vault reaches {fmtMult(s.payoutMult)} its start and the chart is strong, backers
            get <Term k="payback" split={s}>paid back</Term>.{" "}
            <Link href="/docs/how-it-works" className="text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink">
              How it works ›
            </Link>
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
            {spec.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3.5">
                <dt className="label text-ink-3">{row.label}</dt>
                <dd className="ui num text-right text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:col-span-7">
          <VideoSlot
            name="launch-in-a-minute"
            label="A launch in a minute: backers fund the raise, the token is created on pump.fun with the bundle as its first buy, and the vault agent starts trading it."
            fallback={<HeroLaunches />}
            fallbackCaption={`Live from ${CLUSTER_NAME} · open raises and live launches`}
          />
        </div>
      </div>
    </section>
  );
}
