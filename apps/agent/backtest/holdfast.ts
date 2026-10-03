import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { MIN_SEGMENT_CANDLES } from "./evaluate";
import { HOLDFAST_PREFIX, WINDOW_S, classify, maxGapMinutes, type Candle, type IndexEntry } from "./fetch";
import { DATA_DIR, type PoolFile } from "./scenarios";

/**
 * Holdfast's own launches as backtest pools, next to the GeckoTerminal ones (`fetch.ts`), so research also tunes on
 * how the platform's real launches trade.
 *
 * Source: the indexer (env INDEXER_URL, default https://api.holdfast.fun; INDEXER_INTERNAL_TOKEN exempts the reads
 * from its per-IP limit). `GET /api/launches?status=all` lists the launches (hidden ones never are); a launch is used
 * when it is a pump launch, launched (status `live` or `woundDown`) at least 6 h ago, and has at least
 * `MIN_SEGMENT_CANDLES` (60) 1-minute candles in its first 72 h — enough for one walk-forward segment.
 * `GET /api/launches/:id/candles?tf=60` gives its minute candles.
 *
 * Units: the indexer quotes SOL per token and SOL volume; the GeckoTerminal pools are USD per token and USD volume.
 * The backtest only uses relative prices (each path is re-based onto the simulated launch, scenarios.ts) and volume
 * over the first price (whole tokens, flows.ts `pathFromCandles`), so either quote works as long as price and volume
 * share it; pool files say which in `quote`. The window starts at the minute of `launchedAt` (`createdAt`), like a
 * GeckoTerminal pool's starts at pool creation. The first minute's volume leaves out the launch bundle (the indexer
 * books it there; the simulation draws its own bundle). The candles include the vault agent's own past trades: a
 * small bias towards the policy that traded them, accepted for real data from our own launches.
 *
 * Refresh (each research run): the list, then at most `maxLaunches` candle requests, newest launch first, spaced
 * `intervalMs` (≥ 1 s) apart. A launch whose 72 h window was complete when fetched is never fetched again, one
 * fetched within the last hour is reused; launches over the cap keep their previous file. Files of launches no longer
 * listed are deleted. Every kept launch is (re)written into `index.json` with `source: "holdfast"`, replacing the
 * previous ones; the walk-forward split treats them like every other pool.
 */

export const HOLDFAST_SOURCE = "holdfast";
const MIN_AGE_S = 6 * 3600;
const REUSE_S = 3600;
const PAGE = 100;
const MIN_INTERVAL_MS = 1_000;
const ATTEMPTS = 3;

/** The fields of an indexer `LaunchSummary` this reads. */
export interface HoldfastLaunch {
  address: string;
  mint: string;
  symbol: string;
  venue: string;
  status: string;
  launchedAt: number;
  /** Lamports (decimal string) the launch bundle bought. */
  bundleSol: string;
}

/** An indexer candle (`GET /api/launches/:id/candles`). */
export interface HoldfastCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSol: number;
}

export interface HoldfastPoolFile extends PoolFile {
  quote: "SOL";
  /** Unix s of the candle fetch: the window is final once this is past `createdAt` + 72 h. */
  fetchedAt: number;
}

export function eligible(l: HoldfastLaunch, now: number): boolean {
  return l.venue === "pump" && (l.status === "live" || l.status === "woundDown") && l.launchedAt > 0 && l.launchedAt <= now - MIN_AGE_S;
}

/** The pool file of `l` from its indexer candles, or null with fewer than `MIN_SEGMENT_CANDLES` usable ones in the window. */
export function holdfastPool(l: HoldfastLaunch, candles: HoldfastCandle[], fetchedAt: number): HoldfastPoolFile | null {
  const origin = Math.floor(l.launchedAt / 60) * 60;
  const bundleSol = Number(l.bundleSol) / 1e9 || 0;
  const out: Candle[] = [];
  for (const k of candles) {
    if (k.time < origin || k.time >= origin + WINDOW_S || !(k.open > 0 && k.high > 0 && k.low > 0 && k.close > 0)) continue;
    out.push([k.time, k.open, k.high, k.low, k.close, Math.max(0, k.time === origin ? k.volumeSol - bundleSol : k.volumeSol)]);
  }
  if (out.length < MIN_SEGMENT_CANDLES) return null;
  out.sort((a, b) => a[0] - b[0]);
  return { pool: l.address, baseToken: l.mint, symbol: l.symbol, dex: HOLDFAST_SOURCE, createdAt: l.launchedAt, timeframe: "minute", quote: "SOL", fetchedAt, candles: out };
}

/** The index entry of a pool file, tagged and measured like `fetch.ts` does. */
export function holdfastEntry(file: string, p: HoldfastPoolFile): IndexEntry {
  const o = classify(p.candles.map((k) => k[4]));
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    file,
    pool: p.pool,
    baseToken: p.baseToken,
    symbol: p.symbol,
    dex: p.dex,
    createdAt: p.createdAt,
    source: HOLDFAST_SOURCE,
    tag: o.tag,
    candles: p.candles.length,
    coverage: round(p.candles.length / (WINDOW_S / 60)),
    maxGapMin: maxGapMinutes(p.candles, Math.floor(p.createdAt / 60) * 60),
    endMult: round(o.endMult),
    peakMult: round(o.peakMult),
    maxDrawdown: round(o.maxDrawdown),
    rangeMult: round(o.rangeMult),
  };
}

