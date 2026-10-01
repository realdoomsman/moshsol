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
 *
 * Flags: --params <JSON object or file> (policy to evaluate/ablate/start from; default DEFAULT_PARAMS),
 * --random <n> (200) and --gens <n> (25) for training and the terms search, --freeze <feature,…> (train with
 * those features switched off, see FEATURES), --terms <JSON object or file> (terms search baseline; default
 * PRODUCTION_TERMS), --rug-budget <pp> (10: extra rug SOL loss a pick may add, pp of the starting vault SOL),
 * --reserves <bps,…> (reserve sweep), --sweep <sol,…> (guardrail base allowance sweep; 0.25,0.5,1,2,3),
 * --workers <n> (CPUs − 2).
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
  walkForward,
  type ModelStats,
} from "./evaluate";
import { mean, type Score } from "./metrics";
import { SearchSpace, cmaes, randomSearch } from "./optimize";
import { SimPool } from "./pool";
import { PRODUCTION_TERMS } from "./program";
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

/**
 * Tunes the keys of the features not in `frozen`. Frozen features are switched off (ablation / `--freeze`) or,
 * with `pin`, kept at `start`'s values (the support command tunes a few knobs around a fixed policy).
 */
async function tune(ev: Evaluator, specs: ScenarioSpec[], start: StrategyParams, label: string, frozen: string[], pin = false): Promise<StrategyParams> {
  const fitness = ev.fitness(specs);
  const fixedKeys = new Set(frozen.flatMap((f) => FEATURES[f]!.keys));
  const fix = (p: StrategyParams): StrategyParams =>
    pin ? ({ ...p, ...Object.fromEntries([...fixedKeys].map((k) => [k, start[k]])) } as StrategyParams) : without(p, frozen);
  const space = new SearchSpace(PARAM_SPACE, tunableKeys(frozen), fix(start));
  const t0 = Date.now();
  const seeds = [start, DEFAULT_PARAMS, CURRENT].map(fix);
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
    `\n${label}: ${space.keys.length} tuned parameters${frozen.length ? ` (${pin ? "pinned" : "switched off"}: ${frozen.join(", ")})` : ""}, ` +
      `${random.length} random + ${trials.length} CMA-ES evaluations, best objective ${best.score.toFixed(3)}\n`,
  );
  say("```json");
  say(fmtParams(best.params));
  say("```");
  return best.params;
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
  const { wfTrain, wfTest } = walkForward(entries, say);
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
  if (!cmd || !["eval", "train", "walkforward", "ablate", "robust", "flow", "terms", "support"].includes(cmd)) {
    throw new Error(
      "usage: backtest <eval|train|walkforward|ablate|robust|flow|terms|support> [--params <json|file>] [--terms <json|file>] [--random n] [--gens n] [--freeze f,…] [--rug-budget pp] [--reserves bps,…] [--sweep sol,…] [--workers n]",
    );
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
      const { wfTrain, wfTest } = walkForward(entries, say);
      const best = await tune(ev, wfTrain, params, "walk-forward", frozen);
      const tr = await report(ev, "WALK-FORWARD TRAIN (hours 0–24)", wfTrain, best);
      const te = await report(ev, "WALK-FORWARD TEST (hours 24–72)", wfTest, best);
      save("walkforward", { params: best, train: tr, test: te });
    } else if (cmd === "terms") {
      await termsCommand(ev, entries, trainSpecs, testSpecs);
    } else if (cmd === "support") {
      // Tuning happens on walk-forward TRAIN (every pool's first 24 h) only; TRAIN/TEST/walk-forward TEST are read-outs.
      // `--compare name=file.json,…` skips the tuning and reads out the named policies against the previous one.
      const { wfTrain, wfTest } = walkForward(entries, say);
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
      const { wfTest } = walkForward(entries, say);
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
    } else if (cmd === "robust") {
      const variants: [string, Partial<SimOptions> | undefined, Partial<Extract<ScenarioSpec, { kind: "pool" }>>][] = [
        ["as trained (10 s polls, 0.4–1.2 s landing, 2 min fair-value half-life, candle volume ×1)", undefined, {}],
        ["agent polls every 4 s (POLL_MS default)", { pollMs: 4_000 }, {}],
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
