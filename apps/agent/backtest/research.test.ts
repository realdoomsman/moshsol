import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ResearchLoop, loadResearchConfig, parseResearchOutput, type ResearchConfig, type ResearchItem, type ResearchResult } from "../src/research";
import { DEFAULT_PARAMS, PARAM_SPACE, withParams, type StrategyParams } from "../src/strategy";

const CFG: ResearchConfig = { intervalMin: 60, workers: 1, random: 1, gens: 1, refreshDays: 7, timeoutMin: 1 };

/** A loop whose "backtest" is `result`, with an in-memory DB and the adoption callback recorded. */
function loop(result: ResearchResult | Error, opts: { file?: string; current?: StrategyParams } = {}) {
  const adopted: { params: StrategyParams; item: ResearchItem }[] = [];
  const inputs: StrategyParams[] = [];
  const rl = new ResearchLoop({
    cfg: CFG,
    file: opts.file ?? ":memory:",
    narrator: null,
    current: () => opts.current ?? DEFAULT_PARAMS,
    adopt: (params, item) => adopted.push({ params, item }),
    repoRoot: path.resolve(".."),
    runner: async (input) => {
      inputs.push(input.current);
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
  assert.deepEqual(loadResearchConfig({ RESEARCH_INTERVAL_MIN: "720" }), { intervalMin: 720, workers: 2, random: 40, gens: 6, refreshDays: 7, timeoutMin: 90 });
  assert.deepEqual(loadResearchConfig({ RESEARCH_INTERVAL_MIN: "30", RESEARCH_WORKERS: "4", RESEARCH_GENS: "2", RESEARCH_REFRESH_DAYS: "0" }), {
    intervalMin: 30,
    workers: 4,
    random: 40,
    gens: 2,
    refreshDays: 0,
    timeoutMin: 90,
  });
  assert.throws(() => loadResearchConfig({ RESEARCH_INTERVAL_MIN: "soon" }), /RESEARCH_INTERVAL_MIN/);
});

test("the child's last stdout line is the result; anything else is an error", () => {
  const line = JSON.stringify({ proposal: { buyMarginBps: 30 }, metrics: { walkForwardNew: 1, walkForwardCurrent: 0.5 }, seed: 7 });
  assert.deepEqual(parseResearchOutput(`noise\n${line}\n`), { proposal: { buyMarginBps: 30 }, metrics: { walkForwardNew: 1, walkForwardCurrent: 0.5 }, seed: 7 });
  assert.throws(() => parseResearchOutput(""), /no result/);
  assert.throws(() => parseResearchOutput('{"proposal":{"a":"x"},"metrics":{"walkForwardNew":1,"walkForwardCurrent":0}}'), /numeric proposal/);
  assert.throws(() => parseResearchOutput('{"proposal":{"a":1},"metrics":{"walkForwardNew":1}}'), /walk-forward metrics/);
});
