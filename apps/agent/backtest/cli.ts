/**
 * Backtest CLI (dataset: `backtest:fetch` → apps/agent/backtest/data/):
 *
 *   pnpm --filter @holdfast/agent backtest eval         no agent / v1 / current / tuned on TRAIN and TEST
 *   pnpm --filter @holdfast/agent backtest train        random search + CMA-ES on TRAIN, then TRAIN/TEST tables
 *   pnpm --filter @holdfast/agent backtest walkforward  tune on every pool's first 24 h, test on hours 24–72
 *   pnpm --filter @holdfast/agent backtest ablate       tune on a FIT part of TRAIN, switch each feature off on the VALIDATION part
 *   pnpm --filter @holdfast/agent backtest robust       TEST split under other timing / fair-value / candle-volume assumptions
 *   pnpm --filter @holdfast/agent backtest flow         current (pre-flow) policy vs --params and vs --params with the flow knobs off
 *                                                       on TRAIN, TEST and walk-forward TEST (value, worst 10%, drawdown, rug SOL lost per
 *                                                       flow model), then the sell guardrail's base allowance at --sweep levels (SOL per window)
 *   pnpm --filter @holdfast/agent backtest terms        search the launch terms (policy fixed) on TRAIN and walk-forward,
 *                                                       Pareto view + picks out of sample, then a reserve-share sweep
 *   pnpm --filter @holdfast/agent backtest support      vault model without profit share: the previous policy vs the low-volume
 *                                                       support mode (tuned on walk-forward TRAIN) and vs support + sell ramp retuned,
 *                                                       on TRAIN, TEST and walk-forward TEST
 *   pnpm --filter @holdfast/agent backtest speed        the event-driven agent (1 s reaction): tune clip granularity, margins, base
 *                                                       sell allowance and the per-launch cooldown on walk-forward TRAIN, read out
 *                                                       candidates on walk-forward TEST and TEST (objective, worst 10% vs v1,
 *                                                       fills/h, agent share of volume), pick the most active one that passes
 *
 * Flags: --params <JSON object or file> (policy to evaluate/ablate/start from; default DEFAULT_PARAMS),
 * --random <n> (200) and --gens <n> (25) for training and the terms search, --freeze <feature,…> (train with
 * those features switched off, see FEATURES), --terms <JSON object or file> (terms search baseline; default
 * PRODUCTION_TERMS), --rug-budget <pp> (10: extra rug SOL loss a pick may add, pp of the starting vault SOL),
 * --reserves <bps,…> (reserve sweep), --sweep <sol,…> (guardrail base allowance sweep; 0.25,0.5,1,2,3),
 * --tuned <file> (speed: read a previous search result, results/speed-tuned.json, instead of searching),
 * --cooldowns <s,…> (speed: fallback spacing sweep; 5,8,10,15,20,30), --workers <n> (CPUs − 2), --venue <holdfast|pump>
 * (every scenario launches on the Holdfast curve, PRODUCTION_TERMS, by default; `pump` launches them on pump.fun with
 * PUMP_TERMS, where only agent trades sample the EMA, and suffixes the result files with `-pump`; not for `terms`).
 * Every command prints markdown and writes it plus a JSON summary to apps/agent/backtest/results/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PARAMS, PARAM_KEYS, PARAM_SPACE, withParams, type ParamKey, type StrategyParams } from "../src/strategy";
import {
  Evaluator,
  FULL_MIN,
  SYN_TEST_SEEDS,
  SYN_TRAIN_SEEDS,
  minVersus,
  modelStats,
  poolSpecs,
  split,
  statsTable,
  summary,
  syntheticSpecs,
  table,
  versus,
  walkForward,
  type ModelStats,
} from "./evaluate";
import { mean, type Score } from "./metrics";
import { SearchSpace, cmaes, randomSearch, type Fitness } from "./optimize";
import { SimPool } from "./pool";
import { PRODUCTION_TERMS, PUMP_TERMS, type SimTerms } from "./program";
import { loadIndex, type PoolEntry, type ScenarioSpec } from "./scenarios";
import { mulberry32, type Policy, type RunResult, type SimOptions } from "./sim";
import {
  RULE_DOC,
  RULES,
  fmt,
  fmtTerms,
  measure,
  parseTerms,
  pareto,
  pick,
  roundTerms,
  searchTerms,
  termsPoint,
  termsTable,
  vsReserve,
  worst,
  type Measured,
  type TermsPoint,
} from "./terms";

/** Policy features that can be switched off (for ablation, and frozen out of training with `--freeze`). */
const FEATURES: Record<string, { off: Partial<StrategyParams>; keys: ParamKey[] }> = {
  margins: { off: { buyMarginBps: 25, sellMarginBps: 25 }, keys: ["buyMarginBps", "sellMarginBps"] },
  floor: { off: { holdSlope: PARAM_SPACE.holdSlope.hi }, keys: ["holdSlope"] },
  sellflow: { off: { sellFlowBps: 0 }, keys: ["sellFlowBps"] },
  thin: { off: { sellThinRatio: 0 }, keys: ["sellThinRatio"] },
  dump: { off: { buyDumpShare: 1 }, keys: ["buyDumpShare"] },
  climax: { off: { buyClimaxBps: 0 }, keys: ["buyClimaxBps"] },
  vwap: { off: { vwapEntryBps: 0 }, keys: ["vwapEntryBps"] },
  guardrail: { off: { fullMcapMult: 1, fullVolumeSol: 1 }, keys: ["baseSellSol", "fullMcapMult", "fullVolumeSol", "rampShape"] },
  strong: { off: { strongFlowMult: 1 }, keys: ["strongVolumeRatio", "strongFlowMult"] },
  support: { off: { supportVolumeMult: 0 }, keys: ["supportVolumeMult", "supportClipShare", "supportSpacingSecs"] },
};

