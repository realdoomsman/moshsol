/**
 * The splits every pump.fun launch freezes at creation (`LaunchTerms::pump`): the burn share of the
 * vault agent's realized profit and of pump.fun's creator fee, the rest to backers, and the launch
 * fee off the raise. Read from `/api/platform` or a launch's `terms`; the mainnet defaults stand in
 * until either has loaded so first-visit copy never renders a blank.
 */
export interface PumpSplit {
  backerPct: number;
  burnPct: number;
  launchFeePct: number;
}

export function pumpSplit(t: { burnShareBps: number; launchFeeBps: number } | null | undefined): PumpSplit {
  const burnPct = (t?.burnShareBps ?? 2_500) / 100;
  return { backerPct: 100 - burnPct, burnPct, launchFeePct: (t?.launchFeeBps ?? 100) / 100 };
}
