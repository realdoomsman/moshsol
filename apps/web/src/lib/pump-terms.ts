import { lamportsToSol } from "@holdfast/sdk";

/**
 * The economics every pump.fun launch freezes at creation (`LaunchTerms::pump`), in the units copy
 * uses: how pump.fun's creator fee is split (vault / buyback-and-burn pool / backers), the backer
 * payback rule (vault SOL ≥ `payoutMult` × its start → principal, then `payoutSharePct` of the
 * vault every `payoutIntervalHours`), the SOL floor the vault keeps for fees, the dead-launch
 * threshold and the launch fee off the raise. Read from `/api/platform` or a launch's `terms`; the
 * mainnet defaults stand in until either has loaded so first-visit copy never renders a blank.
 */
export interface PumpSplit {
  /** % of pump.fun creator fees that become vault SOL (agent capital). */
  vaultPct: number;
  /** % of pump.fun creator fees that buy and burn the Holdfast token. */
  burnPct: number;
  /** % of pump.fun creator fees paid to backers pro-rata (claimable). */
  backerPct: number;
  /** Vault SOL ÷ initial vault SOL that unlocks backer payouts (e.g. 5). */
  payoutMult: number;
  /** % of vault SOL paid to backers per dividend once the vault is above the multiple. */
  payoutSharePct: number;
  /** Hours between dividend checks. */
  payoutIntervalHours: number;
  /** SOL the vault always keeps (never paid out or spent on buys): fees and rent. */
  minVaultSol: number;
  /** Max % of supply held outside the vault and venue for a launch to count as dead. */
  deadHoldersPct: number;
  launchFeePct: number;
}

/** Mainnet defaults (`scripts/src/setup.ts`, `PRODUCTION_TERMS`) used until the platform has loaded. */
export const DEFAULT_PUMP_SPLIT: PumpSplit = {
  vaultPct: 75,
  burnPct: 15,
  backerPct: 10,
  payoutMult: 5,
  payoutSharePct: 15,
  payoutIntervalHours: 4,
  minVaultSol: 0.1,
  deadHoldersPct: 5,
  launchFeePct: 1,
};

export type PumpTermsLike = {
  burnShareBps: number;
  launchFeeBps: number;
  creatorFeeVaultBps?: number;
  payoutMultBps?: number;
  payoutShareBps?: number;
  payoutIntervalSecs?: number;
  deadHoldersBps?: number;
  minVaultSol?: string | number;
};

export function pumpSplit(t: PumpTermsLike | null | undefined): PumpSplit {
  // Terms decoded before the vault-model upgrade (no `creatorFeeVaultBps`) belong to the old split; the
  // migration rewrites them to the new defaults, so the defaults are what they will read.
  if (!t) return DEFAULT_PUMP_SPLIT;
  if (t.creatorFeeVaultBps === undefined) return { ...DEFAULT_PUMP_SPLIT, launchFeePct: t.launchFeeBps / 100 };
  const d = DEFAULT_PUMP_SPLIT;
  const vaultPct = t.creatorFeeVaultBps / 100;
  const burnPct = t.burnShareBps / 100;
  return {
    vaultPct,
    burnPct,
    backerPct: Math.max(0, 100 - vaultPct - burnPct),
    payoutMult: (t.payoutMultBps ?? d.payoutMult * 10_000) / 10_000,
    payoutSharePct: (t.payoutShareBps ?? d.payoutSharePct * 100) / 100,
    payoutIntervalHours: (t.payoutIntervalSecs ?? d.payoutIntervalHours * 3_600) / 3_600,
    minVaultSol: t.minVaultSol === undefined ? d.minVaultSol : lamportsToSol(t.minVaultSol.toString()),
    deadHoldersPct: (t.deadHoldersBps ?? d.deadHoldersPct * 100) / 100,
    launchFeePct: t.launchFeeBps / 100,
  };
}

/** "5×", "2.5×" — the payout multiple as copy. */
export function fmtMult(mult: number): string {
  return `${Number.isInteger(mult) ? mult : mult.toFixed(2).replace(/\.?0+$/, "")}×`;
}

/** "4h", "90m" — a dividend interval as copy. */
export function fmtInterval(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${Math.round(hours * 60)}m`;
}