/** The features that read the flow window (the sell guardrail's `strong` multiplier is part of the guardrail). */
const FLOW_FEATURES = ["sellflow", "thin", "dump", "climax", "vwap"];

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

/** The policy shipped before the flow features and the sell guardrail: 25 bps margins, no inventory floor, nothing else. */
const CURRENT: StrategyParams = without(DEFAULT_PARAMS, Object.keys(FEATURES));

/**
 * The policy shipped under the profit-share model (`backtest flow`): v1's entry, the 1 SOL guardrail with the
 * trained ramp, no support mode. Reference of the `support` command.
 */
const PREVIOUS: StrategyParams = {
  ...CURRENT,
  baseSellSol: 1,
  fullMcapMult: 17.6,
  fullVolumeSol: 1387,
  rampShape: 2.15,
  strongVolumeRatio: 1.39,
  strongFlowMult: 6.63,
};

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

/** `--venue pump`: the launch terms every scenario runs under instead of the default Holdfast-curve PRODUCTION_TERMS. */
function venueFlag(): SimTerms | null {
  const v = flag("venue");
  if (v === undefined || v === "holdfast") return null;
  if (v === "pump") return PUMP_TERMS;
  throw new Error(`--venue must be holdfast or pump, got ${v}`);
}

const VENUE = venueFlag();
/** Result file suffix of the venue run. */
const VENUE_SUFFIX = VENUE ? `-${VENUE.venue}` : "";

function onVenue(specs: ScenarioSpec[]): ScenarioSpec[] {
  return VENUE ? specs.map((s) => ({ ...s, launch: { ...s.launch, terms: VENUE } })) : specs;
}

/** `walkForward` on the `--venue` terms. */
function walkForwardSpecs(entries: PoolEntry[]): { wfTrain: ScenarioSpec[]; wfTest: ScenarioSpec[] } {
  const { wfTrain, wfTest } = walkForward(entries, say);
  return { wfTrain: onVenue(wfTrain), wfTest: onVenue(wfTest) };
}

const fmtParams = (p: StrategyParams) =>
  JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Number(v.toPrecision(4))])), null, 2);

const out: string[] = [];
function say(line = ""): void {
  console.log(line);
  out.push(line);
}

function save(name: string, summary: unknown): void {
  const file = `${name}${VENUE_SUFFIX}`;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${file}.md`), `${out.join("\n")}\n`);
  fs.writeFileSync(path.join(RESULTS_DIR, `${file}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(process.cwd(), path.join(RESULTS_DIR, file))}.{md,json}`);
}

async function report(ev: Evaluator, label: string, specs: ScenarioSpec[], params: StrategyParams) {
  const policies: [string, Policy][] = [
    ["none", { kind: "none" }],
    ["v1", { kind: "v1" }],
    ["current", { kind: "tuned", params: CURRENT }],
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
    `objective (0 = v1): ${Object.entries(scores)
      .map(([k, s]) => `${k} ${s.score.toFixed(2)} (${Object.entries(s.byModel).map(([m, v]) => `${m} ${v.toFixed(2)}`).join(", ")})`)
      .join(" · ")}\n`,
  );
  say(summary(ev, specs, "current", byPolicy.current!, "tuned", byPolicy.tuned!));
  say();
  say(statsTable(["current", "tuned", "v1"].map((k) => [k, modelStats(ev, specs, byPolicy[k]!)])));
  say("\n<details><summary>all metrics</summary>\n");
  say(table(ev, specs, byPolicy));
  say("\n</details>");
  return scores;
}

/** Per-model stats of each named policy on `specs`, printed as one table; the first entry is the reference. */
async function compareNamed(ev: Evaluator, label: string, specs: ScenarioSpec[], named: [string, StrategyParams][]) {
  const rows: [string, Record<string, ModelStats>][] = [];
  for (const [name, p] of named) {
    rows.push([name, modelStats(ev, specs, await ev.runs(specs, { kind: "tuned", params: p }))]);
  }
  say(`\n### ${label}\n`);
  say(statsTable(rows));
  return Object.fromEntries(rows);
}

/** `compareNamed` with the pre-flow policy as the reference. */
function compareCurrent(ev: Evaluator, label: string, specs: ScenarioSpec[], named: [string, StrategyParams][]) {
  return compareNamed(ev, label, specs, [["current", CURRENT], ...named]);
}

