import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchJson } from "@holdfast/sdk";
import { Keypair } from "@solana/web3.js";
import Fastify from "fastify";
import { DEFAULT_PUBKEY, Store, type EventDbRow } from "./db";
import type { SolPrice } from "./price";
import { registerRoutes, type RouteDeps } from "./routes";
import { LaunchSummaries } from "./summaries";

const key = () => Keypair.generate().publicKey.toBase58();

/** `deposited × accFeePerShare / 1e18`: 1e15 per share entitles each lamport deposited to 0.001 lamport. */
const ACC_FEE_PER_SHARE = "1000000000000000";

function seedLaunch(store: Store, address: string, status: string, raised: bigint): void {
  store.insertLaunch({
    address,
    mint: DEFAULT_PUBKEY,
    venue: "pump",
    creator: key(),
    idx: 1,
    status,
    created_at: 1,
    name: "T",
    symbol: "T",
    uri: "",
    meta_status: "ok",
  });
  store.setSnapshot({
    address,
    snapshot: JSON.stringify({ raised: raised.toString(), accFeePerShare: ACC_FEE_PER_SHARE, status }),
    slot: 1,
    status,
    mint: DEFAULT_PUBKEY,
    venue: "pump",
    pumpMeta: null,
  });
}

function event(launch: string, actor: string, type: EventDbRow["type"], lamports: bigint, index: number): EventDbRow {
  return {
    signature: `sig${index}`,
    event_index: index,
    slot: 1,
    timestamp: 1,
    type,
    launch,
    actor,
    is_agent: null,
    is_buy: null,
    sol_amount: lamports.toString(),
    token_amount: null,
    ref: null,
  };
}

function deposit(store: Store, launch: string, backer: string, lamports: bigint, index: number): void {
  store.insertDeposit({ signature: `sig${index}`, event_index: index, slot: 1, timestamp: 1, launch, backer, amount: lamports.toString(), raised: "0" });
  store.insertEvent(event(launch, backer, "deposit", lamports, index));
}

/** Routes over an in-memory store; the chain client is never called by the routes tested here. */
async function app(store: Store) {
  const fastify = Fastify();
  const price = {} as SolPrice;
  const deps = { store, client: { connection: {}, programId: null }, sync: {}, price, summaries: new LaunchSummaries(store, price) };
  registerRoutes(fastify, deps as unknown as RouteDeps);
  await fastify.ready();
  return fastify;
}

test("backers come from the deposit ledger: summed per backer, refunded ones omitted, claims netted off claimable", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const launch = key();
  const [alice, bob, carol] = [key(), key(), key()];
  seedLaunch(store, launch, "live", 4_000_000n);
  deposit(store, launch, alice, 1_000_000n, 1);
  deposit(store, launch, alice, 2_000_000n, 2);
  deposit(store, launch, bob, 1_000_000n, 3);
  deposit(store, launch, carol, 500_000n, 4);
  // Carol refunded (her backer account is closed on chain); Alice claimed 1000 of her 3000 lamports.
  store.insertEvent(event(launch, carol, "refund", 500_000n, 5));
  store.insertEvent(event(launch, alice, "backer_claim", 1_000n, 6));
  // Another launch's ledger must not leak in.
  const other = key();
  seedLaunch(store, other, "live", 1n);
  deposit(store, other, bob, 9_000_000n, 7);

  const server = await app(store);
  t.after(() => server.close());
  const res = await server.inject({ method: "GET", url: `/api/launches/${launch}/backers` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    backers: [
      { owner: alice, deposited: "3000000", feesClaimed: "1000", claimable: "2000", shareBps: 7500 },
      { owner: bob, deposited: "1000000", feesClaimed: "0", claimable: "1000", shareBps: 2500 },
    ],
  });
});

/** A launched launch with what a summary reads; `mint` null = a pump launch still raising (no token yet). */
function seedTrading(store: Store, address: string, mint: string | null): void {
  const base = { address, mint: mint ?? DEFAULT_PUBKEY, venue: "pump" as const, status: mint ? "live" : "raising" };
  store.insertLaunch({ ...base, creator: key(), idx: 1, created_at: 1, name: "T", symbol: "T", uri: "", meta_status: "ok" });
  const terms = { burnShareBps: 1500, creatorFeeVaultBps: 7500, payoutMultBps: 50_000 } as LaunchJson["terms"];
  const snap = { ...base, priceSol: 1e-7, marketCapSol: 1, tradeCount: 0, volumeSol: "0", vaultSol: "0", creatorFeesCollected: "0", terms };
  store.setSnapshot({ ...base, snapshot: JSON.stringify(snap), slot: 1, pumpMeta: null });
}

