/**
 * Backtest dataset fetcher: the first 72 hours of 1-minute USD candles for ~80 real pump.fun
 * memecoin pools on Solana, from the free GeckoTerminal API (https://api.geckoterminal.com/api/v2,
 * docs at https://api.geckoterminal.com/docs/index.html).
 *
 * Selection method (deterministic given the response cache):
 * 1. Discovery. GeckoTerminal's Top Pools by Dex (`/networks/solana/dexes/{pumpswap,pump-fun}/pools`),
 *    Top Pools by Network (`/networks/solana/pools`, by 24h tx count and by 24h volume), Trending
 *    Pools (`/networks/solana/trending_pools?duration=24h`) and Search Pools (`/search/pools`) for a
 *    fixed list of meme keywords, plus DexScreener's pair search (`/latest/dex/search?q=<keyword>`
 *    and `<keyword> pump`; 300 req/min, so it supplies most candidates cheaply). The searches are
 *    what surface older and dead coins; the top lists are dominated by coins that are alive today.
 *    Candidates are interleaved across these sources, oldest first within each.
 * 2. Eligibility. The base token is a pump.fun mint (address ends in `pump`, pump.fun's vanity
 *    suffix), the quote token is wrapped SOL, the dex is PumpSwap (post-graduation AMM), Pump.fun
 *    (the bonding curve itself) or Raydium (pre-PumpSwap graduations), and the pool was created
 *    between MAX_AGE_DAYS ago and 72 h before `asOf`, so the whole window is in the past. Requiring
 *    a pump mint quoted in SOL excludes stablecoins and majors by construction. One pool per token:
 *    PumpSwap over Raydium over Pump.fun, then the earliest created.
 * 3. Screen. One hourly OHLCV request per candidate: hours with trades x 60 bounds the number of
 *    minute candles, and the hourly tag predicts the minute one, so pools that can't reach the
 *    candle bar or whose predicted tag is already full are skipped without fetching minute pages.
 * 4. Fetch. The 72 h of minute candles are fetched and re-tagged on the minute data (authoritative).
 *    A pool is kept if it has >= MIN_CANDLES candles, or if it is a `rug` with >= MIN_RUG_CANDLES
 *    (at most MAX_SPARSE of those, so dead-after-the-rug coins are represented too); no tag may take
 *    more than TAG_SHARE of TARGET. Stops at TARGET pools.
 *
 * Outcome tags (first rule that matches; prices are candle closes, start = first close in the window):
 *   pump      end >= 3x start
 *   rug       max drawdown from the running peak >= 90%
 *   fade      end <= 0.5x start (a bleed that never lost 90% from a peak)
 *   chop      max close / min close <= 3 (range-bound)
 *   survivor  anything else: ended between 0.5x and 3x start after a > 3x range
 *
 * Output (apps/agent/backtest/data/, gitignored):
 *   <pool>.json  { pool, baseToken, symbol, dex, createdAt, timeframe: "minute",
 *                  candles: [[t, o, h, l, c, volumeUsd], ...] }  t = unix s, ascending, window =
 *                  the 4320 minutes from the minute of pool creation. GeckoTerminal omits minutes
 *                  without trades and so does the dataset: a missing minute means no trade
 *                  (consumers forward-fill `c`).
 *   index.json   { asOf, rules, pools: [{ file, pool, baseToken, symbol, dex, createdAt, source, tag,
 *                  candles, coverage, maxGapMin, endMult, peakMult, maxDrawdown, rangeMult }] }
 *   .cache/      every API response keyed by request path, plus the pinned `asOf` time: re-runs
 *                never refetch and select the same pools. Delete it to rebuild from today's lists.
 *
 * GeckoTerminal's public rate limit is ~10 calls/min: requests are spaced GT_INTERVAL_MS apart,
 * 429/5xx/network errors retry with exponential backoff (honouring Retry-After) and widen the spacing.
 *
 * Env (defaults): TARGET (80), MIN_CANDLES (1500), MIN_RUG_CANDLES (300), MAX_SPARSE (12),
 *   TAG_SHARE (0.35), MAX_AGE_DAYS (150), GT_INTERVAL_MS (6000)
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const WSOL = "So11111111111111111111111111111111111111112";
const WINDOW_S = 72 * 3600;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const CACHE_DIR = path.join(DATA_DIR, ".cache");

const num = (key: string, dflt: number) => {
  const v = process.env[key];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number, got ${v}`);
  return n;
};
const TARGET = num("TARGET", 80);
const MIN_CANDLES = num("MIN_CANDLES", 1500);
const MIN_RUG_CANDLES = num("MIN_RUG_CANDLES", 300);
const MAX_SPARSE = num("MAX_SPARSE", 12);
const TAG_CAP = Math.ceil(TARGET * num("TAG_SHARE", 0.35));
const MAX_AGE_S = num("MAX_AGE_DAYS", 150) * 86_400;

const DEXES = ["pumpswap", "raydium", "pump-fun"] as const; // preference order for one pool per token
const TAGS = ["pump", "rug", "fade", "chop", "survivor"] as const;
type Tag = (typeof TAGS)[number];
const SEARCH_TERMS = [
  "cat", "dog", "pepe", "frog", "trump", "ai", "moon", "inu", "wif", "elon", "doge", "chad", "wojak",
  "pump", "baby", "king", "meme", "monkey", "ape", "bull", "bear", "coin", "gm", "grok", "penguin",
  "hat", "fart", "sigma", "based", "mog", "rat", "goat", "pig", "duck", "fish", "rocket", "gold",
  "god", "kid", "boy", "girl", "man", "world", "jeet", "rich", "cult", "agent", "bot", "sol",
];

type Candle = [t: number, o: number, h: number, l: number, c: number, volumeUsd: number];
interface Candidate {
  pool: string;
  baseToken: string;
  dex: string;
  createdAt: number;
  source: string;
}
interface Outcome {
  tag: Tag;
  endMult: number;
  peakMult: number;
  maxDrawdown: number;
  rangeMult: number;
}
interface IndexEntry extends Outcome {
  file: string;
  pool: string;
  baseToken: string;
  symbol: string;
  dex: string;
  createdAt: number;
  source: string;
  candles: number;
  coverage: number;
  maxGapMin: number;
}
interface GtPool {
  attributes: { address: string; pool_created_at: string | null };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}
interface GtOhlcv {
  data: { attributes: { ohlcv_list: Candle[] } };
  meta?: { base?: { address: string; symbol: string } };
}
interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string };
  quoteToken: { address: string };
  pairCreatedAt?: number;
}

// ---------- HTTP: throttled, retried, cached ----------

interface Api {
  base: string;
  headers: Record<string, string>;
  intervalMs: number;
  maxIntervalMs: number;
  nextAt: number;
  requests: number;
}
const GECKO: Api = {
  base: "https://api.geckoterminal.com/api/v2",
  headers: { accept: "application/json;version=20230203" },
  intervalMs: num("GT_INTERVAL_MS", 6000),
  maxIntervalMs: 10_000,
  nextAt: 0,
  requests: 0,
};
/** DexScreener search (300 req/min) widens discovery; candles always come from GeckoTerminal. */
const DEXSCREENER: Api = { base: "https://api.dexscreener.com", headers: {}, intervalMs: 300, maxIntervalMs: 5000, nextAt: 0, requests: 0 };

