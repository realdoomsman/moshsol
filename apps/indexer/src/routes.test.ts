import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import Fastify from "fastify";
import { DEFAULT_PUBKEY, Store, type EventDbRow } from "./db";
import { registerRoutes, type RouteDeps } from "./routes";

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

/** Routes over an in-memory store; the chain client is never called by the backers route. */
async function app(store: Store) {
  const fastify = Fastify();
  const deps = { store, client: { connection: {}, programId: null }, sync: {}, price: {} } as unknown as RouteDeps;
  registerRoutes(fastify, deps);
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
