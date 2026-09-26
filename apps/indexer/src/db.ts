import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { ActivityType } from "./types";

export type MetaStatus = "pending" | "ok" | "error" | "none";

export type LaunchDbRow = {
  address: string;
  mint: string;
  creator: string;
  idx: number;
  status: string;
  created_at: number;
  onchain_name: string;
  onchain_symbol: string;
  uri: string;
  /** JSON `LaunchJson` of the latest account snapshot; null until the account was first fetched. */
  snapshot: string | null;
  snapshot_slot: number;
  launch_price: number | null;
  launch_ts: number | null;
  bundle_sol: number | null;
  meta_status: MetaStatus;
  meta_attempts: number;
  meta_next_at: number;
  meta_name: string | null;
  meta_symbol: string | null;
  description: string | null;
  image: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  /** JSON string[] */
  whitelist: string | null;
  holders: number;
  holders_at: number;
};

export type TradeDbRow = {
  signature: string;
  event_index: number;
  slot: number;
  timestamp: number;
  launch: string;
  trader: string;
  is_buy: number;
  is_agent: number;
  sol_amount: string;
  token_amount: string;
  fee: string;
  price_sol: number;
  ema_sol: number;
  vault_sol: string;
  vault_tokens: string;
  real_sol: string;
  token_reserve: string;
  /** sol_amount in SOL, for aggregation. */
  sol: number;
};

export type EventDbRow = {
  signature: string;
  event_index: number;
  slot: number;
  timestamp: number;
  type: ActivityType;
  launch: string;
  actor: string | null;
  is_agent: number | null;
  is_buy: number | null;
  sol_amount: string | null;
  token_amount: string | null;
};

export type DepositDbRow = {
  signature: string;
  event_index: number;
  slot: number;
  timestamp: number;
  launch: string;
  backer: string;
  amount: string;
  raised: string;
};

/** Activity row joined with launch display fields. */
export type ActivityDbRow = {
  signature: string;
  event_index: number;
  timestamp: number;
  type: ActivityType;
  actor: string;
  is_agent: number | null;
  is_buy: number | null;
  sol_amount: string | null;
  token_amount: string | null;
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
};

export type AgentTradeDbRow = TradeDbRow & { mint: string; symbol: string };

export type TradeAggDbRow = {
  launch: string;
  v24: number;
  v1: number;
  last_ts: number | null;
};

export type CandlePointDbRow = { timestamp: number; price_sol: number; sol: number };

export type NewLaunchRow = {
  address: string;
  mint: string;
  creator: string;
  idx: number;
  status: string;
  created_at: number;
  name: string;
  symbol: string;
  uri: string;
  meta_status: MetaStatus;
};

export interface MetaUpdate {
  status: MetaStatus;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  whitelist: string[] | null;
}