/** Seeded random search (`--random`), then CMA-ES (`--gens`) from its best point; the best trial and the evaluation counts. */
async function search<K extends string, P extends Record<K, number>>(space: SearchSpace<K, P>, seeds: P[], fitness: Fitness<P>, label: string) {
  const t0 = Date.now();
  const random = await randomSearch(space, intFlag("random", 200), seeds, fitness, mulberry32(7));
  console.log(`[${label}] random search: best ${random[0]!.score.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const trials = await cmaes(space, random[0]!.params, fitness, {
    sigma: 0.2,
    generations: intFlag("gens", 25),
    seed: 11,
    onGeneration: (g, best, sigma) =>
      console.log(`[${label}] CMA-ES gen ${g + 1}: best ${best.score.toFixed(3)} σ ${sigma.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
  });
  const best = trials[0] && trials[0].score >= random[0]!.score ? trials[0] : random[0]!;
  return { best, random: random.length, cma: trials.length };
}

/**
 * Tunes the keys of the features not in `frozen`. Frozen features are switched off (ablation / `--freeze`) or,
 * with `pin`, kept at `start`'s values (the support command tunes a few knobs around a fixed policy).
 */
async function tune(ev: Evaluator, specs: ScenarioSpec[], start: StrategyParams, label: string, frozen: string[], pin = false): Promise<StrategyParams> {
  const fixedKeys = new Set(frozen.flatMap((f) => FEATURES[f]!.keys));
  const fix = (p: StrategyParams): StrategyParams =>
    pin ? ({ ...p, ...Object.fromEntries([...fixedKeys].map((k) => [k, start[k]])) } as StrategyParams) : without(p, frozen);
  const space = new SearchSpace(PARAM_SPACE, tunableKeys(frozen), fix(start));
  const { best, random, cma } = await search(space, [start, DEFAULT_PARAMS, CURRENT].map(fix), ev.fitness(specs), label);
  say(
    `\n${label}: ${space.keys.length} tuned parameters${frozen.length ? ` (${pin ? "pinned" : "switched off"}: ${frozen.join(", ")})` : ""}, ` +
      `${random} random + ${cma} CMA-ES evaluations, best objective ${best.score.toFixed(3)}\n`,
  );
  say("```json");
  say(fmtParams(best.params));
  say("```");
  return best.params;
}

/** The event-driven agent (SUBSCRIBE): decides ~0.3 s after a trade lands (1 s is the sim's chain-time grain; `rereadMs` = DEBOUNCE_MS). */
const EVENT_SIM = { pollMs: 1_000, rereadMs: 150 } satisfies Partial<SimOptions>;

/** Per-launch spacing between agent trades (`COOLDOWN_MS`, s) the speed search picks from. */
const COOLDOWN_GRID = [0, 1, 2, 3, 5, 8, 10, 15, 20, 30];

/** Policy knobs the speed search tunes: clip granularity, entry margins and the sell guardrail's base allowance. */
const SPEED_KEYS: ParamKey[] = ["buyClipShare", "sellClipShare", "clipSpacingSecs", "buyMarginBps", "sellMarginBps", "baseSellSol"];

/** Objective at least this on both held-out splits (the policy's as-trained level at 10 s polls / 15 s cooldown). */
const SPEED_GATE = 0.39;

/** A speed-search point: the policy plus the cooldown as an index into COOLDOWN_GRID. */
type Timed = StrategyParams & { cooldown: number };

interface Paced {
  params: StrategyParams;
  /** Cooldown at the event-driven timing; undefined = DEFAULT_SIM (the timing the policy was trained at). */
  cooldownMs?: number;
}

function untimed({ cooldown, ...params }: Timed): Paced {
  return { params, cooldownMs: COOLDOWN_GRID[cooldown]! * 1_000 };
}

/**
 * `backtest speed`: the policy at the event-driven timing. Tunes SPEED_KEYS and the per-launch cooldown on walk-forward
 * TRAIN only (`--tuned <file>` reads a previous result instead), then reads out every candidate on walk-forward TEST and
 * TEST: the objective (0 = v1 at the same timing), worst 10% vs v1, trades per hour and the agent's share of volume.
 * Selection: the most active candidate with objective ≥ SPEED_GATE on both splits and no model's worst 10% below v1's;
 * if none, the smallest `--cooldowns` spacing of `--params` that clears SPEED_GATE on both.
 */
