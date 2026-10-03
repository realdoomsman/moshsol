import { spawn } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { log } from "./log";
import type { Narrator } from "./narrate";
import { DEFAULT_PARAMS, withParams, type StrategyParams } from "./strategy";

/**
 * Periodic parameter research: a child process re-tunes the policy on the backtest dataset
 * (walk-forward TRAIN) and the proposal is adopted only when it beats the current parameters
 * out of sample (walk-forward TEST) and lies inside `PARAM_SPACE`. The program's hard caps are the
 * launch terms the policy cannot change, and the planner only emits trades the program mirror
 * accepts, so research can only move the knobs within the owner's box. The narrator, when
 * configured, only puts the result into words; it never decides anything.
 */

export interface ResearchConfig {
  intervalMin: number;
  workers: number;
  random: number;
  gens: number;
  refreshDays: number;
  /** Minutes a run may spend refreshing the GeckoTerminal dataset; the rest of the refresh resumes next run. */
  refreshMaxMin: number;
  /** Holdfast launches whose candles one run may (re)fetch from the indexer; 0 leaves them out of the dataset. */
  holdfastLaunches: number;
  timeoutMin: number;
}

function envInt(env: NodeJS.ProcessEnv, key: string, dflt: number): number {
  const v = env[key]?.trim();
  if (!v) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer, got ${v}`);
  return n;
}

/** `RESEARCH_*` env; null when `RESEARCH_INTERVAL_MIN` is unset or 0 (research off). */
export function loadResearchConfig(env: NodeJS.ProcessEnv = process.env): ResearchConfig | null {
  const intervalMin = envInt(env, "RESEARCH_INTERVAL_MIN", 0);
  if (intervalMin === 0) return null;
  return {
    intervalMin,
    workers: Math.max(1, envInt(env, "RESEARCH_WORKERS", 2)),
    random: envInt(env, "RESEARCH_RANDOM", 40),
    gens: envInt(env, "RESEARCH_GENS", 6),
    refreshDays: envInt(env, "RESEARCH_REFRESH_DAYS", 7),
    refreshMaxMin: envInt(env, "RESEARCH_REFRESH_MAX_MIN", 45),
    holdfastLaunches: envInt(env, "RESEARCH_HOLDFAST_LAUNCHES", 20),
    timeoutMin: Math.max(1, envInt(env, "RESEARCH_TIMEOUT_MIN", 90)),
  };
}

/** What the child (`backtest/research-run.ts`) reads on stdin. */
export interface ResearchInput {
  current: StrategyParams;
  /** Random-search points before CMA-ES. */
  random: number;
  /** CMA-ES generations. */
  gens: number;
  workers: number;
  /** Rebuild the dataset first when it is older than this (0 / absent: never). */
  refreshDays?: number;
  /** Minutes the rebuild may take in this run (0 / absent: no limit); an unfinished rebuild resumes next run. */
  refreshMaxMin?: number;
  /** Holdfast launches whose candles may be (re)fetched from the indexer first (0 / absent: none, and none in the dataset). */
  holdfastLaunches?: number;
  /** Seed of the search draws (default: the run's start time). */
  seed?: number;
}

export interface ResearchMetrics {
  walkForwardNew: number;
  walkForwardCurrent: number;
  trainNew?: number;
  trainCurrent?: number;
  pools?: number;
}

export interface ResearchItem {
  /** Unix seconds (wall clock) when the run started. */
  ts: number;
  summary: string;
  adopted: boolean;
  proposal?: Record<string, number>;
  current?: Record<string, number>;
  metrics?: ResearchMetrics;
}

export interface ResearchSnapshot {
  /** Newest first, at most `KEEP`. */
  items: ResearchItem[];
  /** Unix seconds: the newest item's `ts`, and when the next run is scheduled (null while running / off). */
  updatedAt: number | null;
  running: boolean;
  nextAt: number | null;
}

/** The child's one stdout line; the proposal is untrusted until `withParams` accepted it. */
export interface ResearchResult {
  proposal: Record<string, number>;
  metrics: ResearchMetrics;
  seed?: number;
}

export type ResearchRunner = (input: ResearchInput, signal: AbortSignal) => Promise<ResearchResult>;

const KEEP = 50;
/** An overdue run waits this long after startup, so it doesn't load the agent's first minutes. */
export const STARTUP_DELAY_MS = 3 * 60_000;

/**
 * When the next run is due (ms): one interval after the last run started (`lastMs`, from the persisted history, so a
 * restart keeps the clock), never before `earliestMs`; due at `earliestMs` without any run yet.
 */
export function nextRunAt(lastMs: number | null, intervalMs: number, earliestMs: number): number {
  return lastMs === null ? earliestMs : Math.max(lastMs + intervalMs, earliestMs);
}

const SUMMARY_SYSTEM =
  "You summarize a backtest of a rule-based vault agent in ≤ 3 plain sentences for the public; you never recommend trades or predict price.";

/** `{ proposal, metrics }` from the last non-empty stdout line of the child, shape-checked. */
export function parseResearchOutput(stdout: string): ResearchResult {
  const line = stdout.trim().split("\n").at(-1)?.trim();
  if (!line) throw new Error("research child printed no result");
  const out = JSON.parse(line) as Partial<ResearchResult>;
  const m = out.metrics;
  if (!out.proposal || typeof out.proposal !== "object" || Object.values(out.proposal).some((v) => typeof v !== "number")) {
    throw new Error("research child result has no numeric proposal");
  }
  if (!m || !Number.isFinite(m.walkForwardNew) || !Number.isFinite(m.walkForwardCurrent)) throw new Error("research child result has no walk-forward metrics");
  return { proposal: out.proposal, metrics: m, ...(typeof out.seed === "number" ? { seed: out.seed } : {}) };
}

/**
 * Runs `tsx backtest/research-run.ts` in apps/agent (node + the tsx loader, one process, so a kill
 * ends the simulation workers too); killed after `timeoutMs` or when `signal` aborts.
 */
export function spawnResearch(input: ResearchInput, opts: { repoRoot: string; timeoutMs: number; signal: AbortSignal }): Promise<ResearchResult> {
  const { promise, resolve, reject } = Promise.withResolvers<ResearchResult>();
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), path.join("backtest", "research-run.ts")], {
    cwd: path.join(opts.repoRoot, "apps", "agent"),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderrTail = "";
  let killedFor: string | null = null;
  const kill = (why: string) => {
    if (child.exitCode === null && child.signalCode === null) {
      killedFor = why;
      child.kill();
    }
  };
  const timer = setTimeout(() => kill(`timeout after ${Math.round(opts.timeoutMs / 60_000)} min`), opts.timeoutMs);
  const onAbort = () => kill("aborted");
  opts.signal.addEventListener("abort", onAbort, { once: true });
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2_000);
    for (const line of chunk.split("\n")) if (line.trim()) log("research", { progress: line.trimEnd() });
  });
  child.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
  child.on("close", (code, sig) => {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", onAbort);
    if (killedFor) reject(new Error(`research child killed: ${killedFor}`));
    else if (code !== 0) reject(new Error(`research child exited with ${code ?? sig}: ${stderrTail.trim().split("\n").at(-1) ?? ""}`));
    else {
      try {
        resolve(parseResearchOutput(stdout));
      } catch (e) {
        reject(e);
      }
    }
  });
  child.stdin.on("error", () => {}); // a child that dies early closes the pipe; `close` reports it
  child.stdin.end(JSON.stringify(input));
  return promise;
}

export class ResearchLoop {
  private readonly db: DatabaseSync;
  private readonly insert;
  private readonly cfg: ResearchConfig;
  private readonly narrator: Narrator | null;
  private readonly current: () => StrategyParams;
  private readonly adopt: (p: StrategyParams, item: ResearchItem) => void;
  private readonly runner: ResearchRunner;
  private items: ResearchItem[] = [];
  private closed = false;
  private inflight: Promise<ResearchItem> | null = null;
  private aborter: AbortController | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextAt: number | null = null;

  constructor(opts: {
    cfg: ResearchConfig;
    /** SQLite file (shared with the activity log; this owns `research_runs`) or `:memory:`. */
    file: string;
    narrator: Narrator | null;
    current: () => StrategyParams;
    adopt: (p: StrategyParams, item: ResearchItem) => void;
    repoRoot: string;
    /** Replaces the child process (tests). */
    runner?: ResearchRunner;
  }) {
    this.cfg = opts.cfg;
    this.narrator = opts.narrator;
    this.current = opts.current;
    this.adopt = opts.adopt;
    this.runner =
      opts.runner ?? ((input, signal) => spawnResearch(input, { repoRoot: opts.repoRoot, timeoutMs: this.cfg.timeoutMin * 60_000, signal }));
    this.db = new DatabaseSync(opts.file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS research_runs (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, json TEXT NOT NULL)");
    this.insert = this.db.prepare("INSERT INTO research_runs (ts, json) VALUES (?, ?)");
    const rows = this.db.prepare("SELECT json FROM research_runs ORDER BY id DESC LIMIT ?").all(KEEP) as { json: string }[];
    this.items = rows.map((r) => JSON.parse(r.json) as ResearchItem);
  }

  /**
   * Runs one interval after the last run started — the persisted history's, so a deploy doesn't reset the clock — and
   * an overdue (or first ever) run `startupDelayMs` after `start`; runs never overlap.
   */
  start(signal: AbortSignal, startupDelayMs = STARTUP_DELAY_MS): void {
    const intervalMs = this.cfg.intervalMin * 60_000;
    const schedule = (earliestMs: number) => {
      if (signal.aborted) return;
      const last = this.items[0];
      const at = nextRunAt(last ? last.ts * 1000 : null, intervalMs, earliestMs);
      this.nextAt = Math.floor(at / 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.nextAt = null;
        void this.runOnce().then(() => schedule(Date.now()));
      }, at - Date.now());
    };
    signal.addEventListener(
      "abort",
      () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.nextAt = null;
        this.aborter?.abort();
      },
      { once: true },
    );
    // The last adopted proposal already passed the out-of-sample gate: re-apply it, or every deploy would fall back
    // to the defaults until the next run (up to an interval later).
    const adopted = this.items.find((i) => i.adopted && i.proposal);
    if (adopted) {
      try {
        this.adopt(withParams(DEFAULT_PARAMS, adopted.proposal as Record<string, unknown>), adopted);
        log("research_restored", { ts: adopted.ts });
      } catch (err) {
        log("research_restore_failed", { ts: adopted.ts, error: String((err as Error)?.message ?? err) });
      }
    }
    schedule(Date.now() + startupDelayMs);
  }

  /** One research run (the in-flight one when called while running); never rejects. */
  runOnce(): Promise<ResearchItem> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
      this.aborter = null;
    });
    return this.inflight;
  }

  private async run(): Promise<ResearchItem> {
    const ts = Math.floor(Date.now() / 1000);
    const current = this.current();
    const aborter = new AbortController();
    this.aborter = aborter;
    let item: ResearchItem;
    try {
      const { workers, random, gens, refreshDays, refreshMaxMin, holdfastLaunches } = this.cfg;
      const result = await this.runner({ current, random, gens, workers, refreshDays, refreshMaxMin, holdfastLaunches }, aborter.signal);
      const { metrics, proposal } = result;
      let params: StrategyParams | null = null;
      let rejected: string | null = null;
      try {
        params = withParams(DEFAULT_PARAMS, proposal);
      } catch (e) {
        rejected = e instanceof Error ? e.message : String(e);
      }
      const better = metrics.walkForwardNew > metrics.walkForwardCurrent;
      const adopted = better && params !== null;
      item = { ts, summary: "", adopted, proposal, current: { ...current }, metrics };
      item.summary = await this.summarize(item, rejected);
      if (adopted) this.adopt(params!, item);
      log("research", { adopted, ...metrics, seed: result.seed, ...(rejected ? { rejected } : {}) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      item = { ts, summary: `Research run failed: ${error}`, adopted: false, current: { ...current } };
      // Stopped by a shutdown: not a run. Left out of the history, the next start sees it as overdue and redoes it.
      if (aborter.signal.aborted) {
        log("research_aborted", { error });
        return item;
      }
      log("research_failed", { error });
    }
    if (!this.closed) this.insert.run(item.ts, JSON.stringify(item));
    this.items = [item, ...this.items].slice(0, KEEP);
    return item;
  }

  private async summarize(item: ResearchItem, rejected: string | null): Promise<string> {
    const m = item.metrics!;
    const verdict = item.adopted ? "adopted" : rejected ? `kept the current parameters (proposal rejected: ${rejected})` : "kept the current parameters";
    const plain = `Walk-forward objective ${m.walkForwardNew.toFixed(2)} vs ${m.walkForwardCurrent.toFixed(2)} for the current parameters: ${verdict}.`;
    if (!this.narrator) return plain;
    const user = JSON.stringify({ currentParameters: item.current, proposedParameters: item.proposal, backtest: m, proposalAdopted: item.adopted, ...(rejected ? { proposalRejected: rejected } : {}) });
    return (await this.narrator.narrate(SUMMARY_SYSTEM, user, { maxSentences: 3 })) ?? plain;
  }

  snapshot(): ResearchSnapshot {
    return { items: this.items, updatedAt: this.items[0]?.ts ?? null, running: this.inflight !== null, nextAt: this.nextAt };
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closed = true;
    this.aborter?.abort();
    this.db.close();
  }
}