export type TableCounts = Record<"txs" | "events" | "trades" | "deposits" | "launches", number>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS txs (
  signature TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  event_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS launches (
  address TEXT PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  creator TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  onchain_name TEXT NOT NULL,
  onchain_symbol TEXT NOT NULL,
  uri TEXT NOT NULL,
  snapshot TEXT,
  snapshot_slot INTEGER NOT NULL DEFAULT 0,
  launch_price REAL,
  launch_ts INTEGER,
  bundle_sol REAL,
  meta_status TEXT NOT NULL DEFAULT 'pending',
  meta_attempts INTEGER NOT NULL DEFAULT 0,
  meta_next_at INTEGER NOT NULL DEFAULT 0,
  meta_name TEXT,
  meta_symbol TEXT,
  description TEXT,
  image TEXT,
  twitter TEXT,
  telegram TEXT,
  website TEXT,
  whitelist TEXT,
  holders INTEGER NOT NULL DEFAULT 0,
  holders_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS launches_creator ON launches(creator);
CREATE TABLE IF NOT EXISTS events (
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  launch TEXT NOT NULL,
  actor TEXT,
  is_agent INTEGER,
  is_buy INTEGER,
  sol_amount TEXT,
  token_amount TEXT,
  PRIMARY KEY (signature, event_index)
);
CREATE INDEX IF NOT EXISTS events_order ON events(slot);
CREATE TABLE IF NOT EXISTS trades (
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  launch TEXT NOT NULL,
  trader TEXT NOT NULL,
  is_buy INTEGER NOT NULL,
  is_agent INTEGER NOT NULL,
  sol_amount TEXT NOT NULL,
  token_amount TEXT NOT NULL,
  fee TEXT NOT NULL,
  price_sol REAL NOT NULL,
  ema_sol REAL NOT NULL,
  vault_sol TEXT NOT NULL,
  vault_tokens TEXT NOT NULL,
  real_sol TEXT NOT NULL,
  token_reserve TEXT NOT NULL,
  sol REAL NOT NULL,
  PRIMARY KEY (signature, event_index)
);
CREATE INDEX IF NOT EXISTS trades_launch ON trades(launch, slot);
CREATE INDEX IF NOT EXISTS trades_time ON trades(timestamp);
CREATE INDEX IF NOT EXISTS trades_agent ON trades(is_agent, slot);
CREATE TABLE IF NOT EXISTS deposits (
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  launch TEXT NOT NULL,
  backer TEXT NOT NULL,
  amount TEXT NOT NULL,
  raised TEXT NOT NULL,
  PRIMARY KEY (signature, event_index)
);
CREATE INDEX IF NOT EXISTS deposits_launch ON deposits(launch, slot);
`;

const DATA_TABLES = ["txs", "launches", "events", "trades", "deposits", "sync_state"] as const;

const LAUNCH_NAME = "COALESCE(l.meta_name, l.onchain_name)";
const LAUNCH_SYMBOL = "COALESCE(l.meta_symbol, l.onchain_symbol)";
const ACTIVITY_SELECT = `
  SELECT e.signature, e.event_index, e.timestamp, e.type, COALESCE(e.actor, l.creator) AS actor, e.is_agent, e.is_buy,
    e.sol_amount, e.token_amount, l.mint AS mint, ${LAUNCH_NAME} AS name, ${LAUNCH_SYMBOL} AS symbol, l.image AS image
  FROM events e JOIN launches l ON l.address = e.launch`;
const TRADE_AGG = `
  SELECT launch,
    COALESCE(SUM(CASE WHEN timestamp >= :day THEN sol END), 0) AS v24,
    COALESCE(SUM(CASE WHEN timestamp >= :hour THEN sol END), 0) AS v1,
    MAX(timestamp) AS last_ts
  FROM trades`;

const SQL = {
  getState: "SELECT value FROM sync_state WHERE key = ?",
  setState:
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  hasTx: "SELECT 1 AS one FROM txs WHERE signature = ?",
  insertTx: "INSERT OR IGNORE INTO txs (signature, slot, failed, event_count) VALUES (?, ?, ?, ?)",
  upsertCreated: `
    INSERT INTO launches (address, mint, creator, idx, status, created_at, onchain_name, onchain_symbol, uri, meta_status)
    VALUES (:address, :mint, :creator, :idx, :status, :created_at, :name, :symbol, :uri, :meta_status)
    ON CONFLICT(address) DO UPDATE SET
      creator = excluded.creator, idx = excluded.idx, created_at = excluded.created_at,
      onchain_name = excluded.onchain_name, onchain_symbol = excluded.onchain_symbol, uri = excluded.uri`,
  insertLaunch: `
    INSERT OR IGNORE INTO launches (address, mint, creator, idx, status, created_at, onchain_name, onchain_symbol, uri, meta_status)
    VALUES (:address, :mint, :creator, :idx, :status, :created_at, :name, :symbol, :uri, :meta_status)`,
  setLaunched: "UPDATE launches SET launch_price = ?, launch_ts = ?, bundle_sol = ? WHERE address = ?",
  insertEvent: `
    INSERT OR IGNORE INTO events (signature, event_index, slot, timestamp, type, launch, actor, is_agent, is_buy, sol_amount, token_amount)
    VALUES (:signature, :event_index, :slot, :timestamp, :type, :launch, :actor, :is_agent, :is_buy, :sol_amount, :token_amount)`,
  insertTrade: `
    INSERT OR IGNORE INTO trades (signature, event_index, slot, timestamp, launch, trader, is_buy, is_agent, sol_amount,
      token_amount, fee, price_sol, ema_sol, vault_sol, vault_tokens, real_sol, token_reserve, sol)
    VALUES (:signature, :event_index, :slot, :timestamp, :launch, :trader, :is_buy, :is_agent, :sol_amount,
      :token_amount, :fee, :price_sol, :ema_sol, :vault_sol, :vault_tokens, :real_sol, :token_reserve, :sol)`,
  insertDeposit: `
    INSERT OR IGNORE INTO deposits (signature, event_index, slot, timestamp, launch, backer, amount, raised)
    VALUES (:signature, :event_index, :slot, :timestamp, :launch, :backer, :amount, :raised)`,
  launchByAddress: "SELECT * FROM launches WHERE address = ?",
  launchByMint: "SELECT * FROM launches WHERE mint = ?",
  allLaunches: "SELECT * FROM launches WHERE snapshot IS NOT NULL ORDER BY idx DESC",
  metaDue:
    "SELECT * FROM launches WHERE meta_status = 'pending' OR (meta_status = 'error' AND meta_attempts < ? AND meta_next_at <= ?)",
  setSnapshot: "UPDATE launches SET snapshot = ?, snapshot_slot = ?, status = ? WHERE address = ?",
  setSnapshotSlot: "UPDATE launches SET snapshot_slot = ? WHERE address = ?",
  setMeta: `
    UPDATE launches SET meta_status = :status, meta_name = :name, meta_symbol = :symbol, description = :description,
      image = :image, twitter = :twitter, telegram = :telegram, website = :website, whitelist = :whitelist
    WHERE address = :address`,
  setMetaError:
    "UPDATE launches SET meta_status = 'error', meta_attempts = meta_attempts + 1, meta_next_at = ? WHERE address = ?",
  setHolders: "UPDATE launches SET holders = ?, holders_at = ? WHERE address = ?",
  tradeAggAll: `${TRADE_AGG} GROUP BY launch`,
  tradeAggOne: `${TRADE_AGG} WHERE launch = :launch`,
  priceAt: "SELECT price_sol FROM trades WHERE launch = ? AND timestamp <= ? ORDER BY slot DESC, rowid DESC LIMIT 1",
  firstPrice: "SELECT price_sol FROM trades WHERE launch = ? ORDER BY slot ASC, rowid ASC LIMIT 1",
  trades: "SELECT * FROM trades WHERE launch = ? AND timestamp < ? ORDER BY slot DESC, rowid DESC LIMIT ?",
  candlePoints: "SELECT timestamp, price_sol, sol FROM trades WHERE launch = ? ORDER BY slot ASC, rowid ASC",
  deposits: "SELECT * FROM deposits WHERE launch = ? ORDER BY slot DESC, rowid DESC LIMIT ?",
  agentTrades: `
    SELECT t.*, l.mint AS mint, ${LAUNCH_SYMBOL} AS symbol
    FROM trades t JOIN launches l ON l.address = t.launch
    WHERE t.is_agent = 1 ORDER BY t.slot DESC, t.rowid DESC LIMIT ?`,
  volumeSince: "SELECT COALESCE(SUM(sol), 0) AS v FROM trades WHERE timestamp >= ?",
  activity: `${ACTIVITY_SELECT} ORDER BY e.slot DESC, e.rowid DESC LIMIT ?`,
  activityOne: `${ACTIVITY_SELECT} WHERE e.signature = ? AND e.event_index = ?`,
  counts: `
    SELECT (SELECT COUNT(*) FROM txs) AS txs, (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM trades) AS trades, (SELECT COUNT(*) FROM deposits) AS deposits,
      (SELECT COUNT(*) FROM launches) AS launches`,
} as const;

type Params = SQLInputValue[] | Record<string, SQLInputValue>;

function rows<T>(stmt: StatementSync, params: Params = []): T[] {
  return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params)) as unknown as T[];
}

function row<T>(stmt: StatementSync, params: Params = []): T | undefined {
  return (Array.isArray(params) ? stmt.get(...params) : stmt.get(params)) as unknown as T | undefined;
}

/** SQLite persistence (node:sqlite, WAL). All writes are synchronous; callers group them with `tx`. */
export class Store {
  private readonly db: DatabaseSync;
  private readonly stmts: Record<keyof typeof SQL, StatementSync>;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const stmts: Partial<Record<keyof typeof SQL, StatementSync>> = {};
    for (const key of Object.keys(SQL) as (keyof typeof SQL)[]) stmts[key] = this.db.prepare(SQL[key]);
    this.stmts = stmts as Record<keyof typeof SQL, StatementSync>;
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Drops every indexed row (used when the cluster genesis changes, e.g. a reset localnet). */
  wipe(): void {
    this.tx(() => {
      for (const t of DATA_TABLES) this.db.exec(`DELETE FROM ${t}`);
    });
  }

  close(): void {
    this.db.close();
  }

  // ---------------- sync state ----------------

  getState(key: string): string | null {
    return row<{ value: string }>(this.stmts.getState, [key])?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.stmts.setState.run(key, value);
  }

  hasTx(signature: string): boolean {
    return row(this.stmts.hasTx, [signature]) !== undefined;
  }

  markTx(signature: string, slot: number, failed: boolean, eventCount: number): void {
    this.stmts.insertTx.run(signature, slot, failed ? 1 : 0, eventCount);
  }

  counts(): TableCounts {
    return row<TableCounts>(this.stmts.counts)!;
  }

  // ---------------- event writes ----------------

  /** Insert-or-refresh from a `launchCreated` event (keeps any existing snapshot/metadata). */
  upsertCreatedLaunch(l: NewLaunchRow): void {
    this.stmts.upsertCreated.run(l);
  }

  setLaunched(address: string, price: number, ts: number, bundleSol: number): void {
    this.stmts.setLaunched.run(price, ts, bundleSol, address);
  }

  /** Returns true when the event row was new (idempotency on signature + event index). */
  insertEvent(e: EventDbRow): boolean {
    return this.stmts.insertEvent.run(e).changes > 0;
  }

  insertTrade(t: TradeDbRow): void {
    this.stmts.insertTrade.run(t);
  }

  insertDeposit(d: DepositDbRow): void {
    this.stmts.insertDeposit.run(d);
  }

  // ---------------- launches ----------------

  launch(address: string): LaunchDbRow | undefined {
    return row<LaunchDbRow>(this.stmts.launchByAddress, [address]);
  }

  launchByMint(mint: string): LaunchDbRow | undefined {
    return row<LaunchDbRow>(this.stmts.launchByMint, [mint]);
  }

  /** Launches with an on-chain snapshot, newest first. */
  launches(): LaunchDbRow[] {
    return rows<LaunchDbRow>(this.stmts.allLaunches);
  }

  /** Pending metadata plus failed fetches whose backoff elapsed and that have attempts left. */
  launchesWithMetaDue(nowMs: number, maxAttempts: number): LaunchDbRow[] {
    return rows<LaunchDbRow>(this.stmts.metaDue, [maxAttempts, nowMs]);
  }

  /** Insert a launch discovered from its account (no-op if already known). */
  insertLaunch(l: NewLaunchRow): void {
    this.stmts.insertLaunch.run(l);
  }

  setSnapshot(address: string, snapshot: string, slot: number, status: string): void {
    this.stmts.setSnapshot.run(snapshot, slot, status, address);
  }

  setSnapshotSlot(address: string, slot: number): void {
    this.stmts.setSnapshotSlot.run(slot, address);
  }

  setMeta(address: string, m: MetaUpdate): void {
    this.stmts.setMeta.run({
      address,
      status: m.status,
      name: m.name,
      symbol: m.symbol,
      description: m.description,
      image: m.image,
      twitter: m.twitter,
      telegram: m.telegram,
      website: m.website,
      whitelist: m.whitelist ? JSON.stringify(m.whitelist) : null,
    });
  }

  setMetaError(address: string, retryAtMs: number): void {
    this.stmts.setMetaError.run(retryAtMs, address);
  }

  setHolders(address: string, count: number, atMs: number): void {
    this.stmts.setHolders.run(count, atMs, address);
  }

  // ---------------- derived reads ----------------

  tradeAggregates(nowSecs: number): Map<string, TradeAggDbRow> {
    const out = new Map<string, TradeAggDbRow>();
    for (const r of rows<TradeAggDbRow>(this.stmts.tradeAggAll, { day: nowSecs - 86_400, hour: nowSecs - 3_600 })) {
      out.set(r.launch, r);
    }
    return out;
  }

  tradeAggregate(launch: string, nowSecs: number): TradeAggDbRow | undefined {
    const r = row<TradeAggDbRow>(this.stmts.tradeAggOne, { launch, day: nowSecs - 86_400, hour: nowSecs - 3_600 });
    // Aggregates without GROUP BY always yield one row; launch is null when there are no trades.
    return r && r.launch !== null ? r : undefined;
  }

  /** Price of the last trade at or before `ts`. */
  priceAt(launch: string, ts: number): number | null {
    return row<{ price_sol: number }>(this.stmts.priceAt, [launch, ts])?.price_sol ?? null;
  }

  firstTradePrice(launch: string): number | null {
    return row<{ price_sol: number }>(this.stmts.firstPrice, [launch])?.price_sol ?? null;
  }

  trades(launch: string, beforeTs: number, limit: number): TradeDbRow[] {
    return rows<TradeDbRow>(this.stmts.trades, [launch, beforeTs, limit]);
  }

  candlePoints(launch: string): CandlePointDbRow[] {
    return rows<CandlePointDbRow>(this.stmts.candlePoints, [launch]);
  }

  deposits(launch: string, limit: number): DepositDbRow[] {
    return rows<DepositDbRow>(this.stmts.deposits, [launch, limit]);
  }

  agentTrades(limit: number): AgentTradeDbRow[] {
    return rows<AgentTradeDbRow>(this.stmts.agentTrades, [limit]);
  }

  volumeSince(ts: number): number {
    return row<{ v: number }>(this.stmts.volumeSince, [ts])?.v ?? 0;
  }

  activity(limit: number): ActivityDbRow[] {
    return rows<ActivityDbRow>(this.stmts.activity, [limit]);
  }

  activityEvent(signature: string, eventIndex: number): ActivityDbRow | undefined {
    return row<ActivityDbRow>(this.stmts.activityOne, [signature, eventIndex]);
  }
}
