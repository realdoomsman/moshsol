import fs from "node:fs";
import path from "node:path";
import type { StrategyParams } from "../src/strategy";
import { OBJECTIVE, aggregate, compare, mean, median, modelScores, runObjective, type Comparison, type Score } from "./metrics";
import type { SimPool } from "./pool";
import { hashSeed, type Policy, type RunResult, type SimOptions } from "./sim";
import { DATA_DIR, runKey, type PoolEntry, type PoolFile, type ScenarioSpec } from "./scenarios";

/** Dataset splits, scenario lists, batched evaluation against cached no-agent baselines, and report tables. */

export const HOUR_MIN = 60;
/** Every pool file covers the first 72 h after pool creation. */
export const FULL_MIN = 72 * HOUR_MIN;
export const TEST_SHARE = 0.3;
export const SYN_HOURS = 24;
export const SYN_TRAIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const SYN_TEST_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108];

/** Stratified by outcome tag: within each tag, pools ordered by a hash of their address, the first 30% go to TEST. */
export function split(entries: PoolEntry[]): { train: PoolEntry[]; test: PoolEntry[] } {
  const train: PoolEntry[] = [];
  const test: PoolEntry[] = [];
  for (const tag of [...new Set(entries.map((e) => e.tag))]) {
    const pools = entries.filter((e) => e.tag === tag).sort((a, b) => hashSeed(a.pool) - hashSeed(b.pool));
    const nTest = pools.length >= 2 ? Math.max(1, Math.round(pools.length * TEST_SHARE)) : 0;
    test.push(...pools.slice(0, nTest));
    train.push(...pools.slice(nTest));
  }
  return { train, test };
}

export function poolSpecs(entries: PoolEntry[], fromMin: number, toMin: number): ScenarioSpec[] {
  return entries.flatMap((e) =>
    (["exo", "fair"] as const).map((model) => ({ kind: "pool" as const, file: e.file, pool: e.pool, tag: e.tag, model, fromMin, toMin })),
  );
}

export function syntheticSpecs(seeds: number[], hours = SYN_HOURS): ScenarioSpec[] {
  return seeds.map((seed) => ({ kind: "synthetic" as const, seed, hours }));
}

/** Pools with at least `min` candles inside [fromMin, toMin). */
function withCandles(entries: PoolEntry[], fromMin: number, toMin: number, min: number): PoolEntry[] {
  return entries.filter((e) => {
    const pool = JSON.parse(fs.readFileSync(path.join(DATA_DIR, e.file), "utf8")) as PoolFile;
    const origin = Math.floor(pool.createdAt / 60) * 60;
    return pool.candles.filter((c) => c[0] >= origin + fromMin * 60 && c[0] < origin + toMin * 60).length >= min;
  });
}

/** Walk-forward specs: every pool's hours 0–24 (+ synthetic TRAIN) to tune on, hours 24–72 to test on; `say` gets the one-line description. */
export function walkForward(entries: PoolEntry[], say: (line: string) => void = () => {}): { wfTrain: ScenarioSpec[]; wfTest: ScenarioSpec[] } {
  const first = withCandles(entries, 0, 24 * HOUR_MIN, 60);
  const later = withCandles(entries, 24 * HOUR_MIN, FULL_MIN, 60);
  say(`walk-forward: tune on hours 0–24 of ${first.length} pools (+ synthetic TRAIN), test on hours 24–72 of ${later.length} pools, each segment replayed as its own launch`);
  return {
    wfTrain: [...poolSpecs(first, 0, 24 * HOUR_MIN), ...syntheticSpecs(SYN_TRAIN_SEEDS)],
    wfTest: poolSpecs(later, 24 * HOUR_MIN, FULL_MIN),
  };
}

/** Runs policies on scenario lists; no-agent and v1 runs are computed once per scenario and cached. */
export class Evaluator {
  private readonly cache: Record<"none" | "v1", Map<string, RunResult>> = { none: new Map(), v1: new Map() };

  /** `sim` overrides the agent timing model for every run of this evaluator. */
  constructor(
    readonly pool: SimPool,
    private readonly sim?: Partial<SimOptions>,
  ) {}

  private async cached(kind: "none" | "v1", specs: ScenarioSpec[]): Promise<RunResult[]> {
    const map = this.cache[kind];
    const missing = specs.filter((s) => !map.has(runKey(s)));
    const done = await Promise.all(missing.map((s) => this.pool.run(s, { kind }, this.sim)));
    missing.forEach((s, i) => map.set(runKey(s), done[i]!));
    return specs.map((s) => map.get(runKey(s))!);
  }

