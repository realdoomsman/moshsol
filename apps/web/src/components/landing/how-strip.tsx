import Link from "next/link";
import { pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { Term } from "../glossary";

/**
 * §2 How it works in three beats (Back → Launch on pump.fun → Earn) for someone who knows pump.fun
 * and nothing else: one sentence each, every number from the platform's frozen split.
 */
export function HowStrip({ params }: { params: PlatformInfo["params"] | null }) {
  const s = pumpSplit(params);
  const steps = [
    {
      title: "Back",
      body: <>Put SOL into a raise before the token exists. If the raise misses its minimum, you get 100% back.</>,
    },
    {
      title: "Launch on pump.fun",
      body: (
        <>
          The pooled SOL, minus the {s.launchFeePct}% launch fee, creates the token and makes its first buy, the{" "}
          <Term k="bundle" split={s} />, before anyone else can trade. Those tokens go into a <Term k="vault" split={s} />.
        </>
      ),
    },
    {
      title: "Earn",
      body: (
        <>
          A rate-limited <Term k="vaultAgent" split={s} /> sells into rallies above cost and buys back dips. You get {s.backerPct}% of
          its realized profit; {s.burnPct}% buys and burns the Holdfast token.
        </>
      ),
    },
  ];
  return (
    <section aria-labelledby="how-strip-title" className="border-t border-line">
      <div className="frame-marketing py-10 md:py-14">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="how-strip-title" className="label text-ink-3">
            How it works
          </h2>
          <Link href="/docs/how-it-works" className="ui text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink">
            The 2-minute version, with numbers ›
          </Link>
        </div>
        <ol className="mt-5 grid gap-8 md:grid-cols-3 md:gap-6">
          {steps.map((st, i) => (
            <li key={st.title} className="border-t border-line pt-4">
              <div className="flex items-baseline gap-3">
                <span aria-hidden className="num-l text-ink-3">
                  {i + 1}
                </span>
                <h3 className="h3 text-ink">{st.title}</h3>
              </div>
              <p className="body mt-2 max-w-[36em] text-ink-2">{st.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
