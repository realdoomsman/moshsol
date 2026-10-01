import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Store, type TradeDbRow } from "./db";

/** A v1 `trades` table (every program-only column NOT NULL, no `source`) with one agent trade. */
function seedV1(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE trades (
      signature TEXT NOT NULL, event_index INTEGER NOT NULL, slot INTEGER NOT NULL, timestamp INTEGER NOT NULL,
      launch TEXT NOT NULL, trader TEXT NOT NULL, is_buy INTEGER NOT NULL, is_agent INTEGER NOT NULL,
      sol_amount TEXT NOT NULL, token_amount TEXT NOT NULL, fee TEXT NOT NULL, price_sol REAL NOT NULL,
      ema_sol REAL NOT NULL, vault_sol TEXT NOT NULL, vault_tokens TEXT NOT NULL, real_sol TEXT NOT NULL,
      token_reserve TEXT NOT NULL, sol REAL NOT NULL, PRIMARY KEY (signature, event_index));
    CREATE INDEX trades_launch ON trades(launch, slot);
    INSERT INTO trades VALUES ('sigA', 0, 10, 1000, 'L', 'agent', 1, 1, '2000000000', '500', '0', 2e-9, 2.1e-9, '7', '8', '9', '10', 2.0);
    PRAGMA user_version = 1;
  `);
  db.close();
}

const pumpTrade = (signature: string, timestamp: number, lamports: bigint): TradeDbRow => ({
  signature,
  event_index: 0,
  slot: 20,
  timestamp,
  launch: "L",
  trader: "public",
  is_buy: 1,
  is_agent: 0,
  source: "pump",
  sol_amount: lamports.toString(),
  token_amount: "1",
  fee: "1",
  price_sol: 3e-9,
  ema_sol: null,
  vault_sol: null,
  vault_tokens: null,
  real_sol: "1",
  token_reserve: "1",
  sol: Number(lamports) / 1e9,
});

test("a v1 database migrates to v2: program trades keep their columns, pump trades can be booked next to them", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holdfast-db-"));
  const file = path.join(dir, "indexer.db");
  seedV1(file);

  const store = new Store(file);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const [agent] = store.trades("L", { beforeTs: Number.MAX_SAFE_INTEGER, limit: 10, agentOnly: true, side: null, minSol: null, trader: null });
  assert.ok(agent);
  assert.equal(agent.source, "holdfast");
  assert.equal(agent.ema_sol, 2.1e-9);
  assert.equal(agent.vault_sol, "7");

  store.insertTrade(pumpTrade("sigB", 2000, 1_500_000_000n));
  store.insertTrade(pumpTrade("sigC", 2500, 500_000_000n));
  const all = store.trades("L", { beforeTs: Number.MAX_SAFE_INTEGER, limit: 10, agentOnly: false, side: null, minSol: null, trader: null });
  assert.deepEqual(
    all.map((r) => [r.signature, r.source, r.ema_sol]),
    [
      ["sigC", "pump", null],
      ["sigB", "pump", null],
      ["sigA", "holdfast", 2.1e-9],
    ],
  );
  // Public trades count towards the launch totals the chain can't see, and the 24h window spans both sources.
  const agg = store.tradeAggregate("L", 3000);
  assert.ok(agg);
  assert.equal(agg.pump_n, 2);
  assert.equal(agg.pump_lamports, 2_000_000_000);
  assert.equal(agg.v24, 4);
  assert.equal(agg.buyers24, 1);
  assert.equal(agg.last_ts, 2500);
});
