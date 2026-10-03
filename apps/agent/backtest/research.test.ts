import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ResearchLoop, STARTUP_DELAY_MS, loadResearchConfig, parseResearchOutput, type ResearchConfig, type ResearchItem, type ResearchResult, type ResearchRunner } from "../src/research";
import { DEFAULT_PARAMS, PARAM_SPACE, withParams, type StrategyParams } from "../src/strategy";

const CFG: ResearchConfig = { intervalMin: 60, workers: 1, random: 1, gens: 1, refreshDays: 7, refreshMaxMin: 30, holdfastLaunches: 5, timeoutMin: 1 };

/** A loop whose "backtest" is `result`, with an in-memory DB and the adoption callback recorded. */
function loop(result: ResearchResult | Error, opts: { file?: string; current?: StrategyParams; runner?: ResearchRunner } = {}) {
  const adopted: { params: StrategyParams; item: ResearchItem }[] = [];
  const inputs: StrategyParams[] = [];
  const rl = new ResearchLoop({
    cfg: CFG,
    file: opts.file ?? ":memory:",
    narrator: null,
    current: () => opts.current ?? DEFAULT_PARAMS,
    adopt: (params, item) => adopted.push({ params, item }),
    repoRoot: path.resolve(".."),
    runner: async (input, signal) => {
      inputs.push(input.current);
      if (opts.runner) return opts.runner(input, signal);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { rl, adopted, inputs };
}

const proposal: Record<string, number> = { ...DEFAULT_PARAMS, buyMarginBps: DEFAULT_PARAMS.buyMarginBps + 10 };

test("a proposal that beats the current parameters out of sample is adopted", async () => {
  const { rl, adopted, inputs } = loop({ proposal, metrics: { walkForwardNew: 1.23, walkForwardCurrent: 0.98, trainNew: 2, trainCurrent: 1.5, pools: 3 } });
  const item = await rl.runOnce();
  assert.equal(item.adopted, true);
  assert.deepEqual(inputs, [DEFAULT_PARAMS], "the run starts from the current parameters");
  assert.equal(adopted.length, 1);
  assert.deepEqual(adopted[0]!.params, withParams(DEFAULT_PARAMS, proposal));
  assert.equal(adopted[0]!.item, item);
  assert.equal(item.summary, "Walk-forward objective 1.23 vs 0.98 for the current parameters: adopted.");
  const snap = rl.snapshot();
  assert.deepEqual(snap.items, [item]);
  assert.equal(snap.updatedAt, item.ts);
  assert.equal(snap.running, false);
  rl.close();
});

test("a proposal that is not better out of sample keeps the current parameters", async () => {
  for (const walkForwardNew of [0.5, 0.98]) {
    const { rl, adopted } = loop({ proposal, metrics: { walkForwardNew, walkForwardCurrent: 0.98 } });
    const item = await rl.runOnce();
    assert.equal(item.adopted, false);
    assert.equal(adopted.length, 0);
    assert.match(item.summary, /kept the current parameters\.$/);
    rl.close();
  }
});

test("a better proposal outside PARAM_SPACE is rejected", async () => {
  const bad = { ...proposal, sellMarginBps: PARAM_SPACE.sellMarginBps.hi + 1 };
  const { rl, adopted } = loop({ proposal: bad, metrics: { walkForwardNew: 2, walkForwardCurrent: 1 } });
  const item = await rl.runOnce();
  assert.equal(item.adopted, false);
  assert.equal(adopted.length, 0);
  assert.match(item.summary, /proposal rejected: strategy parameter sellMarginBps/);
  rl.close();
});

test("a failed run is recorded, never thrown, and later runs still work", async () => {
  const { rl } = loop(new Error("child exploded"));
  const item = await rl.runOnce();
  assert.equal(item.adopted, false);
  assert.equal(item.summary, "Research run failed: child exploded");
  assert.equal(item.metrics, undefined);
  assert.equal(rl.snapshot().items.length, 1);
  rl.close();
});

test("runs are persisted and reloaded newest first, the in-flight run is shared", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-"));
  const file = path.join(dir, "agent.db");
  const { rl } = loop({ proposal, metrics: { walkForwardNew: 1, walkForwardCurrent: 2 } }, { file });
  const [a, b] = await Promise.all([rl.runOnce(), rl.runOnce()]);
  assert.equal(a, b, "concurrent runOnce calls share one run");
  const c = await rl.runOnce();
  assert.notEqual(a, c);
  rl.close();
  const again = loop({ proposal, metrics: { walkForwardNew: 1, walkForwardCurrent: 2 } }, { file });
  assert.deepEqual(again.rl.snapshot().items, [c, a]);
  again.rl.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadResearchConfig is off without an interval and reads the knobs", () => {
  assert.equal(loadResearchConfig({}), null);
  assert.equal(loadResearchConfig({ RESEARCH_INTERVAL_MIN: "0" }), null);
  assert.deepEqual(loadResearchConfig({ RESEARCH_INTERVAL_MIN: "720" }), {
    intervalMin: 720,
    workers: 2,
    random: 40,
    gens: 6,
    refreshDays: 7,
    refreshMaxMin: 45,
    holdfastLaunches: 20,
    timeoutMin: 90,
  });
  assert.deepEqual(
    loadResearchConfig({
      RESEARCH_INTERVAL_MIN: "30",
      RESEARCH_WORKERS: "4",
      RESEARCH_GENS: "2",
      RESEARCH_REFRESH_DAYS: "0",
      RESEARCH_REFRESH_MAX_MIN: "20",
      RESEARCH_HOLDFAST_LAUNCHES: "0",
    }),
    { intervalMin: 30, workers: 4, random: 40, gens: 2, refreshDays: 0, refreshMaxMin: 20, holdfastLaunches: 0, timeoutMin: 90 },
  );
  assert.throws(() => loadResearchConfig({ RESEARCH_INTERVAL_MIN: "soon" }), /RESEARCH_INTERVAL_MIN/);
});

test("the schedule survives restarts: one interval after the persisted last run, an overdue run shortly after start", async (t) => {
  const NOW = 1_800_000_000_000;
  const HOUR = 3_600_000;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "agent.db");
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const ok: ResearchResult = { proposal, metrics: { walkForwardNew: 1, walkForwardCurrent: 2 } };

  // No history: the first run is due a short delay after start, then one interval after it started.
  const first = loop(ok, { file });
  const stop = new AbortController();
  first.rl.start(stop.signal);
  assert.equal(first.rl.snapshot().nextAt, (NOW + STARTUP_DELAY_MS) / 1000);
  t.mock.timers.tick(STARTUP_DELAY_MS - 1);
  await flush();
  assert.equal(first.inputs.length, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(first.inputs.length, 1);
  const ran = first.rl.snapshot().items[0]!;
  assert.equal(ran.ts, (NOW + STARTUP_DELAY_MS) / 1000);
  assert.equal(first.rl.snapshot().nextAt, ran.ts + 3_600);
  stop.abort();
  first.rl.close();

  // A deploy 10 minutes later keeps the clock: the next run is still one interval after the last one started.
  t.mock.timers.tick(10 * 60_000);
  const second = loop(ok, { file });
  second.rl.start(new AbortController().signal);
  assert.equal(second.rl.snapshot().nextAt, ran.ts + 3_600);
  second.rl.close();

  // A start after the interval has passed runs the overdue run after the startup delay, not a whole interval later.
  t.mock.timers.tick(2 * HOUR);
  const third = loop(ok, { file });
  third.rl.start(new AbortController().signal);
  assert.equal(third.rl.snapshot().nextAt, (Date.now() + STARTUP_DELAY_MS) / 1000);
  third.rl.close();
});

test("a run stopped by shutdown is not recorded, so the next start redoes it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "agent.db");
  const started = Promise.withResolvers<void>();
  const killed: ResearchRunner = (_input, signal) => {
    const { promise, reject } = Promise.withResolvers<ResearchResult>();
    signal.addEventListener("abort", () => reject(new Error("research child killed: aborted")));
    started.resolve();
    return promise;
  };
  const { rl } = loop(new Error("unused"), { file, runner: killed });
  const stop = new AbortController();
  rl.start(stop.signal);
  t.mock.timers.tick(STARTUP_DELAY_MS);
  await started.promise;
  assert.equal(rl.snapshot().running, true);
  stop.abort();
  const item = await rl.runOnce();
  assert.match(item.summary, /aborted/);
  assert.deepEqual(rl.snapshot().items, []);
  rl.close();
  const again = loop(new Error("unused"), { file });
  again.rl.start(new AbortController().signal);
  assert.equal(again.rl.snapshot().nextAt, (Date.now() + STARTUP_DELAY_MS) / 1000, "overdue at the next start");
  again.rl.close();
});

test("the child's last stdout line is the result; anything else is an error", () => {
  const line = JSON.stringify({ proposal: { buyMarginBps: 30 }, metrics: { walkForwardNew: 1, walkForwardCurrent: 0.5 }, seed: 7 });
  assert.deepEqual(parseResearchOutput(`noise\n${line}\n`), { proposal: { buyMarginBps: 30 }, metrics: { walkForwardNew: 1, walkForwardCurrent: 0.5 }, seed: 7 });
  assert.throws(() => parseResearchOutput(""), /no result/);
  assert.throws(() => parseResearchOutput('{"proposal":{"a":"x"},"metrics":{"walkForwardNew":1,"walkForwardCurrent":0}}'), /numeric proposal/);
  assert.throws(() => parseResearchOutput('{"proposal":{"a":1},"metrics":{"walkForwardNew":1}}'), /walk-forward metrics/);
});
