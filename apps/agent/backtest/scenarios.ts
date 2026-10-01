import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FairValueFlow, ReplayFlow, TraderMixFlow, pathFromCandles, preroll, type Candle, type PricePath } from "./flows";
import { PRODUCTION_TERMS, type LaunchSetup, type SimTerms } from "./program";
import { hashSeed, mulberry32, simulate, type Recording, type Scenario } from "./sim";

/**
 * Scenario construction: how a pool's candles become a launch on our curve.
 *
 * Launch: production terms, 30 SOL virtual, a raise of 5–50 SOL (log-uniform), 20–50% of it kept as
 * vault SOL and a 10–25% supply cap for the bundle, all drawn from a hash of the scenario id so every
 * policy sees the same launch. A spec's `launch` variant replaces the terms and/or the reserve share
 * (terms search) while the raise, bundle cap and flow seeds stay those of the scenario id.
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

/** Launch terms and vault reserve share replacing the defaults of `setupFor` (terms search). */
export interface LaunchVariant {
  terms?: SimTerms;
  reserveBps?: bigint;
}

export type ScenarioSpec = (
  | {
      kind: "pool";
      file: string;
      pool: string;
      tag: string;
      model: PathModel;
      fromMin: number;
      toMin: number;
      halfLifeMs?: number;
      /** Multiplies the candle volume the flow window sees (default 1, robustness runs). */
      volumeScale?: number;
    }
  | { kind: "synthetic"; seed: number; hours: number }
) & { launch?: LaunchVariant };

/** Scenario identity: seeds the launch draw and the flows, the same for every launch variant. */
export function specKey(s: ScenarioSpec): string {
  return s.kind === "pool" ? `${s.pool}@${s.fromMin}-${s.toMin}` : `syn-${s.seed}`;
}

export function termsKey(t: SimTerms): string {
  return `${t.venue}/${t.bandBps}/${t.maxImpactBps}/${t.buyBpsPerWindow}/${t.sellBpsPerWindow}/${t.windowSecs}/${t.emaPeriodSecs}/${t.tradeFeeBps}/${t.launchFeeBps}/${t.minVaultSol}`;
}

function variantKey(v: LaunchVariant | undefined): string {
  return `${v?.terms ? `|terms ${termsKey(v.terms)}` : ""}${v?.reserveBps === undefined ? "" : `|reserve ${v.reserveBps}`}`;
}

/** Scenario key plus the flow model, non-default fair-value half-life / volume scale and the launch variant: one baseline run each. */
export function runKey(s: ScenarioSpec): string {
  if (s.kind === "synthetic") return `${specKey(s)}|synthetic${variantKey(s.launch)}`;
  const halfLife = s.halfLifeMs === undefined ? "" : `~${s.halfLifeMs}`;
  const volume = s.volumeScale === undefined ? "" : `×${s.volumeScale}`;
  return `${specKey(s)}|${s.model}${halfLife}${volume}${variantKey(s.launch)}`;
}

/** Launch parameters drawn deterministically from the scenario id, then `variant` applied. */
export function setupFor(id: string, variant?: LaunchVariant): LaunchSetup {
  const r = mulberry32(hashSeed(`${id}/setup`));
  const raiseSol = 5 * 10 ** r();
  const reserveBps = BigInt([2_000, 3_000, 4_000, 5_000][Math.floor(r() * 4)]!);
  return {
    terms: variant?.terms ?? PRODUCTION_TERMS,
    virtualSol: VIRTUAL_SOL,
    raised: BigInt(Math.round(raiseSol * 1_000)) * 1_000_000n,
    reserveBps: variant?.reserveBps ?? reserveBps,
    bundleSupplyBps: BigInt([1_000, 1_500, 2_000, 2_500][Math.floor(r() * 4)]!),
  };
}

/**
 * Recordings kept per worker (least recently used dropped first): above one phase's working set
 * (≤ 74 pool windows per launch variant), far below what every variant of a terms search would hold.
 */
const MAX_RECORDINGS = 128;

/** Builds scenarios from specs, caching pool files, paths and the no-agent recordings the exogenous model replays. */
export class ScenarioBuilder {
  private readonly pools = new Map<string, PoolFile>();
  private readonly paths = new Map<string, PricePath>();
  private readonly recordings = new Map<string, Recording>();

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
    const setup = setupFor(id, spec.launch);
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
        return new FairValueFlow(p, offset, spec.halfLifeMs ?? FAIR_HALF_LIFE_MS, rng, spec.volumeScale);
      },
    };
    if (spec.model === "fair") return fair;
    // The no-agent public trades depend on the launch (raise, reserve, bundle, fees) and the volume scale, not on the agent terms.
    const recKey = `${id}|${setup.reserveBps}|${setup.terms.venue}/${setup.terms.tradeFeeBps}/${setup.terms.launchFeeBps}|×${spec.volumeScale ?? 1}`;
    let recorded = this.recordings.get(recKey);
    if (recorded) {
      this.recordings.delete(recKey);
    } else {
      recorded = { t: [], amount: [], churn: [] };
      simulate(fair, { kind: "none" }, undefined, recorded);
      if (this.recordings.size >= MAX_RECORDINGS) this.recordings.delete(this.recordings.keys().next().value!);
    }
    this.recordings.set(recKey, recorded);
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
