import { WIND_DOWN_IDLE_SECS, WIND_DOWN_MIN_AGE_SECS } from "@holdfast/sdk";
import type { ReactNode } from "react";
import { fmtInterval, fmtMult, type PumpSplit } from "@/lib/pump-terms";
import { RuleTooltip } from "./ui/tooltip";

export type GlossaryKey = "bundle" | "vault" | "vaultAgent" | "windDown" | "buybackPool" | "backerEarnings" | "payback" | "vaultFloor";

/** One plain-English sentence per piece of Holdfast jargon, numbers from the launch's or platform's terms. */
export function glossaryRule(key: GlossaryKey, s: PumpSplit): string {
  switch (key) {
    case "bundle":
      return "The pooled SOL's first buy on pump.fun, made in the same instruction that creates the token, before anyone else can trade. Its tokens go into the vault.";
    case "vault":
      return "The on-chain account that holds the bundle's tokens and the vault's SOL. Only the vault agent trades it; the platform admin can withdraw, and every withdrawal is public.";
    case "vaultAgent":
      return "The one rate-limited signer allowed to trade the vault. It sells slowly into strength and buys back dips with what it sold, under hard on-chain limits. Everything it sells stays in the vault as SOL.";
    case "windDown":
      return `When a launch is ${WIND_DOWN_MIN_AGE_SECS / 86_400}+ days old, the vault hasn't traded for ${WIND_DOWN_IDLE_SECS / 3_600} hours and wallets outside the vault and pump.fun hold ${s.deadHoldersPct}% of the supply or less, anyone can close it: the vault sells what it holds and all of its SOL goes to backers, pro-rata.`;
    case "buybackPool":
      return `${s.burnPct}% of pump.fun's creator fee on the launch. Spent on the Holdfast token and burned.`;
    case "backerEarnings":
      return `${s.backerPct}% of pump.fun's creator fee on the launch, the vault's payback (principal, then ${s.payoutSharePct}% of the vault at most every ${fmtInterval(s.payoutIntervalHours)} while it stays above ${fmtMult(s.payoutMult)}) and the vault's SOL if the launch winds down, all split by deposit. Claim any time; it never expires.`;
    case "payback":
      return `Once the vault's liquid SOL is ${fmtMult(s.payoutMult)} what went in at launch and the chart is strong, the vault agent may pay backers back: their principal first, then ${s.payoutSharePct}% of the vault, never more than once every ${fmtInterval(s.payoutIntervalHours)}. Buying back dips always comes first.`;
    case "vaultFloor":
      return `${s.minVaultSol} SOL the vault always keeps for fees and rent: no payout and no agent buy may take it below that.`;
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
  payback: "payback",
  vaultFloor: "vault floor",
};
