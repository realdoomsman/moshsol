import { DEFAULT_PARAMS } from "../src/strategy";
import { modelStats, type Evaluator, type ModelStats } from "./evaluate";
import { endSol, median, value } from "./metrics";
import { SearchSpace, cmaes, randomSearch, type Bounds } from "./optimize";
import { PRODUCTION_TERMS, type SimTerms } from "./program";
import type { ScenarioSpec } from "./scenarios";
import { mulberry32, type RunResult } from "./sim";

/**
 * Launch-terms search (`backtest terms`): the agent terms the platform freezes into every launch, with
 * the shipped policy (DEFAULT_PARAMS) fixed. Every candidate runs against the no-agent run of the same
 * launch under the same terms and is scored per flow model like the policy objective (tag-balanced
 * mean of J + 0.25 × worst 10%, metrics.ts), relative to the baseline terms; its score is the minimum
 * over flow models, so terms must hold up whether agent impact persists, decays or feeds back.
 */

export interface TermsPoint {
  bandBps: number;
  maxImpactBps: number;
  buyBpsPerWindow: number;
  sellBpsPerWindow: number;
  windowSecs: number;
  emaPeriodSecs: number;
}

export type TermsKey = keyof TermsPoint;

/**
 * The program's hard limits (programs/moshsol/src/constants.rs). Impact and window caps are searched
 * from 10 bps: 0 only switches a side off, and below ~10 bps the agent's trades fall under its minimum size.
 */
export const TERMS_SPACE: Record<TermsKey, Bounds> = {
  bandBps: { lo: 50, hi: 5_000, log: true, int: true },
  maxImpactBps: { lo: 10, hi: 1_000, log: true, int: true },
  buyBpsPerWindow: { lo: 10, hi: 2_000, log: true, int: true },
  sellBpsPerWindow: { lo: 10, hi: 2_000, log: true, int: true },
  windowSecs: { lo: 300, hi: 86_400, log: true, int: true },
  emaPeriodSecs: { lo: 300, hi: 604_800, log: true, int: true },
};

export const TERMS_KEYS = Object.keys(TERMS_SPACE) as TermsKey[];

/** Grid the picked points are rounded to (values an admin would set) before they are measured again. */
const TERMS_STEP: Record<TermsKey, number> = {
  bandBps: 25,
  maxImpactBps: 25,
  buyBpsPerWindow: 50,
  sellBpsPerWindow: 50,
  windowSecs: 300,
  emaPeriodSecs: 300,
};

export function termsPoint(t: SimTerms): TermsPoint {
  return {
    bandBps: Number(t.bandBps),
    maxImpactBps: Number(t.maxImpactBps),
    buyBpsPerWindow: Number(t.buyBpsPerWindow),
    sellBpsPerWindow: Number(t.sellBpsPerWindow),
    windowSecs: Number(t.windowSecs),
    emaPeriodSecs: Number(t.emaPeriodSecs),
  };
}

/** `p` with the production trade and launch fees (not part of the search). */
export function simTerms(p: TermsPoint): SimTerms {
  return {
    ...PRODUCTION_TERMS,
    bandBps: BigInt(p.bandBps),
    maxImpactBps: BigInt(p.maxImpactBps),
    buyBpsPerWindow: BigInt(p.buyBpsPerWindow),
    sellBpsPerWindow: BigInt(p.sellBpsPerWindow),
    windowSecs: BigInt(p.windowSecs),
    emaPeriodSecs: BigInt(p.emaPeriodSecs),
  };
}

/** Parses a JSON object of `TermsPoint` fields (missing ones from `base`), each an integer inside `TERMS_SPACE`. */
export function parseTerms(base: TermsPoint, raw: Record<string, unknown>): TermsPoint {
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    const b = TERMS_SPACE[k as TermsKey];
    if (!b) throw new Error(`unknown terms field "${k}" (known: ${TERMS_KEYS.join(", ")})`);
    if (typeof v !== "number" || !Number.isInteger(v) || v < b.lo || v > b.hi) {
      throw new Error(`terms field ${k} must be an integer in [${b.lo}, ${b.hi}], got ${JSON.stringify(v)}`);
    }
    out[k as TermsKey] = v;
  }
  return out;
}

export function roundTerms(p: TermsPoint): TermsPoint {
  const out = { ...p };
  for (const k of TERMS_KEYS) {
    const { lo, hi } = TERMS_SPACE[k];
    out[k] = Math.min(hi, Math.max(lo, Math.round(p[k] / TERMS_STEP[k]) * TERMS_STEP[k]));
  }
  return out;
}

const sameTerms = (a: TermsPoint, b: TermsPoint) => TERMS_KEYS.every((k) => a[k] === b[k]);

