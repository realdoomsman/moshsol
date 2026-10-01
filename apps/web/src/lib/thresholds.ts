/**
 * Anti-emptiness rule (design brief §5.3). A number is a *headline* stat (hero, strips, spotlights)
 * only once it clears its threshold; below it the slot shows an invariant instead, or is omitted.
 * Tables and detail pages always show real small values — these thresholds never apply there.
 */

export type HeadlineStat = "vaultSol" | "backerFeesSol" | "launches" | "agentTrades" | "volume24hSol";

/** Headline only if the value is ≥ this. */
export const HEADLINE_MIN: Record<HeadlineStat, number> = {
  vaultSol: 100,
  backerFeesSol: 1,
  launches: 25,
  agentTrades: 50,
  volume24hSol: 50,
};

export interface Invariant {
  label: string;
  value: string;
}

/** Platform facts some invariants are rendered from (never typed into copy). */
export interface InvariantContext {
  /** `/api/platform` → `params.backerFeeShareBps`. */
  backerFeeShareBps?: number;
}

/**
 * What a headline slot shows instead of a stat below its threshold. `null` = omit the slot (also
 * when the fact it needs hasn't loaded yet — never render a guessed number).
 */
export function invariantFor(stat: HeadlineStat, ctx: InvariantContext = {}): Invariant | null {
  switch (stat) {
    case "vaultSol":
      return { label: "Backer share of agent profit", value: "100%" };
    case "backerFeesSol":
      return ctx.backerFeeShareBps === undefined
        ? null
        : { label: "Backer share of fees", value: `${ctx.backerFeeShareBps / 100}%` };
    case "launches":
      return { label: "Mint authority", value: "Revoked" };
    case "agentTrades":
    case "volume24hSol":
      return null;
  }
}

export function clearsHeadline(stat: HeadlineStat, value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= HEADLINE_MIN[stat];
}

export type HeadlineSlot = { kind: "stat"; value: number } | { kind: "invariant"; invariant: Invariant } | { kind: "omit" };

/** Resolve one headline slot: the real stat, its invariant fallback, or nothing. */
export function headlineSlot(
  stat: HeadlineStat,
  value: number | null | undefined,
  ctx: InvariantContext = {},
): HeadlineSlot {
  if (clearsHeadline(stat, value)) return { kind: "stat", value };
  const invariant = invariantFor(stat, ctx);
  return invariant ? { kind: "invariant", invariant } : { kind: "omit" };
}

/** Concentration warnings on the token page (§4.5 token info grid / holders tab), in percent. */
export const CONCENTRATION_WARN = {
  top10Pct: 30,
  creatorPct: 5,
  topHolderPct: 10,
} as const;

/** Price impact colouring in the trade panel (§4.5), in percent. */
export const IMPACT_WARN_PCT = 3;
export const IMPACT_DANGER_PCT = 10;

/** Sparklines need at least this many points or render "—" (§1.3, §6.10). */
export const SPARKLINE_MIN_POINTS = 12;
