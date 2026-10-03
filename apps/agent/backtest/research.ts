import fs from "node:fs";
import path from "node:path";
import type { ResearchInput, ResearchMetrics } from "../src/research";
import { DEFAULT_PARAMS, PARAM_KEYS, PARAM_SPACE, type StrategyParams } from "../src/strategy";
import { Evaluator, walkForward } from "./evaluate";
import { HOLDFAST_PREFIX, fetchDataset, type IndexEntry } from "./fetch";
import { HOLDFAST_SOURCE, mergeIndex } from "./holdfast";
import { SearchSpace, cmaes, randomSearch } from "./optimize";
import { SimPool } from "./pool";
import { DATA_DIR, loadIndex } from "./scenarios";
import { mulberry32 } from "./sim";

/**
 * One research run of the agent's policy parameters (the `research-run.ts` child the agent spawns):
 * tune from `current` on the walk-forward TRAIN segments (every pool's hours 0–24 + synthetic
 * TRAIN), then score `current` and the proposal on TRAIN and on the walk-forward TEST segments
 * (hours 24–72) with the backtest objective. The caller decides whether to adopt.
 */

export interface ResearchOutput {
  proposal: StrategyParams;
  metrics: ResearchMetrics & { trainNew: number; trainCurrent: number; pools: number };
  seed: number;
}

export async function researchRun(input: ResearchInput, say: (line: string) => void = () => {}): Promise<ResearchOutput> {
  const seed = input.seed ?? Math.floor(Date.now() / 1000) % 2 ** 31;
  const entries = loadIndex().filter((e) => input.holdfastLaunches || e.source !== HOLDFAST_SOURCE);
  const { wfTrain, wfTest } = walkForward(entries, say);
  const holdfast = new Set(entries.flatMap((e) => (e.source === HOLDFAST_SOURCE ? [e.pool] : [])));
  const inSplit = (specs: typeof wfTrain) => specs.filter((s) => s.kind === "pool" && s.model === "fair" && holdfast.has(s.pool)).length;
  say(`research: Holdfast launches: ${inSplit(wfTrain)} in TRAIN, ${inSplit(wfTest)} in TEST`);
  if (!wfTest.some((s) => s.kind === "pool")) throw new Error("no pool has walk-forward TEST candles (hours 24–72); is the dataset still being built?");
  const pool = new SimPool(input.workers);
  const ev = new Evaluator(pool);
  try {
    const t0 = Date.now();
    const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
    const fitness = ev.fitness(wfTrain);
    const space = new SearchSpace(PARAM_SPACE, PARAM_KEYS, input.current);
    const random = await randomSearch(space, input.random, [input.current, DEFAULT_PARAMS], fitness, mulberry32(seed));
    say(`research: ${random.length} random points, best ${random[0]!.score.toFixed(3)} (${secs()})`);
    const trials = await cmaes(space, random[0]!.params, fitness, {
      sigma: 0.2,
      generations: input.gens,
      seed: seed + 1,
      onGeneration: (g, best, sigma) => say(`research: CMA-ES gen ${g + 1}/${input.gens}: best ${best.score.toFixed(3)} σ ${sigma.toFixed(3)} (${secs()})`),
    });
    const proposal = (trials[0] && trials[0].score >= random[0]!.score ? trials[0] : random[0]!).params;
    const score = async (specs: typeof wfTrain, params: StrategyParams) => ev.score(specs, await ev.runs(specs, { kind: "tuned", params })).score;
    const [trainNew, trainCurrent, walkForwardNew, walkForwardCurrent] = await Promise.all([
      score(wfTrain, proposal),
      score(wfTrain, input.current),
      score(wfTest, proposal),
      score(wfTest, input.current),
    ]);
    const pools = new Set(wfTest.flatMap((s) => (s.kind === "pool" ? [s.pool] : []))).size;
    const rssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    say(`research: walk-forward TEST ${walkForwardNew.toFixed(3)} (proposal) vs ${walkForwardCurrent.toFixed(3)} (current) on ${pools} pools (${secs()}, ${input.workers} workers, peak RSS ${rssMb} MB)`);
    return { proposal, metrics: { walkForwardNew, walkForwardCurrent, trainNew, trainCurrent, pools }, seed };
  } finally {
    await pool.close();
  }
}