/** GET an API path; responses (including 404 as `null`) are cached on disk forever. */
async function get<T>(api: Api, p: string): Promise<T | null> {
  const url = api.base + p;
  const file = path.join(CACHE_DIR, url.replace(/^https:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "_") + ".json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T | null;
  for (let attempt = 0; ; attempt++) {
    const wait = api.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    api.nextAt = Date.now() + api.intervalMs;
    let status = 0;
    let retryAfter = 0;
    try {
      api.requests++;
      const res = await fetch(url, { headers: api.headers });
      status = res.status;
      if (res.ok || status === 404) {
        const body = status === 404 ? null : ((await res.json()) as T);
        fs.writeFileSync(file, JSON.stringify(body));
        return body;
      }
      retryAfter = Number(res.headers.get("retry-after")) || 0;
      await res.body?.cancel();
    } catch (e) {
      console.warn(`  ${url}: ${(e as Error).message}`);
    }
    if (status !== 0 && status !== 429 && status < 500) throw new Error(`GET ${url}: HTTP ${status}`);
    if (attempt >= 8) throw new Error(`GET ${url}: giving up after ${attempt + 1} attempts (last HTTP ${status})`);
    if (status === 429) api.intervalMs = Math.min(Math.round(api.intervalMs * 1.3), api.maxIntervalMs);
    const backoff = Math.max(retryAfter * 1000, Math.min(120_000, 10_000 * 2 ** attempt));
    console.warn(`  HTTP ${status || "error"} on ${url}; retrying in ${backoff / 1000}s (spacing now ${api.intervalMs}ms)`);
    await sleep(backoff);
  }
}

// ---------- outcome tagging ----------

function classify(closes: number[]): Outcome {
  const start = closes[0];
  let peak = start;
  let hi = start;
  let lo = start;
  let maxDrawdown = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    maxDrawdown = Math.max(maxDrawdown, 1 - c / peak);
    hi = Math.max(hi, c);
    lo = Math.min(lo, c);
  }
  const endMult = closes[closes.length - 1] / start;
  const rangeMult = hi / lo;
  const tag: Tag =
    endMult >= 3 ? "pump" : maxDrawdown >= 0.9 ? "rug" : endMult <= 0.5 ? "fade" : rangeMult <= 3 ? "chop" : "survivor";
  return { tag, endMult, peakMult: hi / start, maxDrawdown, rangeMult };
}

