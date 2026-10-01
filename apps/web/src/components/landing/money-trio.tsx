import Link from "next/link";
import { fmtLamports } from "@/lib/format";
import { pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { Term } from "../glossary";

/**
 * §7 Where the money goes, per party: the exact splits a pump launch freezes at creation, one card
 * each for backers, creators and the Holdfast token, each linking to its guide.
 */
export function MoneyTrio({ params }: { params: PlatformInfo["params"] | null }) {
  const s = pumpSplit(params);
  const createFee = params ? `${fmtLamports(params.createFeeLamports)} SOL` : "a small";
  const cards = [
    {
      id: "backers",
      title: "For backers",
      lines: [
        <>
          {s.backerPct}% of the <Term k="vaultAgent" split={s} />
          &rsquo;s realized profit, split by deposit (<Term k="backerEarnings" split={s} />). Claim any time.
        </>,
        <>100% of your SOL back if the raise misses its minimum or the creator cancels.</>,
        <>
          The vault&rsquo;s SOL back if the coin dies and anyone runs the <Term k="windDown" split={s} />.
        </>,
      ],
      href: "/docs/for-backers",
      more: "For backers",
    },
    {
      id: "creators",
      title: "For creators",
      lines: [
        <>0% of fees to you, so there is no creator cut to dump on your holders.</>,
        <>
          pump.fun&rsquo;s creator fee goes {s.backerPct}% into your launch&rsquo;s <Term k="vault" split={s} /> as market-making capital
          and {s.burnPct}% to the <Term k="buybackPool" split={s} />.
        </>,
        <>
          You pay the {s.launchFeePct}% launch fee and {createFee} create fee. Nothing else.
        </>,
      ],
      href: "/docs/for-creators",
      more: "For creators",
    },
    {
      id: "token",
      title: "For the Holdfast token",
      lines: [
        <>
          {s.burnPct}% of every vault agent profit and {s.burnPct}% of every pump.fun creator fee land in the{" "}
          <Term k="buybackPool" split={s} />, which buys the Holdfast token and burns it.
        </>,
        <>Holdfast itself earns only the {s.launchFeePct}% launch fee and the create fee.</>,
        <>No price promises: what the token does is up to the market.</>,
      ],
      href: "/docs/fees",
      more: "Fees",
    },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
      {cards.map((c) => (
        <section key={c.id} aria-labelledby={`trio-${c.id}`} className="flex flex-col rounded-md border border-line bg-surface p-5 md:p-6">
          <h3 id={`trio-${c.id}`} className="h3 text-ink">
            {c.title}
          </h3>
          <ul className="body mt-4 grid gap-3 text-ink-2">
            {c.lines.map((line, i) => (
              <li key={i} className="border-t border-line pt-3">
                {line}
              </li>
            ))}
          </ul>
          <Link
            href={c.href}
            className="ui mt-auto inline-block pt-6 text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink"
          >
            {c.more} ›
          </Link>
        </section>
      ))}
    </div>
  );
}
