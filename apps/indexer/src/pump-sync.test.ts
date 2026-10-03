import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { Keypair, type ConfirmedSignatureInfo, type PublicKey, type SignaturesForAddressOptions } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import { DEFAULT_PUBKEY, Store } from "./db";
import type { Holders } from "./holders";
import type { Hub } from "./hub";
import type { LogsStream } from "./logs-stream";
import { PumpSync, RECONCILE_MS, SIG_PAGE, type PumpRpc } from "./pump-sync";

type Fixture = { logs: string[] };
const fixture = (name: string): Fixture =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Fixture;
// One public pump.fun buy of Gv2Ua42… on its curve, one PumpSwap buy on pool BH7cxk…: every signature below reuses one.
const CURVE_LOGS = fixture("pump-buy").logs;
const POOL_LOGS = fixture("pumpswap-trade").logs;
const MINT = "Gv2Ua42upzCwZ3gboZvrkhwp8y21NdVmyJiUFcGyJP5J";
const POOL = "BH7cxkSLYieJPA6KuNLdnuTbH91fj7LnNy6T5AHFNi7t";
const CURVE = Keypair.generate().publicKey.toBase58();
const LAUNCH = Keypair.generate().publicKey.toBase58();
const PROGRAM = Keypair.generate().publicKey.toBase58();

const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent } as unknown as FastifyBaseLogger;

interface ChainSig {
  signature: string;
  slot: number;
  failed: boolean;
  logs: string[];
}

/**
 * A venue account's history as an RPC node serves it: newest first, `before`/`until` exclusive, `limit` per page.
 * `pageCap` shortens a page (nodes do: a short page is not the end); `failListing` / `failFetch` throw once.
 */
class FakeChain implements PumpRpc {
  readonly history = new Map<string, ChainSig[]>();
  readonly fetches: string[] = [];
  pageCap: number | null = null;
  failListing: ((call: number) => boolean) | null = null;
  failFetch = new Set<string>();
  invisible = new Set<string>();
  private listings = 0;
  private slot = 1_000;

  /** Appends `n` new signatures (oldest first) to `account`; every `failEvery`-th one failed on chain. */
  add(account: string, n: number, logs: string[], failEvery = 0): string[] {
    const list = this.history.get(account) ?? [];
    const added: string[] = [];
    for (let i = 0; i < n; i++) {
      const signature = `${account.slice(0, 4)}-${this.slot}`;
      list.unshift({ signature, slot: this.slot++, failed: failEvery > 0 && i % failEvery === failEvery - 1, logs });
      added.push(signature);
    }
    this.history.set(account, list);
    return added;
  }

  getSignaturesForAddress = (async (address: PublicKey, o: SignaturesForAddressOptions = {}): Promise<ConfirmedSignatureInfo[]> => {
    if (this.failListing?.(this.listings++)) throw new Error("429 Too Many Requests");
    const list = this.history.get(address.toBase58()) ?? [];
    let from = o.before === undefined ? 0 : list.findIndex((s) => s.signature === o.before) + 1;
    const out: ConfirmedSignatureInfo[] = [];
    const limit = Math.min(o.limit ?? SIG_PAGE, this.pageCap ?? Infinity);
    for (; from < list.length && out.length < limit; from++) {
      const s = list[from]!;
      if (s.signature === o.until) break;
      out.push({ signature: s.signature, slot: s.slot, err: s.failed ? { InstructionError: [0, "Custom"] } : null, memo: null, blockTime: null });
    }
    return out;
  }) as PumpRpc["getSignaturesForAddress"];

  getTransaction = (async (signature: string) => {
    this.fetches.push(signature);
    if (this.failFetch.delete(signature)) throw new Error("429 Too Many Requests");
    if (this.invisible.has(signature)) return null;
    for (const list of this.history.values()) {
      const s = list.find((x) => x.signature === signature);
      if (s) return { slot: s.slot, meta: { err: s.failed ? "failed" : null, logMessages: s.logs } };
    }
    return null;
  }) as unknown as PumpRpc["getTransaction"];
}

function setup(graduated: boolean) {
  const store = new Store(":memory:");
  const base = { address: LAUNCH, mint: MINT, venue: "pump" as const, status: "live" };
  store.insertLaunch({ ...base, creator: DEFAULT_PUBKEY, idx: 1, created_at: 1, name: "T", symbol: "T", uri: "", meta_status: "ok" });
  const snapshot = (g: boolean) => {
    const snap = { ...base, pump: { bondingCurve: CURVE, pool: POOL, graduated: g } };
    store.setSnapshot({ ...base, snapshot: JSON.stringify(snap), slot: 1, pumpMeta: null });
  };
  snapshot(graduated);
  const chain = new FakeChain();
  const watched = new Set<string>();
  const stream = { watch: (a: string) => watched.add(a), unwatch: (a: string) => watched.delete(a) } as unknown as LogsStream;
  const hub = { broadcast() {} } as unknown as Hub;
  const holders = { invalidate() {} } as unknown as Holders;
  const clock = { now: 1_800_000_000_000 };
  const sync = new PumpSync(store, chain, hub, holders, stream, PROGRAM, silent, { onTrade() {} }, () => clock.now);
  const trades = () =>
    store.trades(LAUNCH, { beforeTs: Number.MAX_SAFE_INTEGER, limit: 100_000, agentOnly: false, side: null, minSol: null, trader: null });
  /** Polls (stepping past any backoff) until nothing changes. */
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      sync.syncTargets();
      const before = chain.fetches.length;
      await sync.poll();
      clock.now += 6 * 60_000;
      if (chain.fetches.length === before) return;
    }
    throw new Error("did not settle");
  };
  return { store, chain, sync, watched, clock, trades, settle, graduate: () => snapshot(true) };
}

