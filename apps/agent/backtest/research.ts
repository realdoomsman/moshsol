import fs from "node:fs";
import path from "node:path";
import type { ResearchInput, ResearchMetrics } from "../src/research";
import { DEFAULT_PARAMS, PARAM_KEYS, PARAM_SPACE, type StrategyParams } from "../src/strategy";
import { Evaluator, walkForward } from "./evaluate";
import { fetchDataset } from "./fetch";
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
  const entries = loadIndex();
  const { wfTrain, wfTest } = walkForward(entries, say);
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
    say(`research: walk-forward TEST ${walkForwardNew.toFixed(3)} (proposal) vs ${walkForwardCurrent.toFixed(3)} (current) on ${pools} pools (${secs()})`);
    return { proposal, metrics: { walkForwardNew, walkForwardCurrent, trainNew, trainCurrent, pools }, seed };
  } finally {
    await pool.close();
  }
}

/** Age of the dataset in days (by its pinned `asOf`), or Infinity without an index. */
export function datasetAgeDays(dir = DATA_DIR): number {
  const file = path.join(dir, "index.json");
  if (!fs.existsSync(file)) return Infinity;
  const { asOf } = JSON.parse(fs.readFileSync(file, "utf8")) as { asOf?: number };
  return typeof asOf === "number" ? (Date.now() / 1000 - asOf) / 86_400 : Infinity;
}

/**
 * Rebuilds the dataset next to the current one when it is older than `maxDays` and swaps it in on
 * success (a fresh response cache, so today's pool lists are used). Any failure — typically the
 * network — leaves the cached dataset in place; the run continues on it.
 */
export async function refreshDataset(maxDays: number, say: (line: string) => void, dir = DATA_DIR): Promise<void> {
  const age = datasetAgeDays(dir);
  if (age <= maxDays) return;
  const next = `${dir}.next`;
  const old = `${dir}.old`;
  say(`research: dataset is ${Number.isFinite(age) ? `${age.toFixed(1)} days old` : "missing"}; refreshing`);
  fs.rmSync(next, { recursive: true, force: true });
  try {
    const pools = await fetchDataset({ dataDir: next, log: say });
    if (pools === 0) throw new Error("no pools qualified");
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dir)) fs.renameSync(dir, old);
    fs.renameSync(next, dir);
    fs.rmSync(old, { recursive: true, force: true });
    say(`research: dataset refreshed (${pools} pools)`);
  } catch (e) {
    fs.rmSync(next, { recursive: true, force: true });
    say(`research: dataset refresh failed (${e instanceof Error ? e.message : String(e)}); using the cached dataset`);
  }
}
