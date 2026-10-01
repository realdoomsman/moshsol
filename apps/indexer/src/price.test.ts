import assert from "node:assert/strict";
import { test } from "node:test";
import { PRICE_SOURCES, SolPrice, type PriceSource, type PriceState } from "./price";

const WSOL = "So11111111111111111111111111111111111111112";

function memoryState(initial?: Record<string, string>): PriceState & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial ?? {}));
  return { map, getState: (k) => map.get(k) ?? null, setState: (k, v) => void map.set(k, v) };
}

type Reply = { status: number; body: unknown } | Error;

/** A `fetch` answering by URL; records every call so tests can assert the fallback order. */
function fakeFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const reply = replies[url];
    if (!reply) throw new Error(`unexpected url ${url}`);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const quiet = { info: () => undefined, warn: () => undefined };
const logs = () => {
  const lines: string[] = [];
  return { lines, info: (_o: unknown, msg?: string) => void lines.push(`info ${msg}`), warn: (_o: unknown, msg?: string) => void lines.push(`warn ${msg}`) };
};

const jupiter = { status: 200, body: { [WSOL]: { usdPrice: 150.25 } } };
const coingecko = { status: 200, body: { solana: { usd: 149.9 } } };
const [JUP_URL, CG_URL] = PRICE_SOURCES.map((s) => s.url);

test("primary source wins and the price is persisted", async () => {
  const state = memoryState();
  const { fetch, calls } = fakeFetch({ [JUP_URL]: jupiter, [CG_URL]: coingecko });
  const price = new SolPrice(state, quiet, { refreshMs: 60_000, fetch, now: () => 1_000 });
  assert.equal(price.current, null);
  assert.deepEqual(await price.refresh(), { usd: 150.25, at: 1_000 });
  assert.deepEqual(price.current, { usd: 150.25, at: 1_000 });
  assert.deepEqual(calls, [JUP_URL]);
  assert.equal(state.map.get("sol_usd"), JSON.stringify({ usd: 150.25, at: 1_000 }));
});

test("falls back to the next source on HTTP errors, network errors and malformed bodies", async () => {
  for (const bad of [
    { status: 503, body: {} },
    new Error("ECONNRESET"),
    { status: 200, body: { [WSOL]: { usdPrice: "150" } } },
    { status: 200, body: { [WSOL]: { usdPrice: 0 } } },
    { status: 200, body: null },
  ] as Reply[]) {
    const { fetch, calls } = fakeFetch({ [JUP_URL]: bad, [CG_URL]: coingecko });
    const price = new SolPrice(memoryState(), quiet, { refreshMs: 60_000, fetch, now: () => 7 });
    assert.deepEqual(await price.refresh(), { usd: 149.9, at: 7 });
    assert.deepEqual(calls, [JUP_URL, CG_URL]);
  }
});

test("a full outage keeps the last good price and logs once until recovery", async () => {
  const log = logs();
  const replies: Record<string, Reply> = { [JUP_URL]: jupiter, [CG_URL]: coingecko };
  const { fetch } = fakeFetch(replies);
  let t = 100;
  const state = memoryState();
  const price = new SolPrice(state, log, { refreshMs: 60_000, fetch, now: () => t });
  await price.refresh();

  replies[JUP_URL] = new Error("timeout");
  replies[CG_URL] = { status: 429, body: {} };
  t = 200;
  assert.equal(await price.refresh(), null);
  assert.equal(await price.refresh(), null);
  assert.deepEqual(price.current, { usd: 150.25, at: 100 });
  assert.equal(state.map.get("sol_usd"), JSON.stringify({ usd: 150.25, at: 100 }));
  assert.deepEqual(log.lines, ["warn sol price feeds unavailable; keeping the last price"]);

  replies[CG_URL] = coingecko;
  t = 300;
  assert.deepEqual(await price.refresh(), { usd: 149.9, at: 300 });
  assert.deepEqual(log.lines, ["warn sol price feeds unavailable; keeping the last price", "info sol price feed recovered"]);
});

test("a persisted price is served before the first fetch; garbage state is ignored", () => {
  const good = new SolPrice(memoryState({ sol_usd: JSON.stringify({ usd: 123.4, at: 42 }) }), quiet, { refreshMs: 60_000 });
  assert.deepEqual(good.current, { usd: 123.4, at: 42 });
  for (const raw of ["not json", JSON.stringify({ usd: -1, at: 1 }), JSON.stringify({ usd: "5", at: 1 }), JSON.stringify({ usd: 5 })]) {
    assert.equal(new SolPrice(memoryState({ sol_usd: raw }), quiet, { refreshMs: 60_000 }).current, null, raw);
  }
});

test("the live feeds answer with the documented shapes", async () => {
  const { fetch, calls } = fakeFetch({
    [JUP_URL]: { status: 200, body: { [WSOL]: { usdPrice: 119.53, liquidity: 9.7e8, decimals: 9 } } },
    [CG_URL]: { status: 200, body: { solana: { usd: 119.43, last_updated_at: 1790835350 } } },
  });
  const only = (s: PriceSource) => new SolPrice(memoryState(), quiet, { refreshMs: 60_000, fetch, sources: [s], now: () => 0 });
  assert.equal((await only(PRICE_SOURCES[0]).refresh())?.usd, 119.53);
  assert.equal((await only(PRICE_SOURCES[1]).refresh())?.usd, 119.43);
  assert.deepEqual(calls, [JUP_URL, CG_URL]);
});