/** Replaces the Holdfast entries of `dir/index.json` (created without `asOf` when missing, so the GeckoTerminal refresh still runs). */
export function mergeIndex(dir: string, entries: IndexEntry[]): void {
  const file = path.join(dir, "index.json");
  const index = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as { rules?: Record<string, string>; pools: IndexEntry[] }) : { pools: [] };
  index.rules = {
    ...index.rules,
    holdfast: `Holdfast launches (source ${HOLDFAST_SOURCE}, files ${HOLDFAST_PREFIX}*): indexer 1-minute candles, SOL per token and SOL volume, first 72 h after launch, launch bundle left out of the first minute's volume`,
  };
  index.pools = [...index.pools.filter((p) => p.source !== HOLDFAST_SOURCE), ...entries];
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(index, null, 1));
  fs.renameSync(`${file}.tmp`, file);
}

export interface HoldfastOptions {
  dataDir?: string;
  /** Indexer origin (default: env INDEXER_URL, else https://api.holdfast.fun). */
  api?: string;
  /** Candle requests this refresh may make (newest launches first). */
  maxLaunches: number;
  /** Spacing of the indexer requests (default and minimum 1 s). */
  intervalMs?: number;
  log?: (line: string) => void;
}

/** Refreshes the Holdfast pool files and their index entries; resolves with the number of Holdfast pools in the dataset. */
export async function refreshHoldfast(opts: HoldfastOptions): Promise<number> {
  const dir = opts.dataDir ?? DATA_DIR;
  const api = (opts.api ?? (process.env.INDEXER_URL?.trim() || "https://api.holdfast.fun")).replace(/\/+$/, "");
  const token = process.env.INDEXER_INTERNAL_TOKEN?.trim();
  const headers: Record<string, string> = token ? { "x-holdfast-internal": token } : {};
  const intervalMs = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? MIN_INTERVAL_MS);
  const say = opts.log ?? (() => {});
  let nextAt = 0;
  let requests = 0;
  const get = async <T>(p: string): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextAt = Date.now() + intervalMs;
      requests++;
      const res = await fetch(api + p, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.ok) return (await res.json()) as T;
      await res.body?.cancel();
      if ((res.status !== 429 && res.status < 500) || attempt >= ATTEMPTS) throw new Error(`GET ${p}: HTTP ${res.status}`);
      nextAt = Date.now() + Math.max((Number(res.headers.get("retry-after")) || 0) * 1000, 5_000 * 2 ** attempt);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const launches: HoldfastLaunch[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await get<{ launches: HoldfastLaunch[]; total: number }>(`/api/launches?status=all&sort=new&limit=${PAGE}&offset=${offset}`);
    launches.push(...page.launches);
    if (page.launches.length < PAGE || offset + PAGE >= page.total) break;
  }
  const picks = launches.filter((l) => eligible(l, now)).sort((a, b) => b.launchedAt - a.launchedAt);

  fs.mkdirSync(dir, { recursive: true });
  const kept = new Map<string, HoldfastPoolFile>();
  let fetched = 0;
  for (const l of picks) {
    const file = `${HOLDFAST_PREFIX}${l.address}.json`;
    const full = path.join(dir, file);
    const prev = fs.existsSync(full) ? (JSON.parse(fs.readFileSync(full, "utf8")) as HoldfastPoolFile) : null;
    const final = prev !== null && prev.fetchedAt >= prev.createdAt + WINDOW_S;
    if (prev && (final || now - prev.fetchedAt < REUSE_S || fetched >= opts.maxLaunches)) {
      kept.set(file, prev);
      continue;
    }
    if (fetched >= opts.maxLaunches) continue;
    fetched++;
    try {
      const { candles } = await get<{ candles: HoldfastCandle[] }>(`/api/launches/${l.address}/candles?tf=60`);
      const pool = holdfastPool(l, candles, now);
      if (!pool) continue;
      fs.writeFileSync(full, JSON.stringify(pool));
      kept.set(file, pool);
    } catch (e) {
      say(`  holdfast: ${l.symbol} ${l.address}: ${e instanceof Error ? e.message : String(e)}`);
      if (prev) kept.set(file, prev);
    }
  }
  for (const f of fs.readdirSync(dir)) if (f.startsWith(HOLDFAST_PREFIX) && f.endsWith(".json") && !kept.has(f)) fs.rmSync(path.join(dir, f));
  mergeIndex(dir, [...kept].map(([file, pool]) => holdfastEntry(file, pool)));
  say(`holdfast: ${kept.size} launches in the dataset (${picks.length} eligible of ${launches.length} listed, ${fetched} candle fetches, ${requests} indexer requests)`);
  return kept.size;
}
