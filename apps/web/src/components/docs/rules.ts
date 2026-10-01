import { fmtInterval, fmtMult, type PumpSplit } from "@/lib/pump-terms";

/** The backer payback rule in one sentence, wherever it is explained. */
export function paybackSentence(s: PumpSplit): string {
  return `When the vault is ${fmtMult(s.payoutMult)} its start and the chart is strong, the agent may pay backers back (principal first, then ${s.payoutSharePct}% of the vault every ${fmtInterval(s.payoutIntervalHours)}). Buying back dips always comes first.`;
}
