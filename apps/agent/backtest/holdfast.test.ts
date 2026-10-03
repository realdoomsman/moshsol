import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MIN_SEGMENT_CANDLES } from "./evaluate";
import { WINDOW_S } from "./fetch";
import { eligible, holdfastPool, refreshHoldfast, type HoldfastCandle, type HoldfastLaunch, type HoldfastPoolFile } from "./holdfast";

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function launch(address: string, launchedAt: number, over: Partial<HoldfastLaunch> = {}): HoldfastLaunch {
  return { address, mint: `${address}mint`, symbol: address.toUpperCase(), venue: "pump", status: "live", launchedAt, bundleSol: "10000000000", ...over };
}

/** `n` minute candles from `from`, price 1e-7 SOL rising 1% a minute, 1 SOL volume each. */
function minutes(from: number, n: number): HoldfastCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = 1e-7 * 1.01 ** i;
    return { time: from + i * 60, open: p, high: p * 1.02, low: p * 0.99, close: p * 1.01, volumeSol: 1 };
  });
}

test("eligible: launched pump launches at least 6 h old", () => {
  assert.equal(eligible(launch("a", NOW - 7 * HOUR), NOW), true);
  assert.equal(eligible(launch("a", NOW - 7 * HOUR, { status: "woundDown" }), NOW), true);
  assert.equal(eligible(launch("a", NOW - 5 * HOUR), NOW), false, "too young for a meaningful window");
  assert.equal(eligible(launch("a", NOW - 7 * HOUR, { venue: "holdfast" }), NOW), false);
  assert.equal(eligible(launch("a", 0, { status: "raising" }), NOW), false);
  assert.equal(eligible(launch("a", NOW - 7 * HOUR, { status: "refunding" }), NOW), false);
});

test("indexer candles become a SOL-quoted pool file: 72 h window from the launch minute, bundle out of the first minute's volume", () => {
  const launchedAt = 1_790_980_702; // mid-minute
  const origin = 1_790_980_680;
  const l = launch("abc", launchedAt);
  const inWindow = minutes(origin, MIN_SEGMENT_CANDLES + 1);
  inWindow[0]!.volumeSol = 68.3; // the launch bundle (10 SOL) is booked in the first candle
  inWindow[5]!.low = 0; // unusable print
  const before = { ...inWindow[1]!, time: origin - 60 };
  const after = { ...inWindow[1]!, time: origin + WINDOW_S };
  const pool = holdfastPool(l, [after, ...inWindow.slice().reverse(), before], 1_791_000_000)!;
  assert.equal(pool.quote, "SOL");
  assert.equal(pool.pool, "abc");
  assert.equal(pool.baseToken, "abcmint");
  assert.equal(pool.createdAt, launchedAt);
  assert.equal(pool.fetchedAt, 1_791_000_000);
  assert.equal(pool.candles.length, MIN_SEGMENT_CANDLES, "outside the window and non-positive prices dropped");
  assert.deepEqual(
    pool.candles.map((k) => k[0]),
    inWindow.filter((_, i) => i !== 5).map((k) => k.time),
    "ascending",
  );
  const first = pool.candles[0]!;
  assert.deepEqual(first.slice(1, 5), [inWindow[0]!.open, inWindow[0]!.high, inWindow[0]!.low, inWindow[0]!.close], "prices kept in SOL per token");
  assert.ok(Math.abs(first[5] - 58.3) < 1e-9, "first minute's volume without the 10 SOL bundle");
  assert.equal(pool.candles[1]![5], 1, "later volume untouched");

  // A bundle larger than the first minute's volume floors it at 0; one candle short of a segment is no pool.
  const small = minutes(origin, MIN_SEGMENT_CANDLES);
  assert.equal(holdfastPool(launch("abc", launchedAt, { bundleSol: "999000000000" }), small, NOW)!.candles[0]![5], 0);
  assert.equal(holdfastPool(l, small.slice(1), NOW), null);
});

