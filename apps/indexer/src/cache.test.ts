import assert from "node:assert/strict";
import { test } from "node:test";
import { TtlCache } from "./cache";

function clock(start = 0) {
  let t = start;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
}

test("concurrent gets of one key share a single load; the value is reused until the TTL passes", async () => {
  const c = clock();
  const cache = new TtlCache<number>(1_000, 10, c.now);
  let loads = 0;
  const load = async () => ++loads;
  const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  c.tick(999);
  assert.equal(await cache.get("k", load), 1);
  c.tick(1);
  assert.equal(await cache.get("k", load), 2);
  assert.equal(loads, 2);
});

test("a failed load is not cached and the next get retries", async () => {
  const cache = new TtlCache<number>(1_000);
  await assert.rejects(cache.get("k", async () => Promise.reject(new Error("rpc down"))), /rpc down/);
  assert.equal(await cache.get("k", async () => 7), 7);
});

test("bounded: past maxKeys the oldest entry goes first (expired ones before that)", async () => {
  const c = clock();
  const cache = new TtlCache<string>(1_000, 2, c.now);
  let loads = 0;
  const load = (v: string) => async () => (loads++, v);
  await cache.get("a", load("a"));
  await cache.get("b", load("b"));
  await cache.get("c", load("c")); // evicts a (oldest)
  assert.equal(loads, 3);
  await cache.get("b", load("b!"));
  assert.equal(loads, 3);
  await cache.get("a", load("a!")); // evicts b
  assert.equal(loads, 4);
  await cache.get("b", load("b2"));
  assert.equal(loads, 5);
});