async function speedCommand(pool: SimPool, entries: PoolEntry[], testSpecs: ScenarioSpec[], params: StrategyParams) {
  const evaluators = new Map<number | undefined, Evaluator>();
  const at = (cooldownMs?: number): Evaluator => {
    let ev = evaluators.get(cooldownMs);
    if (!ev) evaluators.set(cooldownMs, (ev = new Evaluator(pool, cooldownMs === undefined ? undefined : { ...EVENT_SIM, cooldownMs })));
    return ev;
  };
  const { wfTrain, wfTest } = walkForwardSpecs(entries);
  const tunedFile = flag("tuned");
  let tuned: Paced;
  if (tunedFile) {
    const parsed = JSON.parse(fs.readFileSync(tunedFile, "utf8")) as { params: Record<string, unknown>; cooldownMs: number };
    tuned = { params: withParams(DEFAULT_PARAMS, parsed.params), cooldownMs: parsed.cooldownMs };
  } else {
    const start: Timed = { ...params, cooldown: COOLDOWN_GRID.indexOf(3) };
    const space = new SearchSpace<ParamKey | "cooldown", Timed>(
      { ...PARAM_SPACE, cooldown: { lo: 0, hi: COOLDOWN_GRID.length - 1, int: true } },
      [...SPEED_KEYS, "cooldown"],
      start,
    );
    // One evaluator per cooldown (v1 runs at the same timing); the batch is queued at once across them.
    const fitness: Fitness<Timed> = async (batch) => {
      const scores: number[] = [];
      const groups = new Map<number, number[]>();
      batch.forEach((t, i) => groups.set(t.cooldown, [...(groups.get(t.cooldown) ?? []), i]));
      await Promise.all(
        [...groups].map(async ([cooldown, idx]) => {
          const s = await at(COOLDOWN_GRID[cooldown]! * 1_000).fitness(wfTrain)(idx.map((i) => untimed(batch[i]!).params));
          idx.forEach((i, j) => (scores[i] = s[j]!));
        }),
      );
      return scores;
    };
    const seeds: Timed[] = [
      start,
      { ...start, buyClipShare: 0.25, sellClipShare: 0.25 },
      { ...start, cooldown: COOLDOWN_GRID.indexOf(15) },
    ];
    const { best, random, cma } = await search(space, seeds, fitness, "speed (walk-forward TRAIN)");
    tuned = untimed(best.params);
    say(
      `\nspeed search on walk-forward TRAIN at the event-driven timing: ${SPEED_KEYS.join(", ")} + cooldown (${COOLDOWN_GRID.join("/")} s), ` +
        `${random} random + ${cma} CMA-ES evaluations, best objective ${best.score.toFixed(3)} at ${tuned.cooldownMs! / 1_000} s cooldown\n`,
    );
    say(`\`\`\`json\n${fmtParams(tuned.params)}\n\`\`\``);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, `speed${VENUE_SUFFIX}-tuned.json`), `${JSON.stringify(tuned, null, 2)}\n`);
  }

  const splits: [string, ScenarioSpec[]][] = [
    ["WF TEST", wfTest],
    ["TEST", testSpecs],
  ];
  const ref = at(3_000);
  const refV1 = await Promise.all(splits.map(async ([, specs]) => modelStats(ref, specs, await ref.runs(specs, { kind: "v1" }))));
  const fmtModels = (stats: Record<string, ModelStats>, pick: (s: ModelStats) => number, d = 1) =>
    Object.values(stats)
      .map((s) => pick(s).toFixed(d))
      .join(" / ");
  const overall = (stats: Record<string, ModelStats>, pick: (s: ModelStats) => number) => {
    const all = Object.values(stats);
    return all.reduce((sum, s) => sum + pick(s) * s.n, 0) / all.reduce((sum, s) => sum + s.n, 0);
  };
  interface Row {
    name: string;
    paced: Paced;
    objective: number[];
    vsV1At3s: number[];
    tailOk: boolean;
    tradesPerHour: number;
    stats: Record<string, ModelStats>[];
    v1: Record<string, ModelStats>[];
  }
  const rows: Row[] = [];
  say(`\nheld-out read-out at the event-driven timing (${EVENT_SIM.pollMs / 1_000} s polls, ${EVENT_SIM.rereadMs} ms re-read); per split: objective (0 = v1 at the same timing) and vs v1 at 1 s / 3 s,`);
  say("ΔV@VWAP mean and worst-10% ΔV % per model (exo / fair / synthetic) with v1's worst 10% at the same timing, agent fills per hour, agent share of traded SOL %\n");
  say("| candidate | cooldown | split | objective | vs v1 @ 3 s | ΔV@VWAP mean % | worst-10% ΔV % | v1 worst-10% % | fills / h | agent share of volume % |");
  say("|---|---:|---|---:|---:|---|---|---|---:|---:|");
  const read = async (name: string, paced: Paced): Promise<Row> => {
    const ev = at(paced.cooldownMs);
    const row: Row = { name, paced, objective: [], vsV1At3s: [], tailOk: true, tradesPerHour: 0, stats: [], v1: [] };
    for (const [i, [label, specs]] of splits.entries()) {
      const runs = await ev.runs(specs, { kind: "tuned", params: paced.params });
      const stats = modelStats(ev, specs, runs);
      const v1 = modelStats(ev, specs, await ev.runs(specs, { kind: "v1" }));
      row.objective.push(ev.score(specs, runs).score);
      row.vsV1At3s.push(versus(stats, refV1[i]!));
      row.tailOk &&= Object.keys(stats).every((m) => stats[m]!.dvTail >= v1[m]!.dvTail);
      row.tradesPerHour += overall(stats, (s) => s.tradesPerHour) / splits.length;
      row.stats.push(stats);
      row.v1.push(v1);
      say(
        `| ${i === 0 ? name : ""} | ${paced.cooldownMs === undefined ? "as trained" : `${paced.cooldownMs / 1_000} s`} | ${label} | ${row.objective[i]!.toFixed(3)} | ${row.vsV1At3s[i]!.toFixed(3)} | ` +
          `${fmtModels(stats, (s) => s.dvMean)} | ${fmtModels(stats, (s) => s.dvTail)} | ${fmtModels(v1, (s) => s.dvTail)} | ` +
          `${overall(stats, (s) => s.tradesPerHour).toFixed(2)} | ${overall(stats, (s) => s.volumeShare).toFixed(2)} |`,
      );
    }
    rows.push(row);
    return row;
  };
  const passes = (r: Row) => r.objective.every((o) => o >= SPEED_GATE);

  await read("as trained: --params at 10 s polls, 15 s cooldown", { params });
  const named: [string, StrategyParams][] = [
    ["--params", params],
    ["clips ≤ 50%", withParams(params, { buyClipShare: 0.5, sellClipShare: 0.5 })],
    ["clips ≤ 25%", withParams(params, { buyClipShare: 0.25, sellClipShare: 0.25 })],
    ["clips ≤ 10%", withParams(params, { buyClipShare: 0.1, sellClipShare: 0.1 })],
    ["clips ≤ 25%, ≥ 15 s apart", withParams(params, { buyClipShare: 0.25, sellClipShare: 0.25, clipSpacingSecs: 15 })],
    ["clips ≤ 25%, ≥ 60 s apart", withParams(params, { buyClipShare: 0.25, sellClipShare: 0.25, clipSpacingSecs: 60 })],
  ];
  const candidates: Row[] = [];
  for (const [name, p] of named) candidates.push(await read(name, { params: p, cooldownMs: 3_000 }));
  candidates.push(await read("tuned (walk-forward TRAIN)", tuned));
  const eligible = candidates.filter((r) => passes(r) && r.tailOk).sort((a, b) => b.tradesPerHour - a.tradesPerHour);

  // Fallback: --params with a longer per-launch spacing, smallest first, up to the first that clears the gate.
  const cooldowns = (flag("cooldowns") ?? "5,8,10,15,20,30").split(",").map((s) => Number(s.trim()) * 1_000);
  let fallback: Row | undefined;
  for (const cooldownMs of cooldowns) {
    const r = await read("--params, longer cooldown", { params, cooldownMs });
    if (passes(r)) {
      fallback = r;
      break;
    }
  }
  const best = (rs: Row[]) => rs.reduce((a, r) => (Math.min(...r.objective) > Math.min(...a.objective) ? r : a));
  const pick = eligible[0] ?? fallback ?? best(rows.filter((r) => r.paced.cooldownMs !== undefined));
  say(
    `\nselected: ${pick.name} at ${pick.paced.cooldownMs! / 1_000} s cooldown — ` +
      (eligible[0]
        ? `the most active candidate (${pick.tradesPerHour.toFixed(2)} fills/h) with objective ≥ ${SPEED_GATE} on both held-out splits and no worst 10% below v1's`
        : fallback
          ? `no candidate cleared the gate with v1's worst 10% kept; the smallest per-launch spacing that restores objective ≥ ${SPEED_GATE} on both held-out splits`
          : `GATE FAILED: nothing reached ${SPEED_GATE} on both held-out splits; highest held-out minimum`),
  );
  say(`\`\`\`json\n${fmtParams(pick.paced.params)}\n\`\`\``);
  save("speed", {
    tuned,
    selected: { name: pick.name, ...pick.paced, eligible: eligible.length > 0, fallback: !eligible[0] && fallback !== undefined },
    rows: rows.map(({ name, paced, objective, vsV1At3s, tailOk, tradesPerHour, stats, v1 }) => ({ name, ...paced, objective, vsV1At3s, tailOk, tradesPerHour, stats, v1 })),
  });
}