/** An indexer serving `launches` and candles per address; records the request paths and times. */
async function fakeIndexer(launches: HoldfastLaunch[], candles: Record<string, HoldfastCandle[]>) {
  const seen: { path: string; at: number }[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({ path: url.pathname, at: Date.now() });
    const m = /^\/api\/launches\/([^/]+)\/candles$/.exec(url.pathname);
    const body = url.pathname === "/api/launches" ? { launches, total: launches.length } : m ? { candles: candles[m[1]!] ?? [] } : null;
    res.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return { api: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

test("refresh: final windows are reused, new launches fetched up to the cap ≤ 1 req/s, unlisted ones dropped, other pools kept", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holdfast-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const done = launch("done", NOW - 100 * HOUR); // its 72 h window was complete when fetched
  const fresh = launch("fresh", NOW - 8 * HOUR); // never fetched; newest, so it gets the one fetch
  const capped = launch("capped", NOW - 9 * HOUR); // never fetched; over the cap this run
  const young = launch("young", NOW - 2 * HOUR); // not eligible yet
  const write = (file: string, body: unknown) => fs.writeFileSync(path.join(dir, file), JSON.stringify(body));
  const donePool = holdfastPool(done, minutes(Math.floor(done.launchedAt / 60) * 60, 100), done.launchedAt + WINDOW_S + 60)!;
  write("hf-done.json", donePool);
  write("hf-gone.json", { ...donePool, pool: "gone" }); // no longer listed (e.g. hidden)
  const gt = { file: "gt.json", pool: "gt", symbol: "GT", tag: "pump", candles: 2000, createdAt: 1, source: "dexscreener/search" };
  write("index.json", { asOf: 123, rules: { pump: "end >= 3x start" }, pools: [gt] });

  const idx = await fakeIndexer([young, fresh, capped, done], { fresh: minutes(Math.floor(fresh.launchedAt / 60) * 60, 300) });
  t.after(idx.close);
  const lines: string[] = [];
  const n = await refreshHoldfast({ dataDir: dir, api: idx.api, maxLaunches: 1, log: (l) => lines.push(l) });

  assert.equal(n, 2);
  assert.deepEqual(
    idx.seen.map((s) => s.path),
    ["/api/launches", "/api/launches/fresh/candles"],
    "the final window is not refetched, the capped launch waits for a later run",
  );
  assert.ok(idx.seen[1]!.at - idx.seen[0]!.at >= 990, "indexer requests at most one per second");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("hf-")).sort(), ["hf-done.json", "hf-fresh.json"]);
  const written = JSON.parse(fs.readFileSync(path.join(dir, "hf-fresh.json"), "utf8")) as HoldfastPoolFile;
  assert.equal(written.candles.length, 300);
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as { asOf: number; rules: Record<string, string>; pools: { file: string; source?: string; tag: string }[] };
  assert.equal(index.asOf, 123, "the GeckoTerminal dataset's age is untouched");
  assert.equal(index.rules.pump, "end >= 3x start");
  assert.match(index.rules.holdfast!, /SOL per token/);
  assert.deepEqual(
    index.pools.map((p) => [p.file, p.source]),
    [
      ["gt.json", "dexscreener/search"],
      ["hf-fresh.json", "holdfast"],
      ["hf-done.json", "holdfast"],
    ],
  );
  assert.equal(index.pools[1]!.tag, "pump", "tagged on the candle closes like the GeckoTerminal pools");

  // The next run within the hour reuses the in-progress window and fetches the launch that was over the cap.
  await refreshHoldfast({ dataDir: dir, api: idx.api, maxLaunches: 1 });
  assert.deepEqual(
    idx.seen.slice(2).map((s) => s.path),
    ["/api/launches", "/api/launches/capped/candles"],
  );
  assert.ok(lines.some((l) => /holdfast: 2 launches in the dataset/.test(l)));
});
