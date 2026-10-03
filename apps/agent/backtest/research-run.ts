/**
 * Research child process (spawned by `src/research.ts`, or by hand from apps/agent):
 *
 *   echo '{"current":{…StrategyParams},"random":40,"gens":6,"workers":2}' | tsx backtest/research-run.ts
 *
 * Reads one JSON `ResearchInput` from stdin: with `refreshDays`, first rebuilds the GeckoTerminal dataset when it is
 * older than that (for at most `refreshMaxMin` minutes; an unfinished rebuild resumes next run), with
 * `holdfastLaunches`, then refreshes Holdfast's own launches from the indexer (holdfast.ts). Logs progress to stderr
 * and prints exactly one JSON line `{ proposal, metrics, seed }` on stdout. Exit 0 on success, 1 on any error.
 */
import type { ResearchInput } from "../src/research";
import { DEFAULT_PARAMS, withParams } from "../src/strategy";
import { refreshHoldfast } from "./holdfast";
import { refreshDataset, researchRun } from "./research";

const say = (line: string) => console.error(line);

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function positiveInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`${name} must be a non-negative integer, got ${JSON.stringify(v)}`);
  return v;
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readStdin()) as Partial<ResearchInput>;
  const optional = (key: "refreshDays" | "refreshMaxMin" | "holdfastLaunches" | "seed") =>
    raw[key] === undefined ? {} : { [key]: positiveInt(raw[key], key) };
  const input: ResearchInput = {
    current: withParams(DEFAULT_PARAMS, (raw.current ?? {}) as Record<string, unknown>),
    random: positiveInt(raw.random, "random"),
    gens: positiveInt(raw.gens, "gens"),
    workers: Math.max(1, positiveInt(raw.workers, "workers")),
    ...optional("refreshDays"),
    ...optional("refreshMaxMin"),
    ...optional("holdfastLaunches"),
    ...optional("seed"),
  };
  if (input.refreshDays) await refreshDataset(input.refreshDays, (input.refreshMaxMin ?? 0) * 60_000, say);
  if (input.holdfastLaunches) {
    try {
      await refreshHoldfast({ maxLaunches: input.holdfastLaunches, log: say });
    } catch (e) {
      say(`research: Holdfast launches not refreshed (${e instanceof Error ? e.message : String(e)}); using the ones from earlier runs`);
    }
  }
  const out = await researchRun(input, say);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
