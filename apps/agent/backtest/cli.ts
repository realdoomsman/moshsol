/**
 * Backtest CLI (dataset: `backtest:fetch` → apps/agent/backtest/data/):
 *
 *   pnpm --filter @holdfast/agent backtest eval         no agent / v1 / tuned on TRAIN and TEST
 *   pnpm --filter @holdfast/agent backtest train        random search + CMA-ES on TRAIN, then TRAIN/TEST tables
 *   pnpm --filter @holdfast/agent backtest walkforward  tune on every pool's first 24 h, test on hours 24–72
 *   pnpm --filter @holdfast/agent backtest ablate       tune on a FIT part of TRAIN, switch each feature off on the VALIDATION part
 *   pnpm --filter @holdfast/agent backtest robust       TEST split under other timing / fair-value assumptions
 *
 * Flags: --params <JSON object or file> (policy to evaluate/ablate/start from; default DEFAULT_PARAMS),
 * --random <n> (200) and --gens <n> (25) for training, --freeze <feature,…> (train with those features
 * switched off: margins → 25 bps, floor → none), --workers <n> (CPUs − 2).
 * Every command prints markdown and writes it plus a JSON summary to apps/agent/backtest/results/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PARAMS, PARAM_KEYS, PARAM_SPACE, withParams, type ParamKey, type StrategyParams } from "../src/strategy";
import { Evaluator, FULL_MIN, HOUR_MIN, SYN_TEST_SEEDS, SYN_TRAIN_SEEDS, poolSpecs, split, summary, syntheticSpecs, table } from "./evaluate";
import { mean, type Score } from "./metrics";
import { SearchSpace, cmaes, randomSearch } from "./optimize";
import { SimPool } from "./pool";
import { DATA_DIR, loadIndex, type PoolEntry, type PoolFile, type ScenarioSpec } from "./scenarios";
import { mulberry32, type Policy, type RunResult, type SimOptions } from "./sim";

/** Policy features that can be switched off (for ablation, and frozen out of training with `--freeze`). */
const FEATURES: Record<string, { off: Partial<StrategyParams>; keys: ParamKey[] }> = {
  margins: { off: { buyMarginBps: 25, sellMarginBps: 25 }, keys: ["buyMarginBps", "sellMarginBps"] },
  floor: { off: { holdSlope: PARAM_SPACE.holdSlope.hi }, keys: ["holdSlope"] },
};

/** `p` with the named features switched off. */
function without(p: StrategyParams, features: string[]): StrategyParams {
  return features.reduce((acc, f) => ({ ...acc, ...FEATURES[f]!.off }), p);
}

/** Tunable keys once `frozen` features are off. */
function tunableKeys(frozen: string[]): ParamKey[] {
  const fixed = new Set(frozen.flatMap((f) => FEATURES[f]!.keys));
  return PARAM_KEYS.filter((k) => !fixed.has(k));
}

function frozenFlag(): string[] {
  const v = flag("freeze");
  const names = v ? v.split(",").map((s) => s.trim()) : [];
  for (const n of names) if (!FEATURES[n]) throw new Error(`--freeze: unknown feature "${n}" (known: ${Object.keys(FEATURES).join(", ")})`);
  return names;
}

/** The new policy's closest match to v1: 25 bps margins, no inventory floor. */
const V1_LIKE: StrategyParams = without(DEFAULT_PARAMS, Object.keys(FEATURES));

const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intFlag(name: string, fallback: number): number {
  const v = flag(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer, got ${v}`);
  return n;
}

function paramsFlag(): StrategyParams {
  const v = flag("params");
  if (v === undefined) return DEFAULT_PARAMS;
  const raw = fs.existsSync(v) ? fs.readFileSync(v, "utf8") : v;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return withParams(DEFAULT_PARAMS, (parsed.params as Record<string, unknown> | undefined) ?? parsed);
}

const fmtParams = (p: StrategyParams) =>
  JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Number(v.toPrecision(4))])), null, 2);

const out: string[] = [];
function say(line = ""): void {
  console.log(line);
  out.push(line);
}

function save(name: string, summary: unknown): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${name}.md`), `${out.join("\n")}\n`);
  fs.writeFileSync(path.join(RESULTS_DIR, `${name}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(process.cwd(), path.join(RESULTS_DIR, name))}.{md,json}`);
}