// ---------- discovery ----------

const addr = (id: string) => id.slice(id.indexOf("_") + 1);

async function discover(asOf: number): Promise<Candidate[]> {
  const byToken = new Map<string, Candidate>();
  let listed = 0;
  const consider = (pool: string, baseToken: string, quoteToken: string, dex: string, createdMs: number, source: string) => {
    listed++;
    if (!DEXES.includes(dex as (typeof DEXES)[number]) || !baseToken.endsWith("pump")) return;
    if (quoteToken !== WSOL || !Number.isFinite(createdMs)) return;
    const createdAt = Math.floor(createdMs / 1000);
    if (createdAt + WINDOW_S > asOf || createdAt < asOf - MAX_AGE_S) return;
    const cand: Candidate = { pool, baseToken, dex, createdAt, source };
    const prev = byToken.get(baseToken);
    const rank = (c: Candidate) => DEXES.indexOf(c.dex as (typeof DEXES)[number]);
    if (!prev || rank(cand) < rank(prev) || (rank(cand) === rank(prev) && cand.createdAt < prev.createdAt)) {
      byToken.set(baseToken, cand);
    }
  };

  const lists: string[] = [];
  for (let page = 1; page <= 10; page++) lists.push(`/networks/solana/dexes/pumpswap/pools?page=${page}&sort=h24_tx_count_desc`);
  for (let page = 1; page <= 2; page++) lists.push(`/networks/solana/dexes/pump-fun/pools?page=${page}&sort=h24_tx_count_desc`);
  for (const sort of ["h24_tx_count_desc", "h24_volume_usd_desc"]) {
    for (let page = 1; page <= 5; page++) lists.push(`/networks/solana/pools?page=${page}&sort=${sort}`);
  }
  for (let page = 1; page <= 5; page++) lists.push(`/networks/solana/trending_pools?page=${page}&duration=24h`);
  for (const term of SEARCH_TERMS) lists.push(`/search/pools?query=${term}&network=solana&page=1`);
  for (const [i, src] of lists.entries()) {
    if (i % 20 === 0) console.log(`  GeckoTerminal lists ${i + 1}/${lists.length} (${byToken.size} eligible tokens so far)`);
    for (const p of (await get<{ data: GtPool[] }>(GECKO, src))?.data ?? []) {
      const created = p.attributes.pool_created_at ? Date.parse(p.attributes.pool_created_at) : NaN;
      const r = p.relationships;
      consider(p.attributes.address, addr(r.base_token.data.id), addr(r.quote_token.data.id), r.dex.data.id, created, src.split("?")[0]);
    }
  }
  // DexScreener names the dexes differently; its "raydium" without a label is the AMM v4 that
  // pump.fun graduated to before PumpSwap (CPMM/CLMM pools carry a label).
  const dsDex: Record<string, string> = { pumpfun: "pump-fun", pumpswap: "pumpswap", raydium: "raydium" };
  for (const term of SEARCH_TERMS) {
    for (const q of [term, `${term} pump`]) {
      const res = await get<{ pairs: DsPair[] | null }>(DEXSCREENER, `/latest/dex/search?q=${encodeURIComponent(q)}`);
      for (const p of res?.pairs ?? []) {
        if (p.chainId !== "solana" || p.labels?.length) continue;
        const dex = dsDex[p.dexId] ?? p.dexId;
        consider(p.pairAddress, p.baseToken.address, p.quoteToken.address, dex, p.pairCreatedAt ?? NaN, "dexscreener/search");
      }
    }
  }
  console.log(`discovery: ${listed} pools listed, ${byToken.size} eligible tokens`);

  // Stable order that interleaves the sources, so no single list dominates the first picks.
  const bySource = new Map<string, Candidate[]>();
  for (const c of byToken.values()) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
  const sorted = [...bySource.values()].map((l) => l.sort((a, b) => a.createdAt - b.createdAt));
  const out: Candidate[] = [];
  for (let i = 0; out.length < byToken.size; i++) for (const l of sorted) if (l[i]) out.push(l[i]);
  return out;
}

