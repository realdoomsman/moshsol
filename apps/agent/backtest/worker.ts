import { parentPort } from "node:worker_threads";
import { ScenarioBuilder, type ScenarioSpec } from "./scenarios";
import { DEFAULT_SIM, simulate, type Policy, type SimOptions } from "./sim";

/** Worker thread: runs (scenario, policy) jobs; builds and caches scenarios (paths, exogenous recordings) locally. */
export interface Job {
  id: number;
  spec: ScenarioSpec;
  policy: Policy;
  /** Overrides of the agent timing model (robustness runs). */
  sim?: Partial<SimOptions>;
}

const builder = new ScenarioBuilder();
parentPort!.on("message", (job: Job) => {
  try {
    parentPort!.postMessage({ id: job.id, result: simulate(builder.build(job.spec), job.policy, { ...DEFAULT_SIM, ...job.sim }) });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
});