const successful = (chain: FakeChain, account: string) => chain.history.get(account)!.filter((s) => !s.failed).map((s) => s.signature);
const signatures = (rows: { signature: string }[]) => new Set(rows.map((r) => r.signature));

test("a venue first watched is indexed from its whole history, past full and short pages; failed transactions are never fetched", async (t) => {
  const { store, chain, sync, trades, settle } = setup(false);
  t.after(() => store.close());
  chain.add(CURVE, 2_345, CURVE_LOGS, 3);
  chain.pageCap = 700;

  await settle();

  const want = successful(chain, CURVE);
  assert.equal(want.length, 1_564);
  assert.deepEqual(signatures(trades()), new Set(want));
  assert.equal(store.getState(`pump_cursor:${CURVE}`), chain.history.get(CURVE)![0]!.signature);
  assert.ok(chain.fetches.every((sig) => want.includes(sig)), "failed signatures are skipped from the listing");
  assert.equal(new Set(chain.fetches).size, chain.fetches.length, "nothing is fetched twice");

  // A live notification is booked once; the next scans list it but never fetch it.
  const [live] = chain.add(CURVE, 1, CURVE_LOGS);
  await sync.onLogs(live!, 9_999, CURVE_LOGS);
  await settle();
  assert.equal(trades().length, 1_565);
  assert.ok(!chain.fetches.includes(live!));
});

test("an RPC error or a transaction not visible yet never moves the cursor past an unbooked signature", async (t) => {
  const { store, chain, trades, settle, sync, clock } = setup(false);
  t.after(() => store.close());
  const sigs = chain.add(CURVE, 1_500, CURVE_LOGS);
  const cursor = () => store.getState(`pump_cursor:${CURVE}`);

  // The second page of the listing fails: nothing is booked from the first one.
  chain.failListing = (call) => call === 1;
  sync.syncTargets();
  await sync.poll();
  assert.equal(trades().length, 0);
  assert.equal(cursor(), null);

  // A fetch fails mid-way and a later transaction is not visible yet: each stops the cursor right before it.
  chain.failListing = null;
  chain.failFetch.add(sigs[300]!);
  clock.now += 6 * 60_000;
  await sync.poll();
  assert.equal(cursor(), sigs[299], "booked up to the batch before the failed fetch");
  assert.equal(trades().length, 300);

  chain.invisible.add(sigs[700]!);
  clock.now += 6 * 60_000;
  await sync.poll();
  assert.equal(cursor(), sigs[699]);
  assert.equal(trades().length, 700);

  chain.invisible.clear();
  await settle();
  assert.equal(cursor(), sigs.at(-1));
  assert.deepEqual(signatures(trades()), new Set(sigs));
});

test("graduation keeps the curve watched until its last pre-migration trade is indexed; the pool is indexed from its first signature", async (t) => {
  const { store, chain, sync, watched, trades, settle, graduate, clock } = setup(false);
  t.after(() => store.close());
  chain.add(CURVE, 400, CURVE_LOGS);
  await settle();
  // The curve's busiest stretch lands while the scan is rate limited and the websocket missed it...
  chain.add(CURVE, 900, CURVE_LOGS, 4);
  chain.failListing = () => true;
  sync.syncTargets();
  await sync.poll();
  // ...then it migrates: a pool with far more (mostly failed bot) signatures than one page by the time it is first seen.
  chain.add(POOL, 2_600, POOL_LOGS, 5);
  chain.add(CURVE, 30, CURVE_LOGS, 1);
  graduate();
  chain.failListing = null;
  clock.now += 6 * 60_000;

  await settle();

  const want = new Set([...successful(chain, CURVE), ...successful(chain, POOL)]);
  assert.equal(want.size, 400 + 675 + 2_080);
  assert.deepEqual(signatures(trades()), want);
  assert.equal(store.getState(`pump_drained:${CURVE}`), "1");
  assert.deepEqual([...watched], [POOL], "the drained curve is dropped, the pool stays");
  sync.syncTargets();
  assert.deepEqual([...watched], [POOL], "and stays dropped");
});

test("the reconcile books signatures the cursor scan stepped over, and a legacy cursor's uncovered history on start", async (t) => {
  const { store, chain, trades, settle, sync, clock } = setup(true);
  t.after(() => store.close());
  store.setState(`pump_drained:${CURVE}`, "1");
  const old = chain.add(POOL, 1_200, POOL_LOGS);
  // A cursor left by an older indexer that only backfilled the newest signatures (and booked none of the rest).
  store.setState(`pump_cursor:${POOL}`, old.at(-1)!);
  await settle();
  assert.deepEqual(signatures(trades()), new Set(old), "the first reconcile walks the whole history");
  assert.equal(store.getState(`pump_reconciled:${POOL}`), old.at(-1));

  // A signature surfaces behind the cursor (the scan already moved past its position).
  chain.add(POOL, 5, POOL_LOGS);
  const list = chain.history.get(POOL)!;
  const late = { signature: "late-sig", slot: list[2]!.slot, failed: false, logs: POOL_LOGS };
  sync.syncTargets();
  await sync.poll();
  list.splice(3, 0, late);
  clock.now += RECONCILE_MS / 2;
  await sync.poll();
  assert.ok(!signatures(trades()).has("late-sig"), "the cursor scan never looks behind the cursor");
  clock.now += RECONCILE_MS;
  await sync.poll();
  assert.ok(signatures(trades()).has("late-sig"), "the reconcile does");
  assert.equal(trades().length, 1_206);
});
