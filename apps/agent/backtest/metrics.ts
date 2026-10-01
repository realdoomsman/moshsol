import type { RunResult } from "./sim";

/**
 * Per-run comparison against the no-agent run of the same scenario, and the training objective.
 *
 * Vault value = SOL + tokens × mark + the agent's realized profit already paid to backers (agent
 * sells return only the sold tokens' cost to the vault), relative to the no-agent vault's value
 * (which never trades: bundle tokens + reserve SOL). Marks: each run's own final spot and its own
 * public 24 h VWAP, so price support shows up in the value of the tokens the vault still holds.
 */

export interface Comparison {
  scenario: string;
  tag: string;
  model: string;
  policy: string;
  /** Vault value vs no agent in %, marked at the final spot / at the 24 h VWAP. */
  dvFinal: number;
  dvVwap: number;
  /** 100 × ln(value ratio) at the VWAP mark: the objective's (symmetric, additive) form of dvVwap. */
  lnVwap: number;
  /** Net SOL the vault spent (reserve deployed) as % of the vault's starting value. */
  netSpentPct: number;
  /** Vault tokens and SOL at the end vs start: % of starting tokens, SOL (vault only; profit paid out is `profitShared`). */
  dTokensPct: number;
  /** Round-trip gain: tokens bought minus the tokens the spent SOL was sold for (at the average agent sell price), % of starting tokens. */
  rtTokensPct: number;
  dSol: number;
  /** Realized agent-sell profit paid to backers, SOL. */
  profitShared: number;
  solSpent: number;
  solReceived: number;
  buys: number;
  sells: number;
  /** Max drawdown of spot (%) and its reduction vs no agent (percentage points, + = shallower). */
  maxDrawdown: number;
  ddCut: number;
  /** σ of minute returns, bps, and ratio to no agent. */
  volBps: number;
  volRatio: number;
  inBand: number;
  plannedRejects: number;
  landedRejects: number;
  sameSlot: number;
}

/** SOL + tokens (whole) × mark (lamports per base unit) in SOL. */
export const value = (sol: number, tokens: number, mark: number) => sol + (tokens * mark) / 1_000;

/** SOL on the backers' side at the end of a run: left in the vault plus the profit share paid out. */
export const endSol = (r: RunResult) => r.sol1 + r.profitShared;

export function compare(base: RunResult, run: RunResult): Comparison {
  const ratio = (markRun: number, markBase: number) =>
    value(endSol(run), run.tokens1, markRun) / value(endSol(base), base.tokens1, markBase);
  const vwapRatio = ratio(run.vwap24, base.vwap24);
  const a = run.agent;
  const landed = a ? Object.values(a.landedRejects).reduce((s, n) => s + (n ?? 0), 0) : 0;
  return {
    scenario: run.scenario,
    tag: run.tag,
    model: run.model,
    policy: run.policy,
    dvFinal: (ratio(run.finalPrice, base.finalPrice) - 1) * 100,
    dvVwap: (vwapRatio - 1) * 100,
    lnVwap: Math.log(vwapRatio) * 100,
    netSpentPct: (Math.max(0, run.sol0 - endSol(run)) / value(run.sol0, run.tokens0, run.startPrice)) * 100,
    dTokensPct: ((run.tokens1 - run.tokens0) / run.tokens0) * 100,
    rtTokensPct: a && a.solReceived > 0 ? ((a.tokensBought - (a.solSpent * a.tokensSold) / a.solReceived) / run.tokens0) * 100 : 0,
    dSol: run.sol1 - run.sol0,
    profitShared: run.profitShared,
    solSpent: a?.solSpent ?? 0,
    solReceived: a?.solReceived ?? 0,
    buys: a?.buys ?? 0,
    sells: a?.sells ?? 0,
    maxDrawdown: run.maxDrawdown * 100,
    ddCut: (base.maxDrawdown - run.maxDrawdown) * 100,
    volBps: run.volBps,
    volRatio: base.volBps > 0 ? run.volBps / base.volBps : 1,
    inBand: run.inBand * 100,
    plannedRejects: a?.plannedRejects ?? 0,
    landedRejects: landed,
    sameSlot: a?.landedRejects.SameSlotTrade ?? 0,
  };
}

/**
 * Training objective (higher is better), per run:
 *   J = 100·ln(V_agent / V_none) at the 24 h VWAP  +  0.25 × drawdown cut (pp)  −  0.25 × net SOL spent (% of starting vault value)
 * The log ratio treats "twice the value" and "half the value" symmetrically and doesn't let a pump
 * (vault value ×100 either way) dwarf a rug; the VWAP mark (not the final spot) keeps one late wick
 * from deciding a run. The drawdown term rewards price support at a modest rate; the last term
 * charges reserve SOL the vault deployed (on top of its mark-to-market result, since a thin 24 h
 * VWAP can flatter tokens bought into a dying market). J is winsorized to ±50.
 *
 * Aggregate per flow model m: S_m = mean over outcome tags of the tag's mean J (every tag weighs the
 * same) + 0.25 × the mean of the worst 10% of runs (tail risk). Flow models differ in scale (a
 * history full of pumps offers more round trips than the synthetic mix), so each S_m is measured
 * against the frozen v1 policy on the same scenarios: rel_m = (S_m − S_m(v1)) / max(1, |S_m(v1)|),
 * 0 = as good as v1, +0.25 = a quarter of v1's score better. The score is 0.5 × mean + 0.5 × min of
 * rel_m over flow models: a policy only scores well if it holds up whether its impact persists
 * (exo), decays (fair) or feeds back into traders (synthetic).
 */
export const OBJECTIVE = { ddWeight: 0.25, spendWeight: 0.25, clip: 50, tailShare: 0.1, tailWeight: 0.25 };

export function runObjective(c: Comparison): number {
  const j = c.lnVwap + OBJECTIVE.ddWeight * c.ddCut - OBJECTIVE.spendWeight * c.netSpentPct;
  return Math.max(-OBJECTIVE.clip, Math.min(OBJECTIVE.clip, j));
}

export interface Scored {
  model: string;
  tag: string;
  j: number;
}

export interface Score {
  score: number;
  /** S_m per flow model, before normalization. */
  byModel: Record<string, number>;
}

export function modelScores(runs: Scored[]): Record<string, number> {
  const byModel: Record<string, number> = {};
  for (const model of [...new Set(runs.map((r) => r.model))]) {
    const rs = runs.filter((r) => r.model === model);
    const tags = [...new Set(rs.map((r) => r.tag))];
    const tagMean = tags.reduce((s, tag) => s + mean(rs.filter((r) => r.tag === tag).map((r) => r.j)), 0) / tags.length;
    const sorted = rs.map((r) => r.j).sort((a, b) => a - b);
    const tail = mean(sorted.slice(0, Math.max(1, Math.round(sorted.length * OBJECTIVE.tailShare))));
    byModel[model] = tagMean + OBJECTIVE.tailWeight * tail;
  }
  return byModel;
}

/** `runs` scored against v1's per-model scores `ref` on the same scenarios. */
export function aggregate(runs: Scored[], ref: Record<string, number>): Score {
  const byModel = modelScores(runs);
  const rel = Object.entries(byModel).map(([m, s]) => (s - ref[m]!) / Math.max(1, Math.abs(ref[m]!)));
  return { score: 0.5 * mean(rel) + 0.5 * Math.min(...rel), byModel };
}

export function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}
