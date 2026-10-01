import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchJson } from "@holdfast/sdk";
import { DEFAULT_PUBKEY, Store } from "./db";
import { HiddenLaunches } from "./hidden";
import type { SolPrice } from "./price";
import { LaunchSummaries, vaultModelOf } from "./summaries";

const TERMS = {
  tradeFeeBps: 0,
  backerFeeShareBps: 0,
  creatorFeeShareBps: 0,
  launchFeeBps: 100,
  agentBuyBpsPerWindow: 1000,
  agentSellBpsPerWindow: 500,
  agentMaxImpactBps: 300,
  agentBandBps: 200,
  agentWindowSecs: 3600,
  emaPeriodSecs: 1800,
  burnShareBps: 1500,
  creatorFeeVaultBps: 7500,
  payoutMultBps: 50_000,
  payoutShareBps: 1500,
  payoutIntervalSecs: 14_400,
  deadHoldersBps: 500,
  minVaultSol: "100000000",
} as LaunchJson["terms"];

test("payback target, multiple and the creator-fee split follow the frozen terms", () => {
  const m = vaultModelOf({
    terms: TERMS,
    initialVaultSol: "1000000000",
    vaultSol: "2500000000",
    backersRepaid: "1000000000",
    backerPayouts: "375000000",
    creatorFeesCollected: "1000000001",
  });
  assert.equal(m.payoutTargetSol, 5);
  assert.equal(m.payoutMultiple, 2.5);
  assert.equal(m.backersRepaidSol, 1);
  assert.equal(m.backerPayoutsSol, 0.375);
  assert.equal(m.backerCreatorFeeBps, 1000);
  assert.equal(m.minVaultSol, "100000000");
  // 75% / 15% rounded down in lamports, the backers get the remainder (so the three sum to the total).
  assert.deepEqual(m.creatorFeeSplit, { vaultSol: 0.75, burnSol: 0.15, backersSol: 0.100000001 });
});

test("a snapshot from before the vault model reads as zero instead of throwing", () => {
  const legacy = { ...TERMS } as Record<string, unknown>;
  for (const k of ["creatorFeeVaultBps", "payoutMultBps", "payoutShareBps", "payoutIntervalSecs", "deadHoldersBps", "minVaultSol"]) delete legacy[k];
  const m = vaultModelOf({ terms: legacy as LaunchJson["terms"], vaultSol: "5000", creatorFeesCollected: "1000" });
  assert.equal(m.payoutTargetSol, 0);
  assert.equal(m.payoutMultiple, 0);
  assert.equal(m.backersRepaidSol, 0);
  assert.equal(m.creatorFeeVaultBps, 0);
  assert.equal(m.backerCreatorFeeBps, 8500);
  assert.equal(m.minVaultSol, "0");
  assert.deepEqual(m.creatorFeeSplit, { vaultSol: 0, burnSol: 0.00000015, backersSol: 0.00000085 });
});

const LAUNCH = "Yw9a3uqxNVDhfD7FBmcbAeZAn81nRuG3Q1K3GDLJfYs";
const MINT = "GyHYt6bjNkXVmECCuzKsMuZLXW8T8L6g8oTH7hhyxnPy";

/** A live pump launch with a snapshot carrying what a summary reads. */
function seedLive(store: Store): void {
  const base = { address: LAUNCH, mint: MINT, venue: "pump" as const, status: "live" };
  store.insertLaunch({ ...base, creator: DEFAULT_PUBKEY, idx: 1, created_at: 1, name: "T", symbol: "T", uri: "", meta_status: "ok" });
  const snap = { ...base, priceSol: 1e-7, marketCapSol: 100, tradeCount: 0, volumeSol: "0", vaultSol: "0", creatorFeesCollected: "0", terms: TERMS };
  store.setSnapshot({ ...base, snapshot: JSON.stringify(snap), slot: 1, pumpMeta: null });
}

function trade(store: Store, signature: string, timestamp: number, sol: number): void {
  store.insertTrade({
    signature,
    event_index: 0,
    slot: timestamp,
    timestamp,
    launch: LAUNCH,
    trader: DEFAULT_PUBKEY,
    is_buy: 1,
    is_agent: 0,
    source: "pump",
    sol_amount: String(sol * 1e9),
    token_amount: "1",
    fee: "0",
    price_sol: 1e-7,
    ema_sol: null,
    vault_sol: null,
    vault_tokens: null,
    real_sol: "0",
    token_reserve: "0",
    sol,
  });
}

test("cached summaries show a write at once, by address and by mint", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  seedLive(store);
  const nowMs = 1_800_000_000_000;
  // A TTL far longer than the test: only the write can refresh the cache.
  const summaries = new LaunchSummaries(store, {} as SolPrice, new HiddenLaunches(), 3_600_000, () => nowMs);
  assert.equal(summaries.byId(LAUNCH)?.volume1hSol, 0);
  assert.equal(summaries.all(), summaries.all(), "reads between writes share one computation");

  trade(store, "sigA", nowMs / 1000 - 60, 2.5);
  assert.equal(summaries.byId(LAUNCH)?.volume1hSol, 2.5);
  assert.equal(summaries.byId(MINT)?.trades1h, 1);
  assert.equal(summaries.byId(DEFAULT_PUBKEY), undefined);
});

test("without writes, the rolling windows are at most one TTL behind the clock", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  seedLive(store);
  let nowMs = 1_800_000_000_000;
  const summaries = new LaunchSummaries(store, {} as SolPrice, new HiddenLaunches(), 5_000, () => nowMs);
  // On the 1h window's edge: one more second and it falls out.
  trade(store, "sigA", nowMs / 1000 - 3_600, 1);
  assert.equal(summaries.byId(LAUNCH)?.volume1hSol, 1);
  nowMs += 1_000;
  assert.equal(summaries.byId(LAUNCH)?.volume1hSol, 1, "within the TTL the cached value stands");
  nowMs += 4_000;
  assert.equal(summaries.byId(LAUNCH)?.volume1hSol, 0);
  assert.equal(summaries.byId(LAUNCH)?.volume24hSol, 1);
});