function trade(store: Store, launch: string, signature: string, timestamp: number, price: number): void {
  store.insertTrade({
    signature,
    event_index: 0,
    slot: timestamp,
    timestamp,
    launch,
    trader: key(),
    is_buy: 1,
    is_agent: 0,
    source: "pump",
    sol_amount: "1000000000",
    token_amount: "1",
    fee: "0",
    price_sol: price,
    ema_sol: null,
    vault_sol: null,
    vault_tokens: null,
    real_sol: "0",
    token_reserve: "0",
    sol: 1,
  });
}

test("batch candles equal the per-launch answers (by address or mint), skip unknown ids and follow new trades", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const [a, aMint, b, unknown] = [key(), key(), key(), key()];
  seedTrading(store, a, aMint);
  seedTrading(store, b, null);
  trade(store, a, "s1", 900, 1e-7);
  trade(store, a, "s2", 1_850, 2e-7);
  trade(store, b, "s3", 1_000, 5e-8);

  const server = await app(store);
  t.after(() => server.close());
  const get = async (url: string) => (await server.inject({ method: "GET", url })).json();
  const batch = await get(`/api/candles?tf=900&ids=${aMint},${b},${unknown}`);
  assert.deepEqual(Object.keys(batch.candles), [aMint, b]);
  assert.deepEqual(batch.candles[aMint], (await get(`/api/launches/${a}/candles?tf=900`)).candles);
  assert.deepEqual(batch.candles[b], (await get(`/api/launches/${b}/candles?tf=900`)).candles);
  assert.equal(batch.candles[aMint].length, 2);

  // A trade after the first read lands in the next one (cached candles are dropped on every write).
  trade(store, a, "s4", 2_000, 3e-7);
  const after = await get(`/api/candles?tf=900&ids=${a}`);
  assert.equal(after.candles[a].at(-1).close, 3e-7);

  // `server.ts` maps ValidationError to 400; this bare app reports it as Fastify's default error body.
  const tooMany = Array.from({ length: 51 }, key).join(",");
  assert.match((await get(`/api/candles?ids=${tooMany}`)).message, /ids must list 1-50 launch ids/);
  assert.match((await get("/api/candles?ids=")).message, /ids must list/);
  assert.match((await get(`/api/candles?ids=${a},notakey`)).message, /launch id/);
});

test("stats: a raise past its deadline below its minimum is neither raising nor raised", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const now = Math.floor(Date.now() / 1000);
  const zero = { volumeSol: "0", vaultSol: "0", initialVaultSol: "0", vaultTokens: "0", backerFeesAccrued: "0", buybackPoolSol: "0", burnedSol: "0", creatorFeesCollected: "0" };
  const raise = (raised: bigint, deadline: number) => {
    const address = key();
    const base = { address, mint: DEFAULT_PUBKEY, venue: "pump" as const, status: "raising" };
    store.insertLaunch({ ...base, creator: key(), idx: 1, created_at: 1, name: "T", symbol: "T", uri: "", meta_status: "ok" });
    const snap = { ...base, ...zero, raised: raised.toString(), raiseMin: "1000000000", raiseMax: "5000000000", raiseDeadline: deadline, terms: { burnShareBps: 1500 } };
    store.setSnapshot({ ...base, snapshot: JSON.stringify(snap), slot: 1, pumpMeta: null });
  };
  raise(500_000_000n, now + 3_600); // open
  raise(2_000_000_000n, now - 60); // closed above its minimum: waiting for launch
  raise(500_000_000n, now - 60); // failed: refunds only

  const server = await app(store);
  t.after(() => server.close());
  const stats = (await server.inject({ method: "GET", url: "/api/stats" })).json();
  assert.equal(stats.totalLaunches, 3);
  assert.equal(stats.raisingLaunches, 2);
  assert.equal(stats.totalRaisedSol, 2.5);
});
