import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../band/model";
import { WIND_DOWN_RULE } from "./instructions";

interface Qa {
  q: string;
  a: ReactNode;
  href: string;
  more: string;
}

/** The landing questions of §4.2 §10 — shared with the docs FAQ. Numbers render from platform params. */
export function faqItems(p: PlatformInfo["params"] | null): Qa[] {
  return [
    {
      q: "Can the creator dump the bundle?",
      a: "No. The bundle is bought by the launch instruction and held in the vault, and the creator has no instruction that touches it. Only the vault agent trades it, on the launch's own curve, within its rules. The platform admin can withdraw vault SOL and tokens with admin_withdraw_vault; every withdrawal is on-chain and shown on the launch page.",
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
      a: "The vault stops trading until it's back. Public trading on the curve carries on, and the agent's heartbeat is public.",
      href: "/agents",
      more: "Agent status",
    },
    {
      q: "Why keep some of the raise as SOL?",
      a: p
        ? `The reserve is what the vault agent buys dips with. It can only buy at least ${pctFromBps(p.agentBandBps)} under the EMA and at or below the vault's average cost, so the reserve is never spent chasing price.`
        : "The reserve is what the vault agent buys dips with. It can only buy under the EMA band and at or below the vault's average cost, so the reserve is never spent chasing price.",
      href: "/docs/agents",
      more: "Agent rules",
    },
    {
      q: "Does the token migrate to a DEX?",
      a: "No. Liquidity lives on the Holdfast curve, and no instruction takes it out while anyone else holds the token: the admin's vault withdrawal can't touch it, and wind_down only pays it to backers once nobody outside the curve and vault holds any.",
      href: "/docs/for-traders",
      more: "For traders",
    },
    {
      q: "What happens when a launch goes quiet?",
      a: `Once a launch is ${WIND_DOWN_RULE}, anyone can call wind_down: the vault's tokens go back to the curve, the curve's and vault's SOL is credited to backers pro-rata, and trading ends.`,
      href: "/docs/the-vault",
      more: "The vault",
    },
    {
      q: "What doesn't Holdfast protect against?",
      a: "Other holders can still sell, and the platform admin can withdraw a vault (every withdrawal is public). Price can fall like any token — Holdfast makes the backers' bundle the first buy, not a price floor.",
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
