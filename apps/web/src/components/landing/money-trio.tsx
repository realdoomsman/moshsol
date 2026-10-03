import Link from "next/link";
import { fmtLamports } from "@/lib/format";
import { BUYBACK_MINT_UNSET, fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { Term } from "../glossary";
import { OfficialTokenRef } from "../official/official-token";

/**
 * §7 Where the money goes, per party: the exact splits a pump launch freezes at creation, one card
 * each for backers, creators and the Holdfast token, each linking to its guide.
 */
export function MoneyTrio({ params }: { params: PlatformInfo["params"] | null }) {
  const s = pumpSplit(params);
  const createFee = params ? `${fmtLamports(params.createFeeLamports)} SOL ` : "";
  const cards = [
    {
      id: "backers",
      title: "For backers",
      lines: [
        <>
          {s.backerPct}% of pump.fun&rsquo;s creator fee on the launch, split by deposit{" "}
          <span className="whitespace-nowrap">
            (<Term k="backerEarnings" split={s} />).
          </span>{" "}
          Claim any time.
        </>,
        <>
          <Term k="payback" split={s}>Payback</Term> when the vault is {fmtMult(s.payoutMult)} its start and the chart is strong: your
          principal first, then {s.payoutSharePct}% of the vault every {fmtInterval(s.payoutIntervalHours)}. Buying back dips always comes
          first.
        </>,
        <>
          100% of your SOL back if the raise misses its minimum or the creator cancels. If the coin dies, anyone can run the{" "}
          <Term k="windDown" split={s} /> and all vault SOL goes to backers.
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
          pump.fun&rsquo;s creator fee goes {s.vaultPct}% into your launch&rsquo;s <Term k="vault" split={s} /> as agent capital,{" "}
          {s.burnPct}% to the <Term k="buybackPool" split={s} /> and {s.backerPct}% to your backers.
        </>,
        <>
          You pay the {createFee}create fee; the {s.launchFeePct}% launch fee comes out of the raise. Nothing else.
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
          {s.burnPct}% of every pump.fun creator fee lands in the <Term k="buybackPool" split={s} />, which buys the Holdfast token
          <OfficialTokenRef /> and burns it.
          {params?.buybackMint === BUYBACK_MINT_UNSET ? " The token isn’t live yet; the pools keep accruing until it is." : null}
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
