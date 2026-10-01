import { WIND_DOWN_IDLE_SECS, WIND_DOWN_MIN_AGE_SECS } from "@holdfast/sdk";
import type { ReactNode } from "react";
import type { PumpSplit } from "@/lib/pump-terms";
import { RuleTooltip } from "./ui/tooltip";

export type GlossaryKey = "bundle" | "vault" | "vaultAgent" | "windDown" | "buybackPool" | "backerEarnings";

/** One plain-English sentence per piece of Holdfast jargon, numbers from the launch's or platform's split. */
export function glossaryRule(key: GlossaryKey, s: PumpSplit): string {
  switch (key) {
    case "bundle":
      return "The pooled SOL's first buy on pump.fun, made in the same instruction that creates the token, before anyone else can trade. Its tokens go into the vault.";
    case "vault":
      return "The on-chain account that holds the bundle's tokens and the reserve SOL. Only the vault agent trades it; the platform admin can withdraw, and every withdrawal is public.";
    case "vaultAgent":
      return "The one rate-limited signer allowed to trade the vault. It sells into rallies above the vault's average cost and buys back dips, under hard on-chain limits.";
    case "windDown":
      return `When a launch is ${WIND_DOWN_MIN_AGE_SECS / 86_400}+ days old, has had no trade for ${WIND_DOWN_IDLE_SECS / 3_600} hours and nobody outside the vault holds the token, anyone can close it. The vault's SOL goes back to backers.`;
    case "buybackPool":
      return `${s.burnPct}% of the vault agent's realized profit and ${s.burnPct}% of pump.fun's creator fee. Spent on the Holdfast token and burned.`;
    case "backerEarnings":
      return `${s.backerPct}% of the vault agent's realized profit, split by deposit, plus the vault's SOL if the launch winds down. Claim any time; it never expires.`;
  }
}

/** A dotted-underlined glossary term; the tooltip is `glossaryRule`. Children default to the term itself. */
export function Term({ k, split, children, className }: { k: GlossaryKey; split: PumpSplit; children?: ReactNode; className?: string }) {
  return (
    <RuleTooltip rule={glossaryRule(k, split)} className={className}>
      {children ?? TERM_LABEL[k]}
    </RuleTooltip>
  );
}

const TERM_LABEL: Record<GlossaryKey, string> = {
  bundle: "bundle",
  vault: "vault",
  vaultAgent: "vault agent",
  windDown: "wind-down",
  buybackPool: "buyback pool",
  backerEarnings: "backer earnings",
};