function termsFlag(): TermsPoint {
  const base = termsPoint(PRODUCTION_TERMS);
  const v = flag("terms");
  if (v === undefined) return base;
  return parseTerms(base, JSON.parse(fs.existsSync(v) ? fs.readFileSync(v, "utf8") : v) as Record<string, unknown>);
}

/** Wizard default reserve share (apps/web/src/components/create/validate.ts INITIAL_DRAFT): the reserve sweep's reference. */
const DEFAULT_RESERVE_BPS = 3_000n;

async function termsCommand(ev: Evaluator, entries: PoolEntry[], trainSpecs: ScenarioSpec[], testSpecs: ScenarioSpec[]) {
  const baseTerms = termsFlag();
  const budget = intFlag("rug-budget", 10);
  const [random, gens] = [intFlag("random", 200), intFlag("gens", 25)];
  say(`\nbaseline: ${fmtTerms(baseTerms)} (bps, per window); policy fixed at DEFAULT_PARAMS; launch reserve drawn from 20–50% as in every other command.`);
  say(`every statistic is taken at its worst flow model; ΔV is vault value (plus agent profit paid to backers) vs no agent under the same terms (VWAP mark); rug budget: rug SOL lost ≤ baseline + ${budget} pp of the starting vault SOL.`);
  say(`picks, rounded to 25 bps (band, impact), 50 bps (caps) and 5 min (window, EMA) and measured again:\n`);
  for (const rule of RULES) say(`- **${rule}**: ${RULE_DOC[rule]}`);
  const { wfTrain, wfTest } = walkForwardSpecs(entries);
  const phases = [
    { name: "split", tuneLabel: "TRAIN", testLabel: "TEST", tune: trainSpecs, test: testSpecs },
    { name: "walk-forward", tuneLabel: "WALK-FORWARD TRAIN (hours 0–24)", testLabel: "WALK-FORWARD TEST (hours 24–72)", tune: wfTrain, test: wfTest },
  ];
  const results: Record<string, { tune: [string, Measured][]; test: [string, Measured][] }> = {};
  for (const ph of phases) {
    const base = (await measure(ev, ph.tune, baseTerms)).measured;
    const trials = await searchTerms(ev, ph.tune, base, { random, gens, label: ph.name });
    const front = pareto(trials);
    say(`\n### ${ph.tuneLabel}: Pareto front (worst-model median ΔV ↑, worst-10% ΔV ↑, drawdown cut ↑, rug loss ↓) of ${trials.length} searched points\n`);
    const frontRows = front.slice(0, 15).map((m, i): [string, Measured] => [`front ${i + 1}${fmtTerms(m.terms) === fmtTerms(baseTerms) ? " (= baseline)" : ""}`, m]);
    say(termsTable([["baseline", base], ...frontRows], base));
    const raw = pick(trials, base, budget);
    const tune: [string, Measured][] = [["baseline", base]];
    for (const rule of RULES) {
      const p = raw[rule];
      if (p) tune.push([rule, (await measure(ev, ph.tune, roundTerms(p.terms))).measured]);
      else say(`\n${ph.tuneLabel}: no point qualifies as ${rule}`);
    }
    const testBase = (await measure(ev, ph.test, baseTerms)).measured;
    const test: [string, Measured][] = [["baseline", testBase]];
    for (const [rule, m] of tune.slice(1)) test.push([rule, (await measure(ev, ph.test, m.terms)).measured]);
    say(`\n### ${ph.tuneLabel}: baseline and picks\n`);
    say(termsTable(tune, base));
    say(`\n### ${ph.testLabel} (out of sample)\n`);
    say(termsTable(test, testBase));
    results[ph.name] = { tune, test };
  }

  const passes = (rows: [string, Measured][], rule: string) => {
    const m = rows.find(([r]) => r === rule)?.[1];
    if (!m) return false;
    const [w, b] = [worst(m), worst(rows[0]![1])];
    return w.dvMedian > b.dvMedian && w.rugLoss <= b.rugLoss + budget;
  };
  const winner = RULES.find((rule) => Object.values(results).every((r) => passes(r.tune, rule) && passes(r.test, rule)));
  say("\n### Value rule (beats the baseline's worst-model median ΔV out of sample within the rug budget)\n");
  let chosen = baseTerms;
  if (!winner) {
    say("No pick beats the baseline's worst-model median ΔV within the rug budget in both TEST and walk-forward TEST: keep the current terms.");
  } else {
    chosen = results.split!.tune.find(([r]) => r === winner)![1].terms;
    say(`**${winner}** (the TRAIN pick; its walk-forward counterpart also beats the baseline out of sample): ${fmtTerms(chosen)}\n`);
    for (const [name, r] of Object.entries(results)) {
      const [w, b] = [worst(r.test.find(([x]) => x === winner)![1]), worst(r.test[0]![1])];
      say(
        `- ${name} test vs baseline: median ΔV ${fmt(b.dvMedian)} → ${fmt(w.dvMedian)} %, mean ΔV ${fmt(b.dvMean)} → ${fmt(w.dvMean)} %, worst-10% ΔV ${fmt(b.dvTail)} → ${fmt(w.dvTail)} %, ` +
          `DD cut ${fmt(b.ddCut, 2)} → ${fmt(w.ddCut, 2)} pp, vol× ${fmt(b.volRatio, 3)} → ${fmt(w.volRatio, 3)}, in-band gain ${fmt(b.inBandGain)} → ${fmt(w.inBandGain)} pp, ` +
          `rug SOL lost ${fmt(b.rugLoss)} → ${fmt(w.rugLoss)} % (worst 10%: ${fmt(b.rugTail)} → ${fmt(w.rugTail)} %)`,
      );
    }
  }

  // Reserve share: the same launches with a fixed reserve instead of the 20–50% draw, one share at a time
  // (each share replays its own no-agent recordings; the workers keep one share's worth).
  const reserves = (flag("reserves") ?? "1000,2000,3000,4000,5000,6000").split(",").map((s) => BigInt(s.trim()));
  const termSets: [string, TermsPoint][] = winner ? [["baseline", baseTerms], [winner, chosen]] : [["baseline", baseTerms]];
  const splits: [string, ScenarioSpec[]][] = [["TRAIN", trainSpecs], ["TEST", testSpecs]];
  const ref: Record<string, RunResult[]> = {};
  for (const [name, terms] of termSets) for (const [s, specs] of splits) ref[`${name}|${s}`] = (await measure(ev, specs, terms, DEFAULT_RESERVE_BPS)).runs;
  say(`\n### Reserve share (fixed for every launch; value vs the same terms at the wizard default ${Number(DEFAULT_RESERVE_BPS) / 100}%)\n`);
  say("The bundle stops at its supply cap and leaves the rest of its budget in the vault, so the share only changes launches whose bundle budget is below the cap's cost (\"launches changed\").\n");
  say("| terms | split | reserve % | launches changed % | ΔV@VWAP % median vs no agent, min | DD cut pp | vol× | rug SOL lost % mean / worst 10% | vault value vs 30% reserve %, median min (per model) |");
  say("|---|---|---:|---:|---:|---:|---:|---|---|");
  const reserveRows: Record<string, unknown>[] = [];
  for (const r of reserves) {
    for (const [name, terms] of termSets) {
      for (const [s, specs] of splits) {
        const { measured, runs } = await measure(ev, specs, terms, r);
        const w = worst(measured);
        const refRuns = ref[`${name}|${s}`]!;
        const vs = vsReserve(runs, refRuns);
        const changed = (runs.filter((x, i) => x.sol0 !== refRuns[i]!.sol0).length / runs.length) * 100;
        say(
          `| ${name} | ${s} | ${Number(r) / 100} | ${fmt(changed, 0)} | ${fmt(w.dvMedian)} | ${fmt(w.ddCut, 2)} | ${fmt(w.volRatio, 3)} | ${fmt(w.rugLoss)} / ${fmt(w.rugTail)} | ` +
            `${fmt(Math.min(...Object.values(vs)))} (${Object.entries(vs).map(([m, v]) => `${m} ${fmt(v)}`).join(", ")}) |`,
        );
        reserveRows.push({ terms: name, split: s, reserveBps: Number(r), changedPct: changed, worst: w, vsDefaultReserve: vs });
      }
    }
  }
  save("terms", { baseline: baseTerms, rugBudgetPp: budget, winner: winner ?? null, chosen, results, reserve: reserveRows });
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || !["eval", "train", "walkforward", "ablate", "robust", "flow", "terms", "support", "speed"].includes(cmd)) {
    throw new Error(
      "usage: backtest <eval|train|walkforward|ablate|robust|flow|terms|support|speed> [--params <json|file>] [--terms <json|file>] [--random n] [--gens n] [--freeze f,…] [--rug-budget pp] [--reserves bps,…] [--sweep sol,…] [--tuned file] [--cooldowns s,…] [--workers n]",
    );
  }
  const entries = loadIndex();
  const { train, test } = split(entries);
  const tags = (es: PoolEntry[]) => Object.entries(es.reduce<Record<string, number>>((a, e) => ({ ...a, [e.tag]: (a[e.tag] ?? 0) + 1 }), {}));
  say(`# backtest ${cmd}${VENUE ? ` (venue ${VENUE.venue}: every scenario launches with PUMP_TERMS)` : ""}\n`);
  if (VENUE && cmd === "terms") throw new Error("--venue: the terms search builds its terms from PRODUCTION_TERMS (Holdfast curve)");
  say(`dataset: ${entries.length} pools; TRAIN ${train.length} (${tags(train).map(([t, n]) => `${t} ${n}`).join(", ")}), TEST ${test.length} (${tags(test).map(([t, n]) => `${t} ${n}`).join(", ")}); synthetic ${SYN_TRAIN_SEEDS.length}+${SYN_TEST_SEEDS.length} × 24 h`);
  const pool = new SimPool(flag("workers") ? intFlag("workers", 1) : undefined);
  const ev = new Evaluator(pool);
  const trainSpecs = onVenue([...poolSpecs(train, 0, FULL_MIN), ...syntheticSpecs(SYN_TRAIN_SEEDS)]);
  const testSpecs = onVenue([...poolSpecs(test, 0, FULL_MIN), ...syntheticSpecs(SYN_TEST_SEEDS)]);
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
      const { wfTrain, wfTest } = walkForwardSpecs(entries);
      const best = await tune(ev, wfTrain, params, "walk-forward", frozen);
      const tr = await report(ev, "WALK-FORWARD TRAIN (hours 0–24)", wfTrain, best);
      const te = await report(ev, "WALK-FORWARD TEST (hours 24–72)", wfTest, best);
      save("walkforward", { params: best, train: tr, test: te });
    } else if (cmd === "terms") {
      await termsCommand(ev, entries, trainSpecs, testSpecs);
    } else if (cmd === "support") {
      // Tuning happens on walk-forward TRAIN (every pool's first 24 h) only; TRAIN/TEST/walk-forward TEST are read-outs.
      // `--compare name=file.json,…` skips the tuning and reads out the named policies against the previous one.
      const { wfTrain, wfTest } = walkForwardSpecs(entries);
      say(`\nprevious policy (profit-share era defaults):\n\n\`\`\`json\n${fmtParams(PREVIOUS)}\n\`\`\``);
      const named: [string, StrategyParams][] = [["previous", PREVIOUS]];
      const compareFlag = flag("compare");
      if (compareFlag) {
        for (const entry of compareFlag.split(",")) {
          const [name, file] = entry.split("=") as [string, string];
          const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
          const p = withParams(DEFAULT_PARAMS, (parsed.params as Record<string, unknown> | undefined) ?? parsed);
          say(`\n${name}:\n\n\`\`\`json\n${fmtParams(p)}\n\`\`\``);
          named.push([name, p]);
        }
      } else {
        const allButSupport = Object.keys(FEATURES).filter((f) => f !== "support");
        const allButSells = allButSupport.filter((f) => f !== "guardrail" && f !== "strong");
        const supportOnly = await tune(ev, wfTrain, { ...PREVIOUS, ...params }, "support knobs (walk-forward TRAIN)", allButSupport, true);
        const supportRamp = await tune(ev, wfTrain, supportOnly, "support + sell ramp (walk-forward TRAIN)", allButSells, true);
        named.push(["support", supportOnly], ["support + ramp", supportRamp]);
      }
      const splits: [string, ScenarioSpec[]][] = [
        ["WALK-FORWARD TRAIN (hours 0–24, in-sample)", wfTrain],
        ["WALK-FORWARD TEST (hours 24–72)", wfTest],
        ["TRAIN (72 h)", trainSpecs],
        ["TEST (72 h)", testSpecs],
      ];
      const compared: Record<string, unknown> = {};
      for (const [label, specs] of splits) compared[label] = await compareNamed(ev, label, specs, named);
      save(compareFlag ? "support-compare" : "support", { policies: Object.fromEntries(named), compared });
    } else if (cmd === "flow") {
      say(`\npolicy:\n\n\`\`\`json\n${fmtParams(params)}\n\`\`\``);
      const { wfTest } = walkForwardSpecs(entries);
      const splits: [string, ScenarioSpec[]][] = [
        ["TRAIN", trainSpecs],
        ["TEST", testSpecs],
        ["WALK-FORWARD TEST (hours 24–72)", wfTest],
      ];
      // "flow off" keeps the tuned margins, floor and guardrail: the flow knobs' own contribution.
      const compared: Record<string, unknown> = {};
      for (const [label, specs] of splits) {
        compared[label] = await compareCurrent(ev, label, specs, [
          ["tuned", params],
          ["tuned, flow off", without(params, FLOW_FEATURES)],
        ]);
      }
      // The owner's guardrail at several base levels (the ramp knobs stay as tuned).
      const sweepLevels = (flag("sweep") ?? "0.25,0.5,1,2,3").split(",").map((s) => {
        const n = Number(s.trim());
        if (!(n > 0)) throw new Error(`--sweep: levels must be positive SOL amounts, got "${s}"`);
        return n;
      });
      say(`\n## Sell guardrail: cost / benefit of the base allowance (SOL per window near the launch price; ramp as tuned)\n`);
      const levels: [string, StrategyParams][] = [
        ["no guardrail", without(params, ["guardrail"])],
        ...sweepLevels.map((sol): [string, StrategyParams] => [`${sol} SOL / window`, withParams(params, { baseSellSol: sol })]),
        ["tuned", params],
      ];
      const sweep: Record<string, unknown> = {};
      for (const [label, specs] of splits) sweep[label] = await compareCurrent(ev, `guardrail — ${label}`, specs, levels);
      save("flow", { params, compared, sweep });
    } else if (cmd === "speed") {
      await speedCommand(pool, entries, testSpecs, params);
    } else if (cmd === "robust") {
      const variants: [string, Partial<SimOptions> | undefined, Partial<Extract<ScenarioSpec, { kind: "pool" }>>][] = [
        ["as trained (10 s polls, 0.4–1.2 s landing, 2 min fair-value half-life, candle volume ×1)", undefined, {}],
        ["agent polls every 4 s (POLL_MS default with SUBSCRIBE=0)", { pollMs: 4_000 }, {}],
        ["event-driven agent: ~1 s reaction, 3 s cooldown", { ...EVENT_SIM, cooldownMs: 3_000 }, {}],
        ["slow landing: 1.5–3 s after the re-read", { sendMsMin: 1_500, sendMsMax: 3_000 }, {}],
        ["fair value: 30 s half-life", undefined, { halfLifeMs: 30_000 }],
        ["fair value: 10 min half-life", undefined, { halfLifeMs: 600_000 }],
        ["candle volume ×0.25 (flow imbalances 4× stronger)", undefined, { volumeScale: 0.25 }],
        ["candle volume ×4 (flow imbalances 4× weaker)", undefined, { volumeScale: 4 }],
      ];
      say(`\nTEST split under other assumptions; policy:\n\n\`\`\`json\n${fmtParams(params)}\n\`\`\`\n`);
      say("| assumption | model | current ΔV@VWAP % | tuned ΔV@VWAP % | objective (0 = v1) current / tuned | min over models tuned vs current |");
      say("|---|---|---:|---:|---|---:|");
      const rows: Record<string, unknown> = {};
      for (const [name, sim, poolSpec] of variants) {
        const e = new Evaluator(pool, sim);
        const specs = testSpecs.map((s) => {
          if (s.kind !== "pool") return s;
          // The half-life only exists in the fair-value model; the volume scale applies to both history models.
          const { halfLifeMs, ...rest } = poolSpec;
          return { ...s, ...rest, ...(s.model === "fair" && halfLifeMs !== undefined ? { halfLifeMs } : {}) };
        });
        const [current, tuned] = [await e.runs(specs, { kind: "tuned", params: CURRENT }), await e.runs(specs, { kind: "tuned", params })];
        const [sc, st] = [e.score(specs, current), e.score(specs, tuned)];
        const [mc, mt] = [modelStats(e, specs, current), modelStats(e, specs, tuned)];
        rows[name] = { current: sc, tuned: st, minVersusCurrent: minVersus(mt, mc) };
        for (const model of Object.keys(st.byModel)) {
          say(`| ${name} | ${model} | ${mc[model]!.dvMean.toFixed(1)} | ${mt[model]!.dvMean.toFixed(1)} | ${sc.score.toFixed(2)} / ${st.score.toFixed(2)} | ${minVersus(mt, mc).toFixed(3)} |`);
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