async function report(ev: Evaluator, label: string, specs: ScenarioSpec[], params: StrategyParams) {
  const policies: [string, Policy][] = [
    ["none", { kind: "none" }],
    ["v1", { kind: "v1" }],
    ["tuned", { kind: "tuned", params }],
  ];
  const byPolicy: Record<string, RunResult[]> = {};
  const scores: Record<string, Score> = {};
  for (const [name, policy] of policies) {
    byPolicy[name] = await ev.runs(specs, policy);
    scores[name] = ev.score(specs, byPolicy[name]!);
  }
  say(`\n### ${label}\n`);
  say(
    `objective: ${Object.entries(scores)
      .map(([k, s]) => `${k} ${s.score.toFixed(2)} (${Object.entries(s.byModel).map(([m, v]) => `${m} ${v.toFixed(2)}`).join(", ")})`)
      .join(" · ")}\n`,
  );
  say(summary(ev, specs, byPolicy.v1!, byPolicy.tuned!));
  say("\n<details><summary>all metrics</summary>\n");
  say(table(ev, specs, byPolicy));
  say("\n</details>");
  return scores;
}

async function tune(ev: Evaluator, specs: ScenarioSpec[], start: StrategyParams, label: string, frozen: string[]): Promise<StrategyParams> {
  const fitness = ev.fitness(specs);
  const space = new SearchSpace(tunableKeys(frozen), without(start, frozen));
  const t0 = Date.now();
  const seeds = [start, DEFAULT_PARAMS, V1_LIKE].map((p) => without(p, frozen));
  const random = await randomSearch(space, intFlag("random", 200), seeds, fitness, mulberry32(7));
  console.log(`[${label}] random search: best ${random[0]!.score.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const trials = await cmaes(space, random[0]!.params, fitness, {
    sigma: 0.2,
    generations: intFlag("gens", 25),
    seed: 11,
    onGeneration: (g, best, sigma) =>
      console.log(`[${label}] CMA-ES gen ${g + 1}: best ${best.score.toFixed(3)} σ ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
  });
  const best = trials[0]!.score >= random[0]!.score ? trials[0]! : random[0]!;
  say(
    `\n${label}: ${space.keys.length} tuned parameters${frozen.length ? ` (switched off: ${frozen.join(", ")})` : ""}, ` +
      `${random.length} random + ${trials.length} CMA-ES evaluations, best objective ${best.score.toFixed(3)}\n`,
  );
  say("```json");
  say(fmtParams(best.params));
  say("```");
  return best.params;
}