  /** Runs `policy` on every spec (and the baselines scoring needs). */
  async runs(specs: ScenarioSpec[], policy: Policy): Promise<RunResult[]> {
    const [, v1, runs] = await Promise.all([
      this.cached("none", specs),
      this.cached("v1", specs),
      policy.kind === "tuned" ? Promise.all(specs.map((s) => this.pool.run(s, policy, this.sim))) : Promise.resolve(null),
    ]);
    return runs ?? (policy.kind === "v1" ? v1 : specs.map((s) => this.base(s)));
  }

  /** Runs `policy` on every spec and caches only the no-agent baseline (the terms search has no v1 reference). */
  async againstNone(specs: ScenarioSpec[], policy: Policy): Promise<RunResult[]> {
    const [, runs] = await Promise.all([this.cached("none", specs), Promise.all(specs.map((s) => this.pool.run(s, policy, this.sim)))]);
    return runs;
  }

  base(spec: ScenarioSpec): RunResult {
    return this.cache.none.get(runKey(spec))!;
  }

  compareTo(spec: ScenarioSpec, run: RunResult): Comparison {
    return compare(this.base(spec), run);
  }

  private scored(specs: ScenarioSpec[], runs: RunResult[]) {
    return runs.map((r, i) => ({ model: r.model, tag: r.tag, j: runObjective(this.compareTo(specs[i]!, r)) }));
  }

  /** Objective of `runs` (one per spec, after `runs()` cached the baselines). */
  score(specs: ScenarioSpec[], runs: RunResult[]): Score {
    const v1 = specs.map((s) => this.cache.v1.get(runKey(s))!);
    return aggregate(this.scored(specs, runs), modelScores(this.scored(specs, v1)));
  }