// ---------- candles ----------

async function hourCandles(c: Candidate): Promise<Candle[]> {
  const res = await get<GtOhlcv>(
    GECKO,
    `/networks/solana/pools/${c.pool}/ohlcv/hour?aggregate=1&limit=100&before_timestamp=${c.createdAt + WINDOW_S}&currency=usd`,
  );
  const from = c.createdAt - (c.createdAt % 3600);
  return (res?.data.attributes.ohlcv_list ?? []).filter((k) => k[0] >= from).sort((a, b) => a[0] - b[0]);
}

/** The window's minute candles (GeckoTerminal pages newest-first, 1000 per page), or null if the
 *  pool is gone or GeckoTerminal quotes it the other way round. */
async function minuteCandles(c: Candidate): Promise<{ symbol: string; candles: Candle[] } | null> {
  const from = c.createdAt - (c.createdAt % 60);
  const to = from + WINDOW_S;
  const byT = new Map<number, Candle>();
  let symbol = "";
  for (let before = to; ; ) {
    const res = await get<GtOhlcv>(
      GECKO,
      `/networks/solana/pools/${c.pool}/ohlcv/minute?aggregate=1&limit=1000&before_timestamp=${before}&currency=usd`,
    );
    if (!res || res.meta?.base?.address !== c.baseToken) return null;
    symbol = res.meta.base.symbol;
    const list = res.data.attributes.ohlcv_list;
    for (const k of list) if (k[0] >= from && k[0] < to) byT.set(k[0], k);
    const oldest = Math.min(...list.map((k) => k[0]));
    if (list.length < 1000 || oldest <= from || oldest >= before) break;
    before = oldest;
  }
  return { symbol, candles: [...byT.values()].sort((a, b) => a[0] - b[0]) };
}

/** Longest run of minutes without a candle in the window starting at `from`. */
function maxGapMinutes(candles: Candle[], from: number) {
  let gap = 0;
  let prev = from - 60;
  for (const [t] of candles) {
    gap = Math.max(gap, (t - prev) / 60 - 1);
    prev = t;
  }
  return Math.max(gap, (from + WINDOW_S - prev) / 60 - 1);
}

// ---------- main ----------

