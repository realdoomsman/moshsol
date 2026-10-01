import type { StrategyParams } from "../src/strategy";
import { aggregate, compare, mean, median, modelScores, runObjective, type Comparison, type Score } from "./metrics";
import type { SimPool } from "./pool";
import { hashSeed, type Policy, type RunResult, type SimOptions } from "./sim";
import { runKey, type PoolEntry, type ScenarioSpec } from "./scenarios";

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
    "| model | tag | n | policy | ΔV@final % | ΔV@VWAP % (median) | vault tokens Δ% | round-trip tokens % | vault SOL Δ | profit shared SOL | SOL spent | buys/sells | max DD % | DD cut pp | vol× | in band % | planned rej | landed rej (same-slot) |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const { model, label, idx } of groups(specs, Object.values(byPolicy)[0]!)) {
    for (const [policy, runs] of Object.entries(byPolicy)) {
      const cs = idx.map((i) => ev.compareTo(specs[i]!, runs[i]!));
      const m = (pick: (c: Comparison) => number) => mean(cs.map(pick));
      const trades = policy === "none" ? "–" : `${f(m((c) => c.buys), 0)}/${f(m((c) => c.sells), 0)}`;
      rows.push(
        `| ${model} | ${label} | ${idx.length} | ${policy} | ${f(m((c) => c.dvFinal))} | ${f(m((c) => c.dvVwap))} (${f(median(cs.map((c) => c.dvVwap)))}) | ` +
          `${f(m((c) => c.dTokensPct))} | ${f(m((c) => c.rtTokensPct))} | ${f(m((c) => c.dSol), 2)} | ${f(m((c) => c.profitShared), 2)} | ${f(m((c) => c.solSpent), 2)} | ${trades} | ${f(m((c) => c.maxDrawdown))} | ` +
          `${f(m((c) => c.ddCut))} | ${f(m((c) => c.volRatio), 3)} | ${f(m((c) => c.inBand))} | ${cs.reduce((s, c) => s + c.plannedRejects, 0)} | ` +
          `${cs.reduce((s, c) => s + c.landedRejects, 0)} (${cs.reduce((s, c) => s + c.sameSlot, 0)}) |`,
      );
    }
  }
  return rows.join("\n");
}

/** Compact v1 → tuned comparison per (flow model, outcome tag); no-agent is the 0 of every Δ column. */
export function summary(ev: Evaluator, specs: ScenarioSpec[], v1: RunResult[], tuned: RunResult[]): string {
  const rows: string[] = [
    "| model | tag | n | ΔV@VWAP % v1 → tuned (medians) | ΔV@final % v1 → tuned | max DD % none / v1 / tuned | planned rej | landed rej v1 / tuned (same-slot) |",
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
