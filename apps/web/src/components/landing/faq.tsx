import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../band/model";
import { windDownRule } from "./instructions";

interface Qa {
  q: string;
  a: ReactNode;
  href: string;
  more: string;
}

/** The landing questions of §4.2 §10 — shared with the docs FAQ. Numbers render from platform params. */
export function faqItems(p: PlatformInfo["params"] | null): Qa[] {
  const s = pumpSplit(p);
  return [
    {
      q: "Can the creator dump the bundle?",
      a: "No. The bundle is bought by the launch instruction and held in the vault, and the creator has no instruction that touches it. Only the vault agent trades it, on the launch's venue (pump.fun for new launches, the Holdfast curve for the two legacy launches), within its rules. The platform admin can withdraw vault SOL and tokens with admin_withdraw_vault; every withdrawal is on-chain and shown on the launch page.",
      href: "/docs/the-vault",
      more: "The vault",
    },
    {
      q: "What if a raise misses its minimum?",
      a: "Everyone is refunded in full. After the deadline anyone can open refunds and each backer claims 100% of their deposit; the same applies if the creator cancels.",
      href: "/docs/for-backers",
      more: "For backers",
    },
    {
      q: "Can fees or agent limits change after I back?",
      a: "No. Each launch copies the fee split and the agent limits into its own account when it's created. Platform changes only apply to launches created afterwards.",
      href: "/docs/fees",
      more: "Fees",
    },
    {
      q: "What if the agent goes offline?",
      a: "The vault stops trading and no payback runs until it's back. Public trading on pump.fun carries on, and the agent's heartbeat is public.",
      href: "/agents",
      more: "Agent status",
    },
    {
      q: "When do backers get paid back?",
      a: `Only when the vault earns it: once the vault's liquid SOL (tokens don't count) is ${fmtMult(s.payoutMult)} what went in at launch and the chart is strong, the agent may pay backers their principal, then ${s.payoutSharePct}% of the vault per payout, never more than one payout every ${fmtInterval(s.payoutIntervalHours)}. Under ${fmtMult(s.payoutMult)} or with a weak chart, nothing is paid; buying back dips always comes first. A payout can never take the vault below its ${s.minVaultSol} SOL floor for fees and rent. There is no fixed timeline.`,
      href: "/docs/for-backers",
      more: "For backers",
    },
    {
      q: "Why keep some of the raise as SOL?",
      a: p
        ? `The reserve is what the vault agent buys dips with. It can only buy at least ${pctFromBps(p.agentBandBps)} under the EMA and at or below the vault's average cost, so the reserve is never spent chasing price. What the agent sells joins it: all sale proceeds stay in the vault.`
        : "The reserve is what the vault agent buys dips with. It can only buy under the EMA band and at or below the vault's average cost, so the reserve is never spent chasing price. What the agent sells joins it: all sale proceeds stay in the vault.",
      href: "/docs/agents",
      more: "Agent rules",
    },
    {
      q: "Where does the token trade?",
      a: `New launches are pump.fun tokens: the raise creates the token on pump.fun's bonding curve, buys the bundle there before anyone else can, and public trading happens on pump.fun (PumpSwap after graduation), not on this site. pump.fun pays the launch its creator fees: ${s.vaultPct}% goes to the vault, ${s.burnPct}% buys and burns the Holdfast token, ${s.backerPct}% goes to backers. The two launches created before this change keep trading on the Holdfast curve, whose liquidity never migrates.`,
      href: "/docs/for-traders",
      more: "For traders",
    },
    {
      q: "What happens when a launch goes quiet?",
      a: `Once a launch is ${windDownRule(s)}, anyone can call wind_down_pump: the vault sells what it holds and all of its SOL goes to backers pro-rata. That can be less than what they put in; it's the worst case.`,
      href: "/docs/the-vault",
      more: "The vault",
    },
    {
      q: "What doesn't Holdfast protect against?",
      a: "Other holders can still sell, and the platform admin can withdraw a vault (every withdrawal is public). Price can fall like any token, payback only happens if the vault grows, and a wind-down can return less than you put in. Holdfast makes the backers' bundle the first buy; it doesn't promise a price.",
      href: "/docs/risks",
      more: "Risks",
    },
    {
      q: "How do I verify all this?",
      a: "Every rule is an account or instruction you can open: the instruction list above comes from the program's IDL, and every token page has a Verify on-chain panel with explorer links.",
      href: "/docs/verify",
      more: "Verify on-chain",
    },
  ];
}

/** Accordion rows: 1px rules, `h3` question, `body` answer, chevron rotating over 160 ms. No JS needed. */
export function FaqList({ items }: { items: Qa[] }) {
  return (
    <div className="border-t border-line">
      {items.map((item) => (
        <details key={item.q} className="group border-b border-line">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
            <h3 className="h3 text-ink">{item.q}</h3>
            <ChevronDown
              className="size-5 shrink-0 text-ink-3 transition-transform duration-(--dur-2) ease-(--ease-out) group-open:rotate-180"
              strokeWidth={1.5}
              aria-hidden
            />
          </summary>
          <p className="body max-w-[60ch] pb-5 text-ink-2">
            {item.a}{" "}
            <Link href={item.href} className="whitespace-nowrap text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink">
              {item.more} ›
            </Link>
          </p>
        </details>
      ))}
    </div>
  );
}