/** Pools with at least `min` candles inside [fromMin, toMin). */
function withCandles(entries: PoolEntry[], fromMin: number, toMin: number, min: number): PoolEntry[] {
  return entries.filter((e) => {
    const pool = JSON.parse(fs.readFileSync(path.join(DATA_DIR, e.file), "utf8")) as PoolFile;
    const origin = Math.floor(pool.createdAt / 60) * 60;
    return pool.candles.filter((c) => c[0] >= origin + fromMin * 60 && c[0] < origin + toMin * 60).length >= min;
  });
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || !["eval", "train", "walkforward", "ablate", "robust"].includes(cmd)) {
    throw new Error("usage: backtest <eval|train|walkforward|ablate|robust> [--params <json|file>] [--random n] [--gens n] [--freeze f,…] [--workers n]");
  }
  const entries = loadIndex();
  const { train, test } = split(entries);
  const tags = (es: PoolEntry[]) => Object.entries(es.reduce<Record<string, number>>((a, e) => ({ ...a, [e.tag]: (a[e.tag] ?? 0) + 1 }), {}));
  say(`# backtest ${cmd}\n`);
  say(`dataset: ${entries.length} pools; TRAIN ${train.length} (${tags(train).map(([t, n]) => `${t} ${n}`).join(", ")}), TEST ${test.length} (${tags(test).map(([t, n]) => `${t} ${n}`).join(", ")}); synthetic ${SYN_TRAIN_SEEDS.length}+${SYN_TEST_SEEDS.length} × 24 h`);
  const pool = new SimPool(flag("workers") ? intFlag("workers", 1) : undefined);
  const ev = new Evaluator(pool);
  const trainSpecs = [...poolSpecs(train, 0, FULL_MIN), ...syntheticSpecs(SYN_TRAIN_SEEDS)];
  const testSpecs = [...poolSpecs(test, 0, FULL_MIN), ...syntheticSpecs(SYN_TEST_SEEDS)];
  const params = paramsFlag();
  const frozen = frozenFlag();
  try {
    if (cmd === "eval") {
      say(`\npolicy:\n\n\`\`\`json\n${fmtParams(params)}\n\`\`\``);
      const tr = await report(ev, "TRAIN", trainSpecs, params);
      const te = await report(ev, "TEST", testSpecs, params);
      save("eval", { params, train: tr, test: te });
    } else if (cmd === "train") {
      const best = await tune(ev, trainSpecs, params, "train", frozen);
      const tr = await report(ev, "TRAIN", trainSpecs, best);
      const te = await report(ev, "TEST", testSpecs, best);
      save("train", { params: best, train: tr, test: te });
    } else if (cmd === "walkforward") {
      const first = withCandles(entries, 0, 24 * HOUR_MIN, 60);
      const later = withCandles(entries, 24 * HOUR_MIN, FULL_MIN, 60);
      say(`walk-forward: tune on hours 0–24 of ${first.length} pools (+ synthetic TRAIN), test on hours 24–72 of ${later.length} pools, each segment replayed as its own launch`);
      const wfTrain = [...poolSpecs(first, 0, 24 * HOUR_MIN), ...syntheticSpecs(SYN_TRAIN_SEEDS)];
      const wfTest = poolSpecs(later, 24 * HOUR_MIN, FULL_MIN);
      const best = await tune(ev, wfTrain, params, "walk-forward", frozen);
      const tr = await report(ev, "WALK-FORWARD TRAIN (hours 0–24)", wfTrain, best);
      const te = await report(ev, "WALK-FORWARD TEST (hours 24–72)", wfTest, best);
      save("walkforward", { params: best, train: tr, test: te });
    } else if (cmd === "robust") {
      const variants: [string, Partial<SimOptions> | undefined, number | undefined][] = [
        ["as trained (10 s polls, 0.4–1.2 s landing, 2 min fair-value half-life)", undefined, undefined],
        ["agent polls every 4 s (POLL_MS default)", { pollMs: 4_000 }, undefined],
        ["slow landing: 1.5–3 s after the re-read", { sendMsMin: 1_500, sendMsMax: 3_000 }, undefined],
        ["fair value: 30 s half-life", undefined, 30_000],
        ["fair value: 10 min half-life", undefined, 600_000],
      ];
      say(`\nTEST split under other assumptions; policy:\n\n\`\`\`json\n${fmtParams(params)}\n\`\`\`\n`);
      say("| assumption | model | v1 ΔV@VWAP % | tuned ΔV@VWAP % | objective (0 = v1) |");
      say("|---|---|---:|---:|---:|");
      const rows: Record<string, unknown> = {};
      for (const [name, sim, halfLifeMs] of variants) {
        const e = new Evaluator(pool, sim);
        const specs = testSpecs.map((s) => (s.kind === "pool" && s.model === "fair" && halfLifeMs !== undefined ? { ...s, halfLifeMs } : s));
        const [v1, tuned] = [await e.runs(specs, { kind: "v1" }), await e.runs(specs, { kind: "tuned", params })];
        const score = e.score(specs, tuned);
        rows[name] = score;
        for (const model of Object.keys(score.byModel)) {
          const dv = (runs: RunResult[]) =>
            mean(runs.flatMap((r, i) => (r.model === model ? [e.compareTo(specs[i]!, r).dvVwap] : [])));
          say(`| ${name} | ${model} | ${dv(v1).toFixed(1)} | ${dv(tuned).toFixed(1)} | ${score.score.toFixed(2)} |`);
        }
      }
      save("robust", { params, variants: rows });
    } else {
      // Model selection must not look at TEST: TRAIN is split again (same stratified rule) into FIT and VALIDATION.
      const { train: fit, test: val } = split(train);
      const fitSpecs = [...poolSpecs(fit, 0, FULL_MIN), ...syntheticSpecs(SYN_TRAIN_SEEDS.slice(0, 5))];
      const valSpecs = [...poolSpecs(val, 0, FULL_MIN), ...syntheticSpecs(SYN_TRAIN_SEEDS.slice(5))];
      say(`ablation: tune on FIT (${fit.length} pools + 5 synthetic), switch each feature off on VALIDATION (${val.length} pools + 3 synthetic); TEST untouched`);
      const tuned = flag("params") ? params : await tune(ev, fitSpecs, params, "fit", frozen);
      say("\n| switched off | FIT objective | Δ | VALIDATION objective | Δ |");
      say("|---|---:|---:|---:|---:|");
      const score = async (p: StrategyParams) => {
        const [a, b] = await Promise.all([ev.runs(fitSpecs, { kind: "tuned", params: p }), ev.runs(valSpecs, { kind: "tuned", params: p })]);
        return [ev.score(fitSpecs, a).score, ev.score(valSpecs, b).score] as const;
      };
      const [fullFit, fullVal] = await score(tuned);
      say(`| nothing (full policy) | ${fullFit.toFixed(2)} | | ${fullVal.toFixed(2)} | |`);
      const rows: Record<string, [number, number]> = {};
      for (const name of Object.keys(FEATURES).filter((f) => !frozen.includes(f))) {
        const [a, b] = await score(without(tuned, [name]));
        rows[name] = [a, b];
        say(`| ${name} | ${a.toFixed(2)} | ${(a - fullFit).toFixed(2)} | ${b.toFixed(2)} | ${(b - fullVal).toFixed(2)} |`);
      }
      save("ablate", { params: tuned, frozen, full: [fullFit, fullVal], off: rows });
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