export interface Measured {
  terms: TermsPoint;
  byModel: Record<string, ModelStats>;
}

/** `specs` with every launch under `terms` (and `reserveBps` instead of the drawn reserve share). */
export function withLaunch(specs: ScenarioSpec[], terms: TermsPoint, reserveBps?: bigint): ScenarioSpec[] {
  const t = simTerms(terms);
  return specs.map((s) => ({ ...s, launch: { terms: t, reserveBps } }));
}

/** Runs the shipped policy on `specs` under `terms` (and the no-agent baseline it is compared to). */
export async function measure(ev: Evaluator, specs: ScenarioSpec[], terms: TermsPoint, reserveBps?: bigint): Promise<{ measured: Measured; runs: RunResult[] }> {
  const variant = withLaunch(specs, terms, reserveBps);
  const runs = await ev.againstNone(variant, { kind: "tuned", params: DEFAULT_PARAMS });
  return { measured: { terms, byModel: modelStats(ev, variant, runs) }, runs };
}

/** `ModelStats` fields at their worst flow model, plus planned rejections summed over models. */
export type Worst = Pick<ModelStats, "dvMedian" | "dvMean" | "dvTail" | "ddCut" | "volRatio" | "inBandGain" | "rugLoss" | "rugTail" | "plannedRejects">;

/** Each statistic at its worst flow model (value and support: lowest; volatility and rug loss: highest). */
export function worst(m: Measured): Worst {
  const ms = Object.values(m.byModel);
  const lo = (pick: (s: ModelStats) => number) => Math.min(...ms.map(pick));
  const hi = (pick: (s: ModelStats) => number) => {
    const xs = ms.map(pick).filter(Number.isFinite);
    return xs.length > 0 ? Math.max(...xs) : NaN;
  };
  return {
    dvMedian: lo((s) => s.dvMedian),
    dvMean: lo((s) => s.dvMean),
    dvTail: lo((s) => s.dvTail),
    ddCut: lo((s) => s.ddCut),
    volRatio: hi((s) => s.volRatio),
    inBandGain: lo((s) => s.inBandGain),
    rugLoss: hi((s) => s.rugLoss),
    rugTail: hi((s) => s.rugTail),
    plannedRejects: ms.reduce((sum, s) => sum + s.plannedRejects, 0),
  };
}

/** Search score: min over flow models of (S_m − S_m(baseline)) / max(1, |S_m(baseline)|); 0 = the baseline terms. */
export function score(m: Measured, base: Measured): number {
  return Math.min(
    ...Object.entries(m.byModel).map(([model, s]) => {
      const ref = base.byModel[model]!.s;
      return (s.s - ref) / Math.max(1, Math.abs(ref));
    }),
  );
}

/** Seeded random search + CMA-ES over `TERMS_SPACE` from `base`; returns every measured point. */
export async function searchTerms(
  ev: Evaluator,
  specs: ScenarioSpec[],
  base: Measured,
  o: { random: number; gens: number; label: string },
): Promise<Measured[]> {
  const all: Measured[] = [];
  const t0 = Date.now();
  const fitness = async (batch: TermsPoint[]) => {
    const ms = await Promise.all(batch.map((p) => measure(ev, specs, p)));
    all.push(...ms.map((x) => x.measured));
    return ms.map((x) => score(x.measured, base));
  };
  const space = new SearchSpace(TERMS_SPACE, TERMS_KEYS, base.terms);
  const random = await randomSearch(space, o.random, [base.terms], fitness, mulberry32(7));
  console.log(`[${o.label}] random search: best ${random[0]!.score.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await cmaes(space, random[0]!.params, fitness, {
    sigma: 0.2,
    generations: o.gens,
    seed: 11,
    onGeneration: (g, best, sigma) =>
      console.log(`[${o.label}] CMA-ES gen ${g + 1}: best ${best.score.toFixed(3)} σ ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
  });
  return all;
}

/** In order of preference for the recommendation (the search score weighs value, support, spend and tail at once). */
export const RULES = ["balanced", "conservative", "supportive"] as const;
export type Rule = (typeof RULES)[number];

export const RULE_DOC: Record<Rule, string> = {
  conservative: "highest worst-model median ΔV among points losing no more vault SOL on rugs than the baseline",
  balanced: "best search score among points beating the baseline's worst-model median ΔV within the rug budget",
  supportive: "largest worst-model drawdown cut among points beating the baseline's worst-model median ΔV within the rug budget",
};