async function main() {
  const started = Date.now();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const asOfFile = path.join(CACHE_DIR, "asof.json");
  if (!fs.existsSync(asOfFile)) fs.writeFileSync(asOfFile, JSON.stringify({ asOf: Math.floor(Date.now() / 1000) }));
  const { asOf } = JSON.parse(fs.readFileSync(asOfFile, "utf8")) as { asOf: number };
  console.log(`asOf ${new Date(asOf * 1000).toISOString()} (pinned in ${path.relative(process.cwd(), asOfFile)})`);

  const candidates = await discover(asOf);

  const kept: IndexEntry[] = [];
  const tagCount: Record<Tag, number> = { pump: 0, rug: 0, fade: 0, chop: 0, survivor: 0 };
  let sparse = 0;
  let screened = 0;

  const writeIndex = () =>
    fs.writeFileSync(
      path.join(DATA_DIR, "index.json"),
      JSON.stringify(
        {
          asOf,
          rules: {
            window: "first 72 h after pool creation, 1-minute candles, minutes without trades omitted",
            price: "USD per base token (GeckoTerminal currency=usd), tags on candle closes, start = first close",
            pump: "end >= 3x start",
            rug: "max drawdown from running peak >= 90%",
            fade: "end <= 0.5x start",
            chop: "max close / min close <= 3",
            survivor: "otherwise",
            keep: `>= ${MIN_CANDLES} candles, or rug with >= ${MIN_RUG_CANDLES} (max ${MAX_SPARSE})`,
          },
          pools: kept,
        },
        null,
        1,
      ),
    );

  for (const c of candidates) {
    if (kept.length >= TARGET) break;
    // Hourly screen (one request): hours with trades x 60 bounds the minute candle count, and the
    // hourly tag predicts the minute one, so full tags and hopeless pools skip the minute pages.
    screened++;
    const hours = await hourCandles(c);
    if (hours.length * 60 < Math.min(MIN_CANDLES, MIN_RUG_CANDLES)) continue;
    const pre = classify(hours.map((k) => k[4])).tag;
    if (tagCount[pre] >= TAG_CAP) continue;
    if (hours.length * 60 < MIN_CANDLES && (pre !== "rug" || sparse >= MAX_SPARSE)) continue;
    const got = await minuteCandles(c);
    if (!got || got.candles.length < Math.min(MIN_CANDLES, MIN_RUG_CANDLES)) continue;
    const { symbol, candles } = got;
    const o = classify(candles.map((k) => k[4]));
    const dense = candles.length >= MIN_CANDLES;
    if (!dense && (o.tag !== "rug" || sparse >= MAX_SPARSE)) continue;
    if (tagCount[o.tag] >= TAG_CAP) continue;
    if (!dense) sparse++;
    tagCount[o.tag]++;
    const file = `${c.pool}.json`;
    const pool = { pool: c.pool, baseToken: c.baseToken, symbol, dex: c.dex, createdAt: c.createdAt, timeframe: "minute", candles };
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(pool));
    const round = (x: number) => Math.round(x * 1e4) / 1e4;
    kept.push({
      file,
      pool: c.pool,
      baseToken: c.baseToken,
      symbol,
      dex: c.dex,
      createdAt: c.createdAt,
      source: c.source,
      tag: o.tag,
      candles: candles.length,
      coverage: round(candles.length / (WINDOW_S / 60)),
      maxGapMin: maxGapMinutes(candles, c.createdAt - (c.createdAt % 60)),
      endMult: round(o.endMult),
      peakMult: round(o.peakMult),
      maxDrawdown: round(o.maxDrawdown),
      rangeMult: round(o.rangeMult),
    });
    writeIndex();
    console.log(
      `  [${kept.length}/${TARGET}, screened ${screened}/${candidates.length}] ${symbol.padEnd(12)} ${c.dex.padEnd(8)} ${o.tag.padEnd(8)} ${String(candles.length).padStart(4)} candles` +
        `  end ${o.endMult.toFixed(2)}x peak ${o.peakMult.toFixed(2)}x dd ${(o.maxDrawdown * 100).toFixed(0)}%`,
    );
  }
  writeIndex();

  // Drop pool files a previous run kept but this one didn't.
  const keep = new Set(kept.map((k) => k.file));
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (f.endsWith(".json") && f !== "index.json" && !keep.has(f)) fs.rmSync(path.join(DATA_DIR, f));
  }

  const total = kept.reduce((s, k) => s + k.candles, 0);
  const bytes = [...keep].reduce((s, f) => s + fs.statSync(path.join(DATA_DIR, f)).size, 0);
  console.log(
    `done: ${kept.length} pools (${TAGS.map((t) => `${t} ${tagCount[t]}`).join(", ")}) from ${screened} screened, ` +
      `${kept.filter((k) => k.candles >= MIN_CANDLES).length} with >= ${MIN_CANDLES} candles, ` +
      `${total} candles, ${(bytes / 1e6).toFixed(1)} MB, ${GECKO.requests} GeckoTerminal + ${DEXSCREENER.requests} DexScreener requests, ${((Date.now() - started) / 60_000).toFixed(1)} min`,
  );
  if (kept.length < TARGET) console.warn(`only ${kept.length}/${TARGET} pools qualified; widen discovery`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
