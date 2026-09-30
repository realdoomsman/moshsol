import os from "node:os";
import { Worker } from "node:worker_threads";
import type { ScenarioSpec } from "./scenarios";
import type { Policy, RunResult, SimOptions } from "./sim";
import type { Job } from "./worker";

/** Fixed pool of simulation workers fed from one queue (runs are independent and deterministic). */
export class SimPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Job[] = [];
  private readonly pending = new Map<number, { resolve: (r: RunResult) => void; reject: (e: Error) => void }>();
  private nextId = 0;

  constructor(size = Math.max(1, os.availableParallelism() - 2)) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url));
      w.on("message", (msg: { id: number; result?: RunResult; error?: string }) => {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error !== undefined) p.reject(new Error(msg.error));
        else p.resolve(msg.result!);
        this.dispatch(w);
      });
      w.on("error", (err) => {
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  private dispatch(w: Worker): void {
    const job = this.queue.shift();
    if (job) w.postMessage(job);
    else this.idle.push(w);
  }

  run(spec: ScenarioSpec, policy: Policy, sim?: Partial<SimOptions>): Promise<RunResult> {
    const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
    const job: Job = { id: this.nextId++, spec, policy, sim };
    this.pending.set(job.id, { resolve, reject });
    this.queue.push(job);
    const w = this.idle.pop();
    if (w) this.dispatch(w);
    return promise;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
