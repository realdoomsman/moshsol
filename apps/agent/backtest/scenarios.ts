import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FairValueFlow, ReplayFlow, TraderMixFlow, pathFromCandles, preroll, type Candle, type PricePath } from "./flows";
import { PRODUCTION_TERMS, type LaunchSetup } from "./program";
import { hashSeed, mulberry32, simulate, type PublicTrade, type Scenario } from "./sim";

/**
 * Scenario construction: how a pool's candles become a launch on our curve.
 *
 * Launch: production terms, 30 SOL virtual, a raise of 5–50 SOL (log-uniform), 20–50% of it kept as
 * vault SOL and a 10–25% supply cap for the bundle, all drawn from a hash of the scenario id so every
 * policy sees the same launch.
 *
 * Price mapping: only relative moves matter. Public holders can never sell below the post-bundle
 * price (the bundle is locked), so the history's first price is placed at `start` × launch price
 * with `start` = 1.1 / (lowest price relative to the first), clamped to [1.1, 20]: the path's low
 * lands just above the floor and relative moves are kept exactly; only paths falling more than 95%
 * from their first price get clipped at the floor (the public runs out of tokens to sell).
 */

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const VIRTUAL_SOL = 30_000_000_000n;
const START_HEADROOM = 1.1;
const START_MAX = 20;
/** Fair-value model: half-life of a deviation the agent creates from the historical path. */
export const FAIR_HALF_LIFE_MS = 120_000;

export interface PoolFile {
  pool: string;
  baseToken: string;
  symbol: string;
  dex: string;
  createdAt: number;
  timeframe: "minute";
  candles: Candle[];
}

export interface PoolEntry {
  file: string;
  pool: string;
  symbol: string;
  tag: string;
  candles: number;
  createdAt: number;
}

export function loadIndex(dir = DATA_DIR): PoolEntry[] {
  const file = path.join(dir, "index.json");
  if (!fs.existsSync(file)) throw new Error(`no dataset at ${file}: run \`pnpm --filter @holdfast/agent backtest:fetch\` first`);
  const index = JSON.parse(fs.readFileSync(file, "utf8")) as { pools: PoolEntry[] };
  return index.pools;
}

export type PathModel = "exo" | "fair";
export type ScenarioSpec =
  | { kind: "pool"; file: string; pool: string; tag: string; model: PathModel; fromMin: number; toMin: number; halfLifeMs?: number }
  | { kind: "synthetic"; seed: number; hours: number };

export function specKey(s: ScenarioSpec): string {
  return s.kind === "pool" ? `${s.pool}@${s.fromMin}-${s.toMin}` : `syn-${s.seed}`;
}

/** Scenario key plus the flow model (and a non-default fair-value half-life): one baseline run each. */
export function runKey(s: ScenarioSpec): string {
  if (s.kind === "synthetic") return `${specKey(s)}|synthetic`;
  return `${specKey(s)}|${s.model}${s.halfLifeMs === undefined ? "" : `~${s.halfLifeMs}`}`;
}

/** Launch parameters drawn deterministically from the scenario id. */
export function setupFor(id: string): LaunchSetup {
  const r = mulberry32(hashSeed(`${id}/setup`));
  const raiseSol = 5 * 10 ** r();
  return {
    terms: PRODUCTION_TERMS,
    virtualSol: VIRTUAL_SOL,
    raised: BigInt(Math.round(raiseSol * 1_000)) * 1_000_000n,
    reserveBps: BigInt([2_000, 3_000, 4_000, 5_000][Math.floor(r() * 4)]!),
    bundleSupplyBps: BigInt([1_000, 1_500, 2_000, 2_500][Math.floor(r() * 4)]!),
  };
}

/** Builds scenarios from specs, caching pool files, paths and the no-agent recordings the exogenous model replays. */
export class ScenarioBuilder {
  private readonly pools = new Map<string, PoolFile>();
  private readonly paths = new Map<string, PricePath>();
  private readonly recordings = new Map<string, PublicTrade[]>();

  constructor(private readonly dir = DATA_DIR) {}

  private pathOf(spec: Extract<ScenarioSpec, { kind: "pool" }>): PricePath {
    const key = specKey(spec);
    let p = this.paths.get(key);
    if (!p) {
      let pool = this.pools.get(spec.file);
      if (!pool) {
        pool = JSON.parse(fs.readFileSync(path.join(this.dir, spec.file), "utf8")) as PoolFile;
        this.pools.set(spec.file, pool);
      }
      // Candle times are minute starts; the pool's first minute starts before `createdAt`.
      const origin = Math.floor(pool.createdAt / 60) * 60;
      const from = origin + spec.fromMin * 60;
      const to = origin + spec.toMin * 60;
      const candles = pool.candles.filter((c) => c[0] >= from && c[0] < to && c[1] > 0 && c[2] > 0 && c[3] > 0 && c[4] > 0);
      if (candles.length < 2) throw new Error(`${key}: fewer than 2 candles`);
      p = pathFromCandles(candles);
      this.paths.set(key, p);
    }
    return p;
  }

  build(spec: ScenarioSpec): Scenario {
    const id = specKey(spec);
    const setup = setupFor(id);
    if (spec.kind === "synthetic") {
      return {
        id,
        tag: "synthetic",
        model: "synthetic",
        setup,
        durationMs: spec.hours * 3_600_000,
        prepare: (market, rng) => new TraderMixFlow(rng, market.spot()),
      };
    }
    const p = this.pathOf(spec);
    const start = Math.min(START_MAX, Math.max(START_HEADROOM, START_HEADROOM / Math.exp(p.minLog)));
    const base = { id, tag: spec.tag, setup, durationMs: p.durationMs };
    // Log of the curve spot the path's first price maps to (set in prepare, identical for both models).
    const offsetOf = (spot: number) => Math.log(spot * start) - p.kl[0]!;
    const fair: Scenario = {
      ...base,
      model: "fair",
      prepare: (market, rng) => {
        const offset = offsetOf(market.spot());
        preroll(market, offset + p.kl[0]!);
        return new FairValueFlow(p, offset, spec.halfLifeMs ?? FAIR_HALF_LIFE_MS, rng);
      },
    };
    if (spec.model === "fair") return fair;
    let trades = this.recordings.get(id);
    if (!trades) {
      trades = [];
      simulate(fair, { kind: "none" }, undefined, trades);
      this.recordings.set(id, trades);
    }
    const recorded = trades;
    return {
      ...base,
      model: "exo",
      prepare: (market) => {
        preroll(market, offsetOf(market.spot()) + p.kl[0]!);
        return new ReplayFlow(recorded);
      },
    };
  }
}