/** Unix s of the pinned `asOf` in `dir`'s index (or, for a fetch in progress, its response cache), or null. */
function asOfIn(dir: string, file: string): number | null {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  const { asOf } = JSON.parse(fs.readFileSync(full, "utf8")) as { asOf?: number };
  return typeof asOf === "number" ? asOf : null;
}

/** Age of the dataset in days (by its pinned `asOf`), or Infinity without one. */
export function datasetAgeDays(dir = DATA_DIR): number {
  const asOf = asOfIn(dir, "index.json");
  return asOf === null ? Infinity : (Date.now() / 1000 - asOf) / 86_400;
}

/**
 * Rebuilds the GeckoTerminal dataset next to the current one (`<dir>.next`) when it is older than `maxDays` and swaps
 * it in on success. Incremental: the new build starts with the old response cache's candle responses (a past
 * window's candles never change), so mostly the pool lists are refetched. Bounded: after `budgetMs` (0 = no limit)
 * the build stops and resumes from its response cache in the next run (as does one killed with the run); a build
 * older than `maxDays` starts over. Holdfast launch files carry over. Any failure leaves the current dataset in place.
 */
export async function refreshDataset(maxDays: number, budgetMs: number, say: (line: string) => void, dir = DATA_DIR): Promise<void> {
  const age = datasetAgeDays(dir);
  if (age <= maxDays) return;
  const next = `${dir}.next`;
  const old = `${dir}.old`;
  const started = Date.now();
  const resumeAsOf = asOfIn(path.join(next, ".cache"), "asof.json");
  if (resumeAsOf !== null && (Date.now() / 1000 - resumeAsOf) / 86_400 <= maxDays) {
    say(`research: dataset is ${Number.isFinite(age) ? `${age.toFixed(1)} days old` : "missing"}; resuming the refresh started ${new Date(resumeAsOf * 1000).toISOString()}`);
  } else {
    say(`research: dataset is ${Number.isFinite(age) ? `${age.toFixed(1)} days old` : "missing"}; refreshing`);
    fs.rmSync(next, { recursive: true, force: true });
    const cache = path.join(dir, ".cache");
    if (fs.existsSync(cache)) {
      fs.mkdirSync(path.join(next, ".cache"), { recursive: true });
      const reused = fs.readdirSync(cache).filter((f) => f.includes("_ohlcv_"));
      for (const f of reused) fs.copyFileSync(path.join(cache, f), path.join(next, ".cache", f));
      say(`research: reusing ${reused.length} cached candle responses`);
    }
  }
  const budget = budgetMs > 0 ? AbortSignal.timeout(budgetMs) : undefined;
  try {
    const pools = await fetchDataset({ dataDir: next, log: say, ...(budget ? { signal: budget } : {}) });
    if (pools === 0) {
      fs.rmSync(next, { recursive: true, force: true });
      throw new Error("no pools qualified");
    }
    if (fs.existsSync(path.join(dir, "index.json"))) {
      for (const f of fs.readdirSync(dir)) if (f.startsWith(HOLDFAST_PREFIX)) fs.copyFileSync(path.join(dir, f), path.join(next, f));
      mergeIndex(next, loadIndex(dir).filter((e) => e.source === HOLDFAST_SOURCE) as IndexEntry[]);
    }
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dir)) fs.renameSync(dir, old);
    fs.renameSync(next, dir);
    fs.rmSync(old, { recursive: true, force: true });
    say(`research: dataset refreshed (${pools} pools, ${((Date.now() - started) / 60_000).toFixed(1)} min)`);
  } catch (e) {
    say(`research: dataset refresh ${budget?.aborted ? `paused after ${(budgetMs / 60_000).toFixed(0)} min; it resumes next run` : `failed (${e instanceof Error ? e.message : String(e)})`}`);
  }
}