/** The point each rule picks from `trials` (undefined when no point qualifies or only the baseline does). */
export function pick(trials: Measured[], base: Measured, rugBudgetPp: number): Record<Rule, Measured | undefined> {
  const b = worst(base);
  const rows = trials.filter((t) => !sameTerms(t.terms, base.terms)).map((t) => ({ t, w: worst(t), score: score(t, base) }));
  const best = (xs: typeof rows, key: (r: (typeof rows)[number]) => number) =>
    xs.reduce<(typeof rows)[number] | undefined>((a, r) => (a === undefined || key(r) > key(a) ? r : a), undefined)?.t;
  const noMoreRug = rows.filter((r) => r.w.rugLoss <= b.rugLoss && r.w.dvMedian > b.dvMedian);
  const better = rows.filter((r) => r.w.rugLoss <= b.rugLoss + rugBudgetPp && r.w.dvMedian > b.dvMedian);
  return {
    conservative: best(noMoreRug, (r) => r.w.dvMedian),
    balanced: best(better, (r) => r.score),
    supportive: best(better, (r) => r.w.ddCut),
  };
}

/** Points no other point beats at once on worst-model median ΔV, worst-10% ΔV, drawdown cut and rug loss. */
export function pareto(trials: Measured[]): Measured[] {
  const rows = trials.map((t) => ({ t, w: worst(t) }));
  // Every objective as "higher is better".
  const axes = (w: Worst) => [w.dvMedian, w.dvTail, w.ddCut, -w.rugLoss];
  const dominated = (a: (typeof rows)[number]) => {
    const xa = axes(a.w);
    return rows.some((b) => {
      const xb = axes(b.w);
      return xb.every((x, i) => x >= xa[i]!) && xb.some((x, i) => x > xa[i]!);
    });
  };
  const front = rows.filter((r) => !dominated(r));
  return front
    .filter((r, i) => front.findIndex((o) => sameTerms(o.t.terms, r.t.terms)) === i)
    .sort((a, b) => b.w.dvMedian - a.w.dvMedian)
    .map((r) => r.t);
}

export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");

export function duration(secs: number): string {
  if (secs % 86_400 === 0) return `${secs / 86_400} d`;
  if (secs % 3_600 === 0) return `${secs / 3_600} h`;
  return secs >= 3_600 ? `${fmt(secs / 3_600)} h` : `${fmt(secs / 60, 0)} min`;
}

export function fmtTerms(t: TermsPoint): string {
  return `band ${t.bandBps} · impact ${t.maxImpactBps} · buy/sell ${t.buyBpsPerWindow}/${t.sellBpsPerWindow} per ${duration(t.windowSecs)} · EMA ${duration(t.emaPeriodSecs)}`;
}

/** Markdown table of labelled points; every statistic at its worst flow model, per-model medians in brackets. */
export function termsTable(rows: [string, Measured][], base: Measured): string {
  const models = Object.keys(base.byModel);
  const out = [
    `| point | band bps | impact bps | buy / sell bps per window | window | EMA | ΔV@VWAP % median, min (${models.join(" / ")}) | ΔV mean % (min) | worst-10% ΔV % | DD cut pp | vol× | in band % (gain pp) | rug SOL lost % mean / worst 10% | score | planned rej |`,
    "|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|---|---:|---:|",
  ];
  for (const [label, m] of rows) {
    const w = worst(m);
    const t = m.terms;
    const inBand = Math.min(...Object.values(m.byModel).map((s) => s.inBand));
    out.push(
      `| ${label} | ${t.bandBps} | ${t.maxImpactBps} | ${t.buyBpsPerWindow} / ${t.sellBpsPerWindow} | ${duration(t.windowSecs)} | ${duration(t.emaPeriodSecs)} | ` +
        `**${fmt(w.dvMedian)}** (${models.map((k) => fmt(m.byModel[k]!.dvMedian)).join(" / ")}) | ${fmt(w.dvMean)} | ${fmt(w.dvTail)} | ${fmt(w.ddCut, 2)} | ${fmt(w.volRatio, 3)} | ` +
        `${fmt(inBand)} (${fmt(w.inBandGain)}) | ${fmt(w.rugLoss)} / ${fmt(w.rugTail)} | ${fmt(score(m, base), 3)} | ${w.plannedRejects} |`,
    );
  }
  return out.join("\n");
}

/** Per run: agent vault value under reserve `r` vs the agent vault under the reference reserve (same scenario, VWAP marks), %. */
export function vsReserve(runs: RunResult[], ref: RunResult[]): Record<string, number> {
  const byModel: Record<string, number[]> = {};
  runs.forEach((r, i) => {
    const q = ref[i]!;
    (byModel[r.model] ??= []).push((value(endSol(r), r.tokens1, r.vwap24) / value(endSol(q), q.tokens1, q.vwap24) - 1) * 100);
  });
  return Object.fromEntries(Object.entries(byModel).map(([m, xs]) => [m, median(xs)]));
}
