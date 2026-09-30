import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PARAMS } from "../src/strategy";
import { compare, runObjective } from "./metrics";
import { ScenarioBuilder } from "./scenarios";
import { simulate, type Policy } from "./sim";

// Seeded public flow and seeded agent timing make a run a pure function of (scenario, policy), so
// this comparison is stable: the default policy must keep beating the frozen v1 rule on a fixed
// synthetic launch whose seed is outside the TRAIN and TEST sets.
test("default policy beats v1 on a fixed synthetic launch", () => {
  const sc = new ScenarioBuilder().build({ kind: "synthetic", seed: 900, hours: 12 });
  const base = simulate(sc, { kind: "none" });
  assert.deepEqual(simulate(sc, { kind: "none" }), base, "the simulation must be deterministic");
  const objective = (policy: Policy) => runObjective(compare(base, simulate(sc, policy)));
  const tuned = objective({ kind: "tuned", params: DEFAULT_PARAMS });
  const v1 = objective({ kind: "v1" });
  assert.ok(tuned > v1, `default objective ${tuned.toFixed(2)} ≤ v1 ${v1.toFixed(2)}`);
});