  /** Batch fitness for the optimizer: every candidate on every spec, all queued at once. */
  fitness(specs: ScenarioSpec[]): (batch: StrategyParams[]) => Promise<number[]> {
    return async (batch) => {
      await this.runs(specs, { kind: "none" });
      const all = await Promise.all(batch.map((params) => this.runs(specs, { kind: "tuned", params })));
      return all.map((runs) => this.score(specs, runs).score);
    };
  }
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");

export interface ModelStats {
  n: number;
  /** Vault value vs no agent, % at the 24 h VWAP mark: median, mean, mean of the worst 10% of runs. */
  dvMedian: number;
  dvMean: number;
  dvTail: number;
  /** Max-drawdown cut vs no agent (pp, + = shallower), σ of minute returns vs no agent, minutes inside the band (%) and gain over no agent (pp). */
  ddCut: number;
  volRatio: number;
  inBand: number;
  inBandGain: number;
  /** `rug` pools: vault SOL lost (spent minus what came back to the vault or was paid to backers as profit) as % of the starting vault SOL, mean and mean of the worst 10%; NaN without rug runs. */
  rugLoss: number;
  rugTail: number;
  /** Per-model objective S_m (metrics.ts `modelScores`). */
  s: number;
  plannedRejects: number;
  buys: number;
  sells: number;
  /** Agent fills per hour, and the agent's share of the traded SOL (agent / (public + agent), %), means over runs. */
  tradesPerHour: number;
  volumeShare: number;
}

/** Mean of the lowest `OBJECTIVE.tailShare` of `xs`. */
export function tail(xs: number[]): number {
  return mean([...xs].sort((a, b) => a - b).slice(0, Math.max(1, Math.round(xs.length * OBJECTIVE.tailShare))));
}

/** Per flow model: value, support and rug-loss statistics of `runs` (one per spec) against their no-agent baselines. */
export function modelStats(ev: Evaluator, specs: ScenarioSpec[], runs: RunResult[]): Record<string, ModelStats> {
  const rows = runs.map((r, i) => ({ r, base: ev.base(specs[i]!), c: ev.compareTo(specs[i]!, r) }));
  const s = modelScores(rows.map(({ c }) => ({ model: c.model, tag: c.tag, j: runObjective(c) })));
  const byModel: Record<string, ModelStats> = {};
  for (const model of Object.keys(s)) {
    const rs = rows.filter(({ r }) => r.model === model);
    const dv = rs.map(({ c }) => c.dvVwap);
    const rugLoss = rs.filter(({ r }) => r.tag === "rug").map(({ r }) => (r.sol0 > 0 ? (Math.max(0, r.sol0 - r.sol1) / r.sol0) * 100 : 0));
    byModel[model] = {
      n: rs.length,
      dvMedian: median(dv),
      dvMean: mean(dv),
      dvTail: tail(dv),
      ddCut: mean(rs.map(({ c }) => c.ddCut)),
      volRatio: mean(rs.map(({ c }) => c.volRatio)),
      inBand: mean(rs.map(({ c }) => c.inBand)),
      inBandGain: mean(rs.map(({ c, base }) => c.inBand - base.inBand * 100)),
      rugLoss: rugLoss.length > 0 ? mean(rugLoss) : NaN,
      rugTail: rugLoss.length > 0 ? -tail(rugLoss.map((x) => -x)) : NaN,
      s: s[model]!,
      plannedRejects: rs.reduce((sum, { c }) => sum + c.plannedRejects, 0),
      buys: mean(rs.map(({ c }) => c.buys)),
      sells: mean(rs.map(({ c }) => c.sells)),
      tradesPerHour: mean(rs.map(({ r }) => ((r.agent?.buys ?? 0) + (r.agent?.sells ?? 0)) / Math.max(1 / 60, r.minutes / 60))),
      volumeShare: mean(
        rs.map(({ r }) => {
          const agentSol = (r.agent?.solSpent ?? 0) + (r.agent?.solReceived ?? 0);
          return agentSol > 0 ? (agentSol / (agentSol + r.publicVolumeSol)) * 100 : 0;
        }),
      ),
    };
  }
  return byModel;
}

/** Per flow model: (S_m − S_m(ref)) / max(1, |S_m(ref)|), the objective's normalized model terms with `ref` as their 0. */
function relative(stats: Record<string, ModelStats>, ref: Record<string, ModelStats>): number[] {
  return Object.entries(stats).map(([m, s]) => (s.s - ref[m]!.s) / Math.max(1, Math.abs(ref[m]!.s)));
}

/** Min over flow models of `relative`: the objective's worst-model term with `ref` as its 0. */
export function minVersus(stats: Record<string, ModelStats>, ref: Record<string, ModelStats>): number {
  return Math.min(...relative(stats, ref));
}

/** The objective (metrics.ts `aggregate`: mean and worst model) with `ref` as its 0 instead of v1 at the same timing. */
export function versus(stats: Record<string, ModelStats>, ref: Record<string, ModelStats>): number {
  const rel = relative(stats, ref);
  return 0.5 * mean(rel) + 0.5 * Math.min(...rel);
}

/** Markdown rows comparing policies per flow model (the first entry is the reference of the last column). */
export function statsTable(byPolicy: [string, Record<string, ModelStats>][]): string {
  const rows = [
    "| policy | model | n | ΔV@VWAP median % (mean) | worst-10% ΔV % | DD cut pp | vol× | buys/sells | rug SOL lost % (worst 10%) | S_m | min over models vs " + byPolicy[0]![0] + " |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|",
  ];
  const ref = byPolicy[0]![1];
  for (const [name, stats] of byPolicy) {
    const models = Object.keys(stats);
    models.forEach((model, i) => {
      const s = stats[model]!;
      rows.push(
        `| ${i === 0 ? name : ""} | ${model} | ${s.n} | ${f(s.dvMedian)} (${f(s.dvMean)}) | ${f(s.dvTail)} | ${f(s.ddCut, 2)} | ${f(s.volRatio, 3)} | ${f(s.buys, 0)}/${f(s.sells, 0)} | ` +
          `${Number.isFinite(s.rugLoss) ? `${f(s.rugLoss)} (${f(s.rugTail)})` : "–"} | ${f(s.s, 2)} | ${i === 0 ? f(minVersus(stats, ref), 3) : ""} |`,
      );
    });
  }
  return rows.join("\n");
}

/** Run indices grouped by flow model and outcome tag, each model followed by its "all" group. */
function groups(specs: ScenarioSpec[], runs: RunResult[]): { model: string; label: string; idx: number[] }[] {
  const byKey = new Map<string, number[]>();
  specs.forEach((_, i) => {
    const k = `${runs[i]!.model}|${runs[i]!.tag}`;
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  const keys = [...byKey.keys()].sort();
  return [...new Set(keys.map((k) => k.split("|")[0]!))].flatMap((model) => {
    const tagKeys = keys.filter((k) => k.startsWith(`${model}|`));
    return [
      ...tagKeys.map((k) => ({ model, label: k.split("|")[1]!, idx: byKey.get(k)! })),
      { model, label: "**all**", idx: tagKeys.flatMap((k) => byKey.get(k)!) },
    ];
  });
}

/** Markdown table: one row per (flow model, outcome tag, policy) with means over the group's runs. */
export function table(ev: Evaluator, specs: ScenarioSpec[], byPolicy: Record<string, RunResult[]>): string {
  const rows: string[] = [
    "| model | tag | n | policy | ΔV@final % | ΔV@VWAP % (median) | vault tokens Δ% | round-trip tokens % | vault SOL Δ | SOL spent | buys/sells | max DD % | DD cut pp | vol× | in band % | planned rej | landed rej (same-slot) |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const { model, label, idx } of groups(specs, Object.values(byPolicy)[0]!)) {
    for (const [policy, runs] of Object.entries(byPolicy)) {
      const cs = idx.map((i) => ev.compareTo(specs[i]!, runs[i]!));
      const m = (pick: (c: Comparison) => number) => mean(cs.map(pick));
      const trades = policy === "none" ? "–" : `${f(m((c) => c.buys), 0)}/${f(m((c) => c.sells), 0)}`;
      rows.push(
        `| ${model} | ${label} | ${idx.length} | ${policy} | ${f(m((c) => c.dvFinal))} | ${f(m((c) => c.dvVwap))} (${f(median(cs.map((c) => c.dvVwap)))}) | ` +
          `${f(m((c) => c.dTokensPct))} | ${f(m((c) => c.rtTokensPct))} | ${f(m((c) => c.dSol), 2)} | ${f(m((c) => c.solSpent), 2)} | ${trades} | ${f(m((c) => c.maxDrawdown))} | ` +
          `${f(m((c) => c.ddCut))} | ${f(m((c) => c.volRatio), 3)} | ${f(m((c) => c.inBand))} | ${cs.reduce((s, c) => s + c.plannedRejects, 0)} | ` +
          `${cs.reduce((s, c) => s + c.landedRejects, 0)} (${cs.reduce((s, c) => s + c.sameSlot, 0)}) |`,
      );
    }
  }
  return rows.join("\n");
}

/** Compact a → b comparison per (flow model, outcome tag); no-agent is the 0 of every Δ column. */
export function summary(ev: Evaluator, specs: ScenarioSpec[], aName: string, v1: RunResult[], bName: string, tuned: RunResult[]): string {
  const rows: string[] = [
    `| model | tag | n | ΔV@VWAP % ${aName} → ${bName} (medians) | ΔV@final % ${aName} → ${bName} | max DD % none / ${aName} / ${bName} | planned rej | landed rej ${aName} / ${bName} (same-slot) |`,
    "|---|---|---:|---|---|---|---:|---|",
  ];
  for (const { model, label, idx } of groups(specs, v1)) {
    const [a, b] = [v1, tuned].map((runs) => idx.map((i) => ev.compareTo(specs[i]!, runs[i]!)));
    const m = (cs: Comparison[], pick: (c: Comparison) => number) => mean(cs.map(pick));
    const sum = (cs: Comparison[], pick: (c: Comparison) => number) => cs.reduce((s, c) => s + pick(c), 0);
    const dd0 = mean(idx.map((i) => ev.base(specs[i]!).maxDrawdown * 100));
    rows.push(
      `| ${model} | ${label} | ${idx.length} | ${f(m(a!, (c) => c.dvVwap))} → ${f(m(b!, (c) => c.dvVwap))} ` +
        `(${f(median(a!.map((c) => c.dvVwap)))} → ${f(median(b!.map((c) => c.dvVwap)))}) | ${f(m(a!, (c) => c.dvFinal))} → ${f(m(b!, (c) => c.dvFinal))} | ` +
        `${f(dd0)} / ${f(m(a!, (c) => c.maxDrawdown))} / ${f(m(b!, (c) => c.maxDrawdown))} | ${sum(a!, (c) => c.plannedRejects) + sum(b!, (c) => c.plannedRejects)} | ` +
        `${sum(a!, (c) => c.landedRejects)} (${sum(a!, (c) => c.sameSlot)}) / ${sum(b!, (c) => c.landedRejects)} (${sum(b!, (c) => c.sameSlot)}) |`,
    );
  }
  return rows.join("\n");
}
