import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { LaunchVenue } from "@holdfast/sdk";
import type { ActivityType } from "./types";

/** `Pubkey::default()`: the mint of a pump launch before `launch_pump` created its token. */
export const DEFAULT_PUBKEY = "11111111111111111111111111111111";

export type MetaStatus = "pending" | "ok" | "error" | "none";

export type LaunchDbRow = {
  address: string;
  /** The token mint; `DEFAULT_PUBKEY` on a pump launch that hasn't launched yet. */
  mint: string;
  venue: LaunchVenue;
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
  /** Largest holder's share of supply in % (curve/vault excluded); null until holders were loaded. */
  top_holder_pct: number | null;
  /** Joined: the creator's profile name. */
  creator_name: string | null;
  /** Joined: visible (not deleted) comments on the launch. */
  comment_count: number;
};

/** A launch row whose account snapshot was fetched (what the list/search queries return). */
export type SnapshotLaunchDbRow = LaunchDbRow & { snapshot: string };

/** Where a trade row was decoded from: this program's `Trade` event, or the pump.fun / PumpSwap event of a public trade. */
export type TradeSource = "holdfast" | "pump";

export type TradeDbRow = {
  signature: string;
  event_index: number;
  slot: number;
  timestamp: number;
  launch: string;
  trader: string;
  is_buy: number;
  is_agent: number;
  source: TradeSource;
  sol_amount: string;
  token_amount: string;
  fee: string;
  price_sol: number;
  /** The program's EMA sample, vault SOL and vault tokens after the trade; null on public pump trades (no program state moved). */
  ema_sol: number | null;
  vault_sol: string | null;
  vault_tokens: string | null;
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
  /** Secondary pubkey of the event: the PumpSwap pool (`graduated`), the token burned (`buyback_burned`). */
  ref: string | null;
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
  ref: string | null;
  launch: string;
  venue: LaunchVenue;
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
};

export type AgentTradeDbRow = TradeDbRow & { mint: string; venue: LaunchVenue; symbol: string };

export type TradeAggDbRow = {
  launch: string;
  v24: number;
  v1: number;
  t1: number;
  buyers24: number;
  sellers24: number;
  last_ts: number | null;
  /** Public pump.fun / PumpSwap trades indexed for the launch and their SOL in lamports (the on-chain counters only see agent trades). */
  pump_n: number;
  pump_lamports: number;
};

/** The rolling-window part of `TradeAggDbRow`. */
type TradeWindowAggDbRow = Pick<TradeAggDbRow, "launch" | "v24" | "v1" | "t1" | "buyers24" | "sellers24">;
/** A `trade_totals` row: the all-time part of `TradeAggDbRow`, kept up to date by `insertTrade`. */
type TradeTotalsDbRow = Pick<TradeAggDbRow, "launch" | "last_ts" | "pump_n" | "pump_lamports">;
const NO_TRADES: Omit<TradeWindowAggDbRow, "launch"> = { v24: 0, v1: 0, t1: 0, buyers24: 0, sellers24: 0 };

/** Per-launch vault payouts/withdrawals from events (lamports and base units as decimal strings). */
export type VaultEventAggDbRow = {
  launch: string;
  profit_shared: string;
  withdrawn_sol: string;
  withdrawn_tokens: string;
  wound_down_ts: number | null;
  wound_down_sol: string | null;
  wound_down_tokens: string | null;
  wound_down_sig: string | null;
  payouts: number;
  last_payout_ts: number | null;
};

/** Per-launch pump.fun crank history from events (`collect_pump_fees`, `buyback_burn`, `graduate_pump`). */
export type PumpEventAggDbRow = {
  launch: string;
  fee_collections: number;
  buybacks: number;
  last_collected_ts: number | null;
  last_buyback_ts: number | null;
  graduated_ts: number | null;
  graduated_sig: string | null;
  graduated_pool: string | null;
};

export type CommentDbRow = {
  id: number;
  /** Launch address (comments are keyed by launch: pump launches have no mint while raising). */
  launch: string;
  /** Joined from the launch. */
  mint: string;
  wallet: string;
  body: string;
  reply_to: number | null;
  created_at: number;
  deleted_at: number | null;
  reply_count: number;
  author_name: string | null;
  author_avatar: string | null;
};

export type NewCommentRow = {
  launch: string;
  wallet: string;
  body: string;
  reply_to: number | null;
  created_at: number;
  signature: string;
  message: string;
};

export type ProfileDbRow = {
  wallet: string;
  name: string | null;
  bio: string | null;
  avatar: string | null;
  created_at: number;
  updated_at: number;
};

export type ProfileRef = { wallet: string; name: string | null; avatar: string | null };

export type WalletTradeAggDbRow = {
  wallet: string;
  trades: number;
  buys: number;
  buy_sol: number;
  sell_sol: number;
  volume: number;
  launches: number;
  net_tokens: number;
  first_ts: number | null;
  last_ts: number | null;
};

export type LaunchWindowAggDbRow = { launch: string; fees: number; volume: number; trades: number; traders: number };

export type TradeFilter = {
  beforeTs: number;
  limit: number;
  agentOnly: boolean;
  side: "buy" | "sell" | null;
  minSol: number | null;
  trader: string | null;
};

export type CandlePointDbRow = { timestamp: number; price_sol: number; sol: number };

export type NewLaunchRow = {
  address: string;
  mint: string;
  venue: LaunchVenue;
  creator: string;
  idx: number;
  status: string;
  created_at: number;
  name: string;
  symbol: string;
  uri: string;
  meta_status: MetaStatus;
};

/** A launch account snapshot to persist; `pumpMeta` carries the on-chain name/symbol/uri of pump launches. */
export type SnapshotUpdate = {
  address: string;
  snapshot: string;
  slot: number;
  status: string;
  mint: string;
  venue: LaunchVenue;
  pumpMeta: { name: string; symbol: string; uri: string } | null;
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

const LAUNCHES_COLUMNS = `
  address TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT 'holdfast',
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
  holders_at INTEGER NOT NULL DEFAULT 0,
  top_holder_pct REAL`;

const COMMENTS_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  launch TEXT NOT NULL,
  wallet TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to INTEGER,
  created_at INTEGER NOT NULL,
  signature TEXT NOT NULL,
  message TEXT NOT NULL,
  deleted_at INTEGER`;

const TRADES_COLUMNS = `
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  launch TEXT NOT NULL,
  trader TEXT NOT NULL,
  is_buy INTEGER NOT NULL,
  is_agent INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'holdfast',
  sol_amount TEXT NOT NULL,
  token_amount TEXT NOT NULL,
  fee TEXT NOT NULL,
  price_sol REAL NOT NULL,
  ema_sol REAL,
  vault_sol TEXT,
  vault_tokens TEXT,
  real_sol TEXT NOT NULL,
  token_reserve TEXT NOT NULL,
  sol REAL NOT NULL,
  PRIMARY KEY (signature, event_index)`;

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
CREATE TABLE IF NOT EXISTS launches (${LAUNCHES_COLUMNS});
CREATE INDEX IF NOT EXISTS launches_creator ON launches(creator);
CREATE UNIQUE INDEX IF NOT EXISTS launches_mint ON launches(mint) WHERE mint != '${DEFAULT_PUBKEY}';
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
  ref TEXT,
  PRIMARY KEY (signature, event_index)
);
CREATE INDEX IF NOT EXISTS events_order ON events(slot);
CREATE TABLE IF NOT EXISTS trades (${TRADES_COLUMNS});
CREATE INDEX IF NOT EXISTS trades_launch ON trades(launch, slot);
CREATE INDEX IF NOT EXISTS trades_time ON trades(timestamp);
CREATE INDEX IF NOT EXISTS trades_agent ON trades(is_agent, slot);
CREATE INDEX IF NOT EXISTS trades_launch_time ON trades(launch, timestamp);
CREATE TABLE IF NOT EXISTS trade_totals (
  launch TEXT PRIMARY KEY,
  last_ts INTEGER NOT NULL,
  pump_n INTEGER NOT NULL,
  pump_lamports INTEGER NOT NULL
);
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
CREATE INDEX IF NOT EXISTS deposits_backer ON deposits(backer, launch);
CREATE INDEX IF NOT EXISTS trades_trader ON trades(trader, timestamp);
CREATE INDEX IF NOT EXISTS events_actor ON events(actor, timestamp);
CREATE INDEX IF NOT EXISTS events_launch_slot ON events(launch, slot);
CREATE INDEX IF NOT EXISTS events_launch_type ON events(launch, type, slot);
CREATE INDEX IF NOT EXISTS events_type ON events(type, launch);
CREATE TABLE IF NOT EXISTS comments (${COMMENTS_COLUMNS});
CREATE INDEX IF NOT EXISTS comments_launch ON comments(launch, id);
CREATE INDEX IF NOT EXISTS comments_reply ON comments(reply_to);
CREATE INDEX IF NOT EXISTS comments_wallet ON comments(wallet, created_at);
CREATE TABLE IF NOT EXISTS signed_messages (
  hash TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signed_messages_ts ON signed_messages(ts);
CREATE TABLE IF NOT EXISTS profiles (
  wallet TEXT PRIMARY KEY,
  name TEXT,
  name_lower TEXT UNIQUE,
  bio TEXT,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS upload_spend (
  day TEXT PRIMARY KEY,
  lamports INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uploaded_images (
  url TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`;

/**
 * Schema version (`PRAGMA user_version`). 0 = the first deployment (`launches.mint` UNIQUE, comments keyed by
 * mint, no `events.ref`); 1 = pump launches (several raising launches share the default mint, so the mint
 * index is partial, comments are keyed by launch address and launches carry a venue); 2 = public pump.fun trades
 * (`trades.source`; the program-only columns `ema_sol`, `vault_sol`, `vault_tokens` are nullable); 3 = read-path
 * indexes and `trade_totals` (per-launch all-time trade totals kept on insert, so summaries never scan all trades).
 */
const SCHEMA_VERSION = 3;

/**
 * v0 → v1. SQLite can't drop an inline UNIQUE, so `launches` and `comments` are rebuilt (copy, drop,
 * rename; `SCHEMA` then re-creates their indexes). Every v0 launch is on the Holdfast curve.
 */
function migrateToV1(db: DatabaseSync): void {
  const columns = (table: string) => rows<{ name: string }>(db.prepare(`PRAGMA table_info(${table})`)).map((c) => c.name);
  const launchCols = columns("launches");
  const topHolder = launchCols.includes("top_holder_pct") ? "top_holder_pct" : "NULL";
  const kept = launchCols.filter((c) => c !== "top_holder_pct").join(", ");
  db.exec(`
    CREATE TABLE launches_v1 (${LAUNCHES_COLUMNS});
    INSERT INTO launches_v1 (${kept}, top_holder_pct, venue) SELECT ${kept}, ${topHolder}, 'holdfast' FROM launches;
    DROP TABLE launches;
    ALTER TABLE launches_v1 RENAME TO launches;
    CREATE TABLE comments_v1 (${COMMENTS_COLUMNS});
    INSERT INTO comments_v1 (id, launch, wallet, body, reply_to, created_at, signature, message, deleted_at)
      SELECT c.id, l.address, c.wallet, c.body, c.reply_to, c.created_at, c.signature, c.message, c.deleted_at
      FROM comments c JOIN launches l ON l.mint = c.mint;
    DROP TABLE comments;
    ALTER TABLE comments_v1 RENAME TO comments;
  `);
  if (!columns("events").includes("ref")) db.exec("ALTER TABLE events ADD COLUMN ref TEXT");
}

/** v1 → v2: `trades` is rebuilt (NOT NULL can't be dropped in place); every existing row came from the program. */
function migrateToV2(db: DatabaseSync): void {
  const kept =
    "signature, event_index, slot, timestamp, launch, trader, is_buy, is_agent, sol_amount, token_amount, fee, price_sol, " +
    "ema_sol, vault_sol, vault_tokens, real_sol, token_reserve, sol";
  db.exec(`
    CREATE TABLE trades_v2 (${TRADES_COLUMNS});
    INSERT INTO trades_v2 (${kept}, source) SELECT ${kept}, 'holdfast' FROM trades;
    DROP TABLE trades;
    ALTER TABLE trades_v2 RENAME TO trades;
  `);
}

/**
 * v2 → v3 (after `SCHEMA` created the new indexes and `trade_totals`): `events(launch)` is covered by
 * `events_launch_slot`, and `trade_totals` is filled from the trades so far (`insertTrade` keeps it from now on).
 */
function migrateToV3(db: DatabaseSync): void {
  db.exec(`
    DROP INDEX IF EXISTS events_launch;
    DELETE FROM trade_totals;
    INSERT INTO trade_totals (launch, last_ts, pump_n, pump_lamports)
      SELECT launch, MAX(timestamp), COUNT(CASE WHEN source = 'pump' THEN 1 END),
        COALESCE(SUM(CASE WHEN source = 'pump' THEN CAST(sol_amount AS INTEGER) END), 0)
      FROM trades GROUP BY launch;
  `);
}

/**
 * Wiped on a chain reset: everything keyed by chain state, including comments (their launches are gone).
 * `profiles` (wallet-keyed), `signed_messages` (replay guard, pruned by age) and the Arweave upload
 * ledger (`upload_spend`, `uploaded_images`) survive.
 */
const DATA_TABLES = ["txs", "launches", "events", "trades", "trade_totals", "deposits", "sync_state", "comments"] as const;

const LAUNCH_NAME = "COALESCE(l.meta_name, l.onchain_name)";
const LAUNCH_SYMBOL = "COALESCE(l.meta_symbol, l.onchain_symbol)";
const LAUNCH_SELECT = `
  SELECT l.*, p.name AS creator_name,
    (SELECT COUNT(*) FROM comments c WHERE c.launch = l.address AND c.deleted_at IS NULL) AS comment_count
  FROM launches l LEFT JOIN profiles p ON p.wallet = l.creator`;
const ACTIVITY_SELECT = `
  SELECT e.signature, e.event_index, e.timestamp, e.type, COALESCE(e.actor, l.creator) AS actor, e.is_agent, e.is_buy,
    e.sol_amount, e.token_amount, e.ref, l.address AS launch, l.venue AS venue, l.mint AS mint,
    ${LAUNCH_NAME} AS name, ${LAUNCH_SYMBOL} AS symbol, l.image AS image
  FROM events e JOIN launches l ON l.address = e.launch`;
/** Rolling 1h/24h trade aggregates; callers bound the scan with `timestamp >= :day` (the all-time part is `trade_totals`). */
const TRADE_WINDOW_AGG = `
  SELECT launch,
    COALESCE(SUM(sol), 0) AS v24,
    COALESCE(SUM(CASE WHEN timestamp >= :hour THEN sol END), 0) AS v1,
    COUNT(CASE WHEN timestamp >= :hour THEN 1 END) AS t1,
    COUNT(DISTINCT CASE WHEN is_agent = 0 AND is_buy = 1 THEN trader END) AS buyers24,
    COUNT(DISTINCT CASE WHEN is_agent = 0 AND is_buy = 0 THEN trader END) AS sellers24
  FROM trades`;
const VAULT_EVENT_AGG = `
  SELECT launch,
    CAST(COALESCE(SUM(CASE WHEN type = 'profit_shared' THEN CAST(sol_amount AS INTEGER) END), 0) AS TEXT) AS profit_shared,
    CAST(COALESCE(SUM(CASE WHEN type = 'vault_withdrawn' THEN CAST(sol_amount AS INTEGER) END), 0) AS TEXT) AS withdrawn_sol,
    CAST(COALESCE(SUM(CASE WHEN type = 'vault_withdrawn' THEN CAST(token_amount AS INTEGER) END), 0) AS TEXT)
      AS withdrawn_tokens,
    MAX(CASE WHEN type = 'wound_down' THEN timestamp END) AS wound_down_ts,
    MAX(CASE WHEN type = 'wound_down' THEN sol_amount END) AS wound_down_sol,
    MAX(CASE WHEN type = 'wound_down' THEN token_amount END) AS wound_down_tokens,
    MAX(CASE WHEN type = 'wound_down' THEN signature END) AS wound_down_sig,
    COUNT(CASE WHEN type = 'backers_paid' THEN 1 END) AS payouts,
    MAX(CASE WHEN type = 'backers_paid' THEN timestamp END) AS last_payout_ts
  FROM events WHERE type IN ('profit_shared', 'vault_withdrawn', 'wound_down', 'backers_paid')`;
const PUMP_EVENT_AGG = `
  SELECT launch,
    COUNT(CASE WHEN type = 'creator_fees_collected' THEN 1 END) AS fee_collections,
    COUNT(CASE WHEN type = 'buyback_burned' THEN 1 END) AS buybacks,
    MAX(CASE WHEN type = 'creator_fees_collected' THEN timestamp END) AS last_collected_ts,
    MAX(CASE WHEN type = 'buyback_burned' THEN timestamp END) AS last_buyback_ts,
    MAX(CASE WHEN type = 'graduated' THEN timestamp END) AS graduated_ts,
    MAX(CASE WHEN type = 'graduated' THEN signature END) AS graduated_sig,
    MAX(CASE WHEN type = 'graduated' THEN ref END) AS graduated_pool
  FROM events WHERE type IN ('creator_fees_collected', 'buyback_burned', 'graduated')`;
const WALLET_TRADE_AGG = `
  COUNT(*) AS trades, COALESCE(SUM(t.is_buy), 0) AS buys,
  COALESCE(SUM(CASE WHEN t.is_buy = 1 THEN t.sol END), 0) AS buy_sol,
  COALESCE(SUM(CASE WHEN t.is_buy = 0 THEN t.sol END), 0) AS sell_sol,
  COALESCE(SUM(t.sol), 0) AS volume, COUNT(DISTINCT t.launch) AS launches,
  COALESCE(SUM(CASE WHEN t.is_buy = 1 THEN CAST(t.token_amount AS INTEGER) ELSE -CAST(t.token_amount AS INTEGER) END), 0)
    AS net_tokens,
  MIN(t.timestamp) AS first_ts, MAX(t.timestamp) AS last_ts`;
const COMMENT_SELECT = `
  SELECT c.id, c.launch, l.mint AS mint, c.wallet, c.body, c.reply_to, c.created_at, c.deleted_at,
    (SELECT COUNT(*) FROM comments r WHERE r.reply_to = c.id AND r.deleted_at IS NULL) AS reply_count,
    p.name AS author_name, p.avatar AS author_avatar
  FROM comments c JOIN launches l ON l.address = c.launch LEFT JOIN profiles p ON p.wallet = c.wallet`;

const SQL = {
  getState: "SELECT value FROM sync_state WHERE key = ?",
  setState:
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  deleteState: "DELETE FROM sync_state WHERE key = ?",
  hasTx: "SELECT 1 AS one FROM txs WHERE signature = ?",
  txSlot: "SELECT slot FROM txs WHERE signature = ?",
  insertTx: "INSERT OR IGNORE INTO txs (signature, slot, failed, event_count) VALUES (?, ?, ?, ?)",
  upsertCreated: `
    INSERT INTO launches (address, mint, venue, creator, idx, status, created_at, onchain_name, onchain_symbol, uri, meta_status)
    VALUES (:address, :mint, :venue, :creator, :idx, :status, :created_at, :name, :symbol, :uri, :meta_status)
    ON CONFLICT(address) DO UPDATE SET
      creator = excluded.creator, idx = excluded.idx, created_at = excluded.created_at,
      onchain_name = excluded.onchain_name, onchain_symbol = excluded.onchain_symbol, uri = excluded.uri`,
  insertLaunch: `
    INSERT OR IGNORE INTO launches (address, mint, venue, creator, idx, status, created_at, onchain_name, onchain_symbol, uri, meta_status)
    VALUES (:address, :mint, :venue, :creator, :idx, :status, :created_at, :name, :symbol, :uri, :meta_status)`,
  setLaunched: "UPDATE launches SET mint = ?, launch_price = ?, launch_ts = ?, bundle_sol = ? WHERE address = ?",
  insertEvent: `
    INSERT OR IGNORE INTO events (signature, event_index, slot, timestamp, type, launch, actor, is_agent, is_buy, sol_amount, token_amount, ref)
    VALUES (:signature, :event_index, :slot, :timestamp, :type, :launch, :actor, :is_agent, :is_buy, :sol_amount, :token_amount, :ref)`,
  insertTrade: `
    INSERT OR IGNORE INTO trades (signature, event_index, slot, timestamp, launch, trader, is_buy, is_agent, source, sol_amount,
      token_amount, fee, price_sol, ema_sol, vault_sol, vault_tokens, real_sol, token_reserve, sol)
    VALUES (:signature, :event_index, :slot, :timestamp, :launch, :trader, :is_buy, :is_agent, :source, :sol_amount,
      :token_amount, :fee, :price_sol, :ema_sol, :vault_sol, :vault_tokens, :real_sol, :token_reserve, :sol)`,
  addTradeTotal: `
    INSERT INTO trade_totals (launch, last_ts, pump_n, pump_lamports) VALUES (:launch, :ts, :pump_n, CAST(:lamports AS INTEGER))
    ON CONFLICT(launch) DO UPDATE SET last_ts = MAX(last_ts, excluded.last_ts), pump_n = pump_n + excluded.pump_n,
      pump_lamports = pump_lamports + excluded.pump_lamports`,
  insertDeposit: `
    INSERT OR IGNORE INTO deposits (signature, event_index, slot, timestamp, launch, backer, amount, raised)
    VALUES (:signature, :event_index, :slot, :timestamp, :launch, :backer, :amount, :raised)`,
  launchByAddress: `${LAUNCH_SELECT} WHERE l.address = ?`,
  launchById: `${LAUNCH_SELECT} WHERE l.address = :id OR (l.mint = :id AND l.mint != '${DEFAULT_PUBKEY}')
    ORDER BY l.address = :id DESC LIMIT 1`,
  allLaunches: `${LAUNCH_SELECT} WHERE l.snapshot IS NOT NULL ORDER BY l.idx DESC`,
  launchTraders: "SELECT DISTINCT trader FROM trades WHERE launch = ? AND is_agent = 0",
  metaDue: `${LAUNCH_SELECT}
    WHERE l.meta_status = 'pending' OR (l.meta_status = 'error' AND l.meta_attempts < ? AND l.meta_next_at <= ?)`,
  setSnapshot: `
    UPDATE launches SET snapshot = :snapshot, snapshot_slot = :slot, status = :status, mint = :mint, venue = :venue,
      onchain_name = COALESCE(:name, onchain_name), onchain_symbol = COALESCE(:symbol, onchain_symbol), uri = COALESCE(:uri, uri)
    WHERE address = :address`,
  setSnapshotSlot: "UPDATE launches SET snapshot_slot = ? WHERE address = ?",
  setMeta: `
    UPDATE launches SET meta_status = :status, meta_name = :name, meta_symbol = :symbol, description = :description,
      image = :image, twitter = :twitter, telegram = :telegram, website = :website, whitelist = :whitelist
    WHERE address = :address`,
  setMetaError:
    "UPDATE launches SET meta_status = 'error', meta_attempts = meta_attempts + 1, meta_next_at = ? WHERE address = ?",
  setHolders: "UPDATE launches SET holders = ?, top_holder_pct = ?, holders_at = ? WHERE address = ?",
  // Without ANALYZE statistics SQLite would walk every trade through `trades_launch` to group by launch.
  tradeWindowAggAll: `${TRADE_WINDOW_AGG} INDEXED BY trades_time WHERE timestamp >= :day GROUP BY launch`,
  tradeWindowAggOne: `${TRADE_WINDOW_AGG} WHERE launch = :launch AND timestamp >= :day`,
  tradeTotalsAll: "SELECT launch, last_ts, pump_n, pump_lamports FROM trade_totals",
  tradeTotalsOne: "SELECT launch, last_ts, pump_n, pump_lamports FROM trade_totals WHERE launch = ?",
  vaultEventAggAll: `${VAULT_EVENT_AGG} GROUP BY launch`,
  vaultEventAggOne: `${VAULT_EVENT_AGG} AND launch = ? GROUP BY launch`,
  pumpEventAggAll: `${PUMP_EVENT_AGG} GROUP BY launch`,
  pumpEventAggOne: `${PUMP_EVENT_AGG} AND launch = ? GROUP BY launch`,
  // By time (`trades_launch_time` seek); block times never decrease with the slot, so this is the last trade by slot too.
  priceAt: "SELECT price_sol FROM trades WHERE launch = ? AND timestamp <= ? ORDER BY timestamp DESC, slot DESC, rowid DESC LIMIT 1",
  firstPrice: "SELECT price_sol FROM trades WHERE launch = ? ORDER BY slot ASC, rowid ASC LIMIT 1",
  trades: `
    SELECT * FROM trades INDEXED BY trades_launch
    WHERE launch = :launch AND timestamp < :before AND (:agent = 0 OR is_agent = 1)
      AND (:is_buy IS NULL OR is_buy = :is_buy) AND (:min_sol IS NULL OR sol >= :min_sol)
      AND (:trader IS NULL OR trader = :trader)
    ORDER BY slot DESC, rowid DESC LIMIT :limit`,
  candlePoints: "SELECT timestamp, price_sol, sol FROM trades WHERE launch = ? ORDER BY slot ASC, rowid ASC",
  deposits: "SELECT * FROM deposits WHERE launch = ? AND timestamp < ? ORDER BY slot DESC, rowid DESC LIMIT ?",
  agentTrades: `
    SELECT t.*, l.mint AS mint, l.venue AS venue, ${LAUNCH_SYMBOL} AS symbol
    FROM trades t JOIN launches l ON l.address = t.launch
    WHERE t.is_agent = 1 ORDER BY t.slot DESC, t.rowid DESC LIMIT ?`,
  volumeSince: "SELECT COALESCE(SUM(sol), 0) AS v FROM trades WHERE timestamp >= ?",
  activity: `${ACTIVITY_SELECT} ORDER BY e.slot DESC, e.rowid DESC LIMIT ?`,
  activityOne: `${ACTIVITY_SELECT} WHERE e.signature = ? AND e.event_index = ?`,
  launchActivity: `${ACTIVITY_SELECT}
    WHERE e.launch = :launch AND e.timestamp < :before ORDER BY e.slot DESC, e.rowid DESC LIMIT :limit`,
  launchActivityOfType: `${ACTIVITY_SELECT}
    WHERE e.launch = :launch AND e.type = :type AND e.timestamp < :before ORDER BY e.slot DESC, e.rowid DESC LIMIT :limit`,
  counts: `
    SELECT (SELECT COUNT(*) FROM txs) AS txs, (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM trades) AS trades, (SELECT COUNT(*) FROM deposits) AS deposits,
      (SELECT COUNT(*) FROM launches) AS launches`,
  totalChanges: "SELECT total_changes() AS n",

  // ---------------- social ----------------
  insertComment: `
    INSERT INTO comments (launch, wallet, body, reply_to, created_at, signature, message)
    VALUES (:launch, :wallet, :body, :reply_to, :created_at, :signature, :message)`,
  commentById: `${COMMENT_SELECT} WHERE c.id = ?`,
  comments: `${COMMENT_SELECT}
    WHERE c.launch = :launch AND c.deleted_at IS NULL AND c.id < :before AND (:reply_to IS NULL OR c.reply_to = :reply_to)
    ORDER BY c.id DESC LIMIT :limit`,
  commentTotal: "SELECT COUNT(*) AS n FROM comments WHERE launch = ? AND deleted_at IS NULL",
  softDeleteComment: "UPDATE comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
  recentDuplicate:
    "SELECT 1 AS one FROM comments WHERE wallet = ? AND launch = ? AND body = ? AND created_at >= ? AND deleted_at IS NULL LIMIT 1",
  claimMessage: "INSERT OR IGNORE INTO signed_messages (hash, ts) VALUES (?, ?)",
  pruneMessages: "DELETE FROM signed_messages WHERE ts < ?",
  isBacker: "SELECT 1 AS one FROM deposits WHERE backer = ? AND launch = ? LIMIT 1",
  netTokens: `
    SELECT COALESCE(SUM(CASE WHEN is_buy = 1 THEN CAST(token_amount AS INTEGER) ELSE -CAST(token_amount AS INTEGER) END), 0)
      AS net
    FROM trades WHERE trader = ? AND launch = ?`,
  profile: "SELECT wallet, name, bio, avatar, created_at, updated_at FROM profiles WHERE wallet = ?",
  profileOwnerByName: "SELECT wallet FROM profiles WHERE name_lower = ?",
  upsertProfile: `
    INSERT INTO profiles (wallet, name, name_lower, bio, avatar, created_at, updated_at)
    VALUES (:wallet, :name, :name_lower, :bio, :avatar, :now, :now)
    ON CONFLICT(wallet) DO UPDATE SET
      name = excluded.name, name_lower = excluded.name_lower, bio = excluded.bio, avatar = excluded.avatar,
      updated_at = excluded.updated_at`,
  profilesIn: "SELECT wallet, name, avatar FROM profiles WHERE wallet IN (SELECT value FROM json_each(?))",
  launchImageExists: "SELECT 1 AS one FROM launches WHERE image = ? LIMIT 1",
  // Arweave uploads: SOL spend per UTC day (reserved atomically against the cap) and images for avatar checks.
  uploadSpend: "SELECT lamports FROM upload_spend WHERE day = ?",
  reserveUploadSpend: `
    INSERT INTO upload_spend (day, lamports) SELECT :day, :lamports WHERE :lamports <= :cap
    ON CONFLICT(day) DO UPDATE SET lamports = lamports + excluded.lamports WHERE lamports + excluded.lamports <= :cap`,
  insertUploadedImage: "INSERT OR IGNORE INTO uploaded_images (url, created_at) VALUES (?, ?)",
  uploadedImageExists: "SELECT 1 AS one FROM uploaded_images WHERE url = ?",

  // ---------------- wallets / discovery ----------------
  walletTrades: `SELECT :wallet AS wallet, ${WALLET_TRADE_AGG} FROM trades t WHERE t.trader = :wallet AND t.is_agent = 0`,
  walletDeposits:
    "SELECT launch, SUM(CAST(amount AS INTEGER)) AS amount, MIN(timestamp) AS first_ts FROM deposits WHERE backer = ? GROUP BY launch",
  walletEventTotals: `
    SELECT launch, type, SUM(CAST(sol_amount AS INTEGER)) AS amount FROM events
    WHERE actor = ? AND type IN ('refund', 'backer_claim', 'creator_claim') GROUP BY launch, type`,
  walletLaunches: `${LAUNCH_SELECT} WHERE l.creator = ? AND l.snapshot IS NOT NULL ORDER BY l.idx DESC`,
  walletFirstSeen: `
    SELECT MIN(ts) AS ts FROM (
      SELECT MIN(timestamp) AS ts FROM events WHERE actor = :wallet
      UNION ALL SELECT MIN(created_at) FROM comments WHERE wallet = :wallet
      UNION ALL SELECT MIN(created_at) FROM launches WHERE creator = :wallet)`,
  walletCommentCount: "SELECT COUNT(*) AS n FROM comments WHERE wallet = ? AND deleted_at IS NULL",
  walletActivity: `${ACTIVITY_SELECT}
    WHERE e.rowid IN (
      SELECT rowid FROM events WHERE actor = :wallet AND timestamp < :before
      UNION ALL
      SELECT ev.rowid FROM events ev JOIN launches lc ON lc.address = ev.launch
      WHERE ev.actor IS NULL AND lc.creator = :wallet AND ev.timestamp < :before)
    ORDER BY e.slot DESC, e.rowid DESC LIMIT :limit`,
  launchTraderAgg: `
    SELECT t.trader AS wallet, ${WALLET_TRADE_AGG} FROM trades t
    WHERE t.launch = :launch AND t.is_agent = 0 AND t.timestamp >= :since
    GROUP BY t.trader ORDER BY volume DESC, trades DESC LIMIT :limit`,
  traderBoard: `
    SELECT t.trader AS wallet, ${WALLET_TRADE_AGG} FROM trades t
    WHERE t.is_agent = 0 AND t.timestamp >= :since
    GROUP BY t.trader ORDER BY volume DESC, trades DESC LIMIT :limit`,
  launchWindowAgg: `
    SELECT launch, COALESCE(SUM(CAST(fee AS INTEGER)), 0) AS fees, COALESCE(SUM(sol), 0) AS volume, COUNT(*) AS trades,
      COUNT(DISTINCT CASE WHEN is_agent = 0 THEN trader END) AS traders
    FROM trades INDEXED BY trades_time WHERE timestamp >= ? GROUP BY launch`,
  depositsByBacker: "SELECT backer, launch, SUM(CAST(amount AS INTEGER)) AS amount FROM deposits GROUP BY backer, launch",
  launchBackers: "SELECT backer, SUM(CAST(amount AS INTEGER)) AS amount FROM deposits WHERE launch = ? GROUP BY backer",
  launchBackerEvents: `
    SELECT actor, type, SUM(CAST(sol_amount AS INTEGER)) AS amount FROM events
    WHERE launch = ? AND type IN ('refund', 'backer_claim') GROUP BY actor, type`,
  searchLaunches: `${LAUNCH_SELECT}
    WHERE l.snapshot IS NOT NULL AND (
      lower(${LAUNCH_NAME}) LIKE :contains ESCAPE '\\' OR lower(${LAUNCH_SYMBOL}) LIKE :contains ESCAPE '\\'
      OR substr(l.mint, 1, :raw_len) = :raw OR substr(l.address, 1, :raw_len) = :raw)
    ORDER BY
      CASE
        WHEN lower(${LAUNCH_SYMBOL}) = :q OR lower(${LAUNCH_NAME}) = :q OR l.mint = :raw OR l.address = :raw THEN 0
        WHEN lower(${LAUNCH_SYMBOL}) LIKE :prefix ESCAPE '\\' OR lower(${LAUNCH_NAME}) LIKE :prefix ESCAPE '\\'
          OR substr(l.mint, 1, :raw_len) = :raw OR substr(l.address, 1, :raw_len) = :raw THEN 1
        ELSE 2
      END,
      l.idx DESC
    LIMIT :limit`,
  searchProfiles: `
    SELECT wallet, name, avatar FROM profiles
    WHERE name_lower LIKE :prefix ESCAPE '\\' OR substr(wallet, 1, :raw_len) = :raw
    ORDER BY name_lower = :q DESC, length(name) ASC LIMIT :limit`,
  searchWallets: `
    SELECT DISTINCT e.actor AS wallet, p.name AS name, p.avatar AS avatar
    FROM events e LEFT JOIN profiles p ON p.wallet = e.actor
    WHERE e.actor >= :raw AND e.actor < :raw_end LIMIT :limit`,
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
  /** Bumped by every `wipe`, so derived caches can key on it. */
  generation = 0;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
    const stmts: Partial<Record<keyof typeof SQL, StatementSync>> = {};
    for (const key of Object.keys(SQL) as (keyof typeof SQL)[]) stmts[key] = this.db.prepare(SQL[key]);
    this.stmts = stmts as Record<keyof typeof SQL, StatementSync>;
  }

  /** Brings an existing file to `SCHEMA_VERSION` (one transaction), then applies the idempotent `SCHEMA`. */
  private migrate(): void {
    const version = row<{ user_version: number }>(this.db.prepare("PRAGMA user_version"))?.user_version ?? 0;
    const hasTable = (name: string) =>
      row(this.db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?"), [name]) !== undefined;
    this.tx(() => {
      if (version < 1 && hasTable("launches")) migrateToV1(this.db);
      if (version < 2 && hasTable("trades")) migrateToV2(this.db);
      this.db.exec(SCHEMA);
      if (version < 3) migrateToV3(this.db);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
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

  /** Drops every chain-derived row, comments included (used when the cluster genesis changes, e.g. a reset localnet). */
  wipe(): void {
    this.tx(() => {
      for (const t of DATA_TABLES) this.db.exec(`DELETE FROM ${t}`);
    });
    this.generation += 1;
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

  deleteState(key: string): void {
    this.stmts.deleteState.run(key);
  }

  hasTx(signature: string): boolean {
    return row(this.stmts.hasTx, [signature]) !== undefined;
  }

  txSlot(signature: string): number | null {
    return row<{ slot: number }>(this.stmts.txSlot, [signature])?.slot ?? null;
  }

  markTx(signature: string, slot: number, failed: boolean, eventCount: number): void {
    this.stmts.insertTx.run(signature, slot, failed ? 1 : 0, eventCount);
  }

  counts(): TableCounts {
    return row<TableCounts>(this.stmts.counts)!;
  }

  /**
   * Rows inserted, updated or deleted through this connection since it opened (SQLite `total_changes()`). Every
   * write in the process goes through this store, so the number moves on each one: derived read caches key on it.
   */
  dataVersion(): number {
    return row<{ n: number }>(this.stmts.totalChanges)!.n;
  }

  // ---------------- event writes ----------------

  /** Insert-or-refresh from a `launchCreated` event (keeps any existing snapshot/metadata). */
  upsertCreatedLaunch(l: NewLaunchRow): void {
    this.stmts.upsertCreated.run(l);
  }

  /** The `launched` event: the launch price and, for pump launches, the mint pump.fun just created. */
  setLaunched(address: string, mint: string, price: number, ts: number, bundleSol: number): void {
    this.stmts.setLaunched.run(mint, price, ts, bundleSol, address);
  }

  /** Returns true when the event row was new (idempotency on signature + event index). */
  insertEvent(e: EventDbRow): boolean {
    return this.stmts.insertEvent.run(e).changes > 0;
  }

  /** Idempotent on signature + event index; only a new row moves the launch's `trade_totals`. */
  insertTrade(t: TradeDbRow): void {
    if (this.stmts.insertTrade.run(t).changes === 0) return;
    const pump = t.source === "pump";
    this.stmts.addTradeTotal.run({ launch: t.launch, ts: t.timestamp, pump_n: pump ? 1 : 0, lamports: pump ? t.sol_amount : "0" });
  }

  insertDeposit(d: DepositDbRow): void {
    this.stmts.insertDeposit.run(d);
  }

  // ---------------- launches ----------------

  launch(address: string): LaunchDbRow | undefined {
    return row<LaunchDbRow>(this.stmts.launchByAddress, [address]);
  }

  /** Launch by address or by mint (the default mint of unlaunched pump launches never matches). */
  launchById(idOrMint: string): LaunchDbRow | undefined {
    return row<LaunchDbRow>(this.stmts.launchById, { id: idOrMint });
  }

  /** Launches with an on-chain snapshot, newest first. */
  launches(): SnapshotLaunchDbRow[] {
    return rows<SnapshotLaunchDbRow>(this.stmts.allLaunches);
  }

  /** Every wallet that ever traded the launch on the curve (agents excluded). */
  traders(launch: string): string[] {
    return rows<{ trader: string }>(this.stmts.launchTraders, [launch]).map((r) => r.trader);
  }

  /** Pending metadata plus failed fetches whose backoff elapsed and that have attempts left. */
  launchesWithMetaDue(nowMs: number, maxAttempts: number): LaunchDbRow[] {
    return rows<LaunchDbRow>(this.stmts.metaDue, [maxAttempts, nowMs]);
  }

  /** Insert a launch discovered from its account (no-op if already known). */
  insertLaunch(l: NewLaunchRow): void {
    this.stmts.insertLaunch.run(l);
  }

  /** Stores a snapshot; also syncs mint/venue and, for pump launches, the on-chain name/symbol/uri it carries. */
  setSnapshot(s: SnapshotUpdate): void {
    this.stmts.setSnapshot.run({
      address: s.address,
      snapshot: s.snapshot,
      slot: s.slot,
      status: s.status,
      mint: s.mint,
      venue: s.venue,
      name: s.pumpMeta?.name ?? null,
      symbol: s.pumpMeta?.symbol ?? null,
      uri: s.pumpMeta?.uri ?? null,
    });
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

  setHolders(address: string, count: number, topHolderPct: number | null, atMs: number): void {
    this.stmts.setHolders.run(count, topHolderPct, atMs, address);
  }

  // ---------------- derived reads ----------------

  /** Every launch with trades: all-time totals plus its rolling windows (zero when it didn't trade in the last 24 h). */
  tradeAggregates(nowSecs: number): Map<string, TradeAggDbRow> {
    const windows = new Map<string, TradeWindowAggDbRow>();
    for (const w of rows<TradeWindowAggDbRow>(this.stmts.tradeWindowAggAll, { day: nowSecs - 86_400, hour: nowSecs - 3_600 })) {
      windows.set(w.launch, w);
    }
    const out = new Map<string, TradeAggDbRow>();
    for (const t of rows<TradeTotalsDbRow>(this.stmts.tradeTotalsAll)) out.set(t.launch, { ...NO_TRADES, ...windows.get(t.launch), ...t });
    return out;
  }

  tradeAggregate(launch: string, nowSecs: number): TradeAggDbRow | undefined {
    const totals = row<TradeTotalsDbRow>(this.stmts.tradeTotalsOne, [launch]);
    if (!totals) return undefined;
    // Aggregates without GROUP BY always yield one row (zeros, launch null, when nothing traded in the window).
    const w = row<TradeWindowAggDbRow>(this.stmts.tradeWindowAggOne, { launch, day: nowSecs - 86_400, hour: nowSecs - 3_600 })!;
    return { ...w, ...totals };
  }

  vaultEventAggregates(): Map<string, VaultEventAggDbRow> {
    return new Map(rows<VaultEventAggDbRow>(this.stmts.vaultEventAggAll).map((r) => [r.launch, r]));
  }

  pumpEventAggregates(): Map<string, PumpEventAggDbRow> {
    return new Map(rows<PumpEventAggDbRow>(this.stmts.pumpEventAggAll).map((r) => [r.launch, r]));
  }

  pumpEventAggregate(launch: string): PumpEventAggDbRow | undefined {
    return row<PumpEventAggDbRow>(this.stmts.pumpEventAggOne, [launch]);
  }

  vaultEventAggregate(launch: string): VaultEventAggDbRow | undefined {
    return row<VaultEventAggDbRow>(this.stmts.vaultEventAggOne, [launch]);
  }

  /** Price of the last trade at or before `ts`. */
  priceAt(launch: string, ts: number): number | null {
    return row<{ price_sol: number }>(this.stmts.priceAt, [launch, ts])?.price_sol ?? null;
  }

  firstTradePrice(launch: string): number | null {
    return row<{ price_sol: number }>(this.stmts.firstPrice, [launch])?.price_sol ?? null;
  }

  trades(launch: string, f: TradeFilter): TradeDbRow[] {
    return rows<TradeDbRow>(this.stmts.trades, {
      launch,
      before: f.beforeTs,
      limit: f.limit,
      agent: f.agentOnly ? 1 : 0,
      is_buy: f.side === null ? null : f.side === "buy" ? 1 : 0,
      min_sol: f.minSol,
      trader: f.trader,
    });
  }

  candlePoints(launch: string): CandlePointDbRow[] {
    return rows<CandlePointDbRow>(this.stmts.candlePoints, [launch]);
  }

  deposits(launch: string, beforeTs: number, limit: number): DepositDbRow[] {
    return rows<DepositDbRow>(this.stmts.deposits, [launch, beforeTs, limit]);
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

  /** One launch's activity, newest first; `type` narrows to one event type (its own statement, so each gets its index). */
  launchActivity(launch: string, type: ActivityType | null, beforeTs: number, limit: number): ActivityDbRow[] {
    return type === null
      ? rows<ActivityDbRow>(this.stmts.launchActivity, { launch, before: beforeTs, limit })
      : rows<ActivityDbRow>(this.stmts.launchActivityOfType, { launch, type, before: beforeTs, limit });
  }

  // ---------------- comments ----------------

  /**
   * Records a signed message hash; false when it was already used (replay). Hashes older than
   * `pruneBeforeSecs` are dropped first — their timestamps are outside the accepted window anyway.
   */
  claimSignedMessage(hash: string, ts: number, pruneBeforeSecs: number): boolean {
    this.stmts.pruneMessages.run(pruneBeforeSecs);
    return this.stmts.claimMessage.run(hash, ts).changes > 0;
  }

  insertComment(c: NewCommentRow): number {
    return Number(this.stmts.insertComment.run(c).lastInsertRowid);
  }

  comment(id: number): CommentDbRow | undefined {
    return row<CommentDbRow>(this.stmts.commentById, [id]);
  }

  /** Visible comments of a launch, newest first; `replyTo` narrows to the replies of one comment. */
  comments(launch: string, beforeId: number, limit: number, replyTo: number | null): CommentDbRow[] {
    return rows<CommentDbRow>(this.stmts.comments, { launch, before: beforeId, limit, reply_to: replyTo });
  }

  commentTotal(launch: string): number {
    return row<{ n: number }>(this.stmts.commentTotal, [launch])?.n ?? 0;
  }

  /** Soft delete; false when the comment was already deleted (or never existed). */
  softDeleteComment(id: number, nowSecs: number): boolean {
    return this.stmts.softDeleteComment.run(nowSecs, id).changes > 0;
  }

  hasRecentDuplicate(wallet: string, launch: string, body: string, sinceSecs: number): boolean {
    return row(this.stmts.recentDuplicate, [wallet, launch, body, sinceSecs]) !== undefined;
  }

  isBacker(wallet: string, launch: string): boolean {
    return row(this.stmts.isBacker, [wallet, launch]) !== undefined;
  }

  /** Tokens bought minus tokens sold on the curve (base units). */
  netTokens(wallet: string, launch: string): number {
    return row<{ net: number }>(this.stmts.netTokens, [wallet, launch])?.net ?? 0;
  }

  // ---------------- profiles ----------------

  profile(wallet: string): ProfileDbRow | undefined {
    return row<ProfileDbRow>(this.stmts.profile, [wallet]);
  }

  /** Wallet owning a (case-insensitive) display name. */
  profileOwnerByName(nameLower: string): string | null {
    return row<{ wallet: string }>(this.stmts.profileOwnerByName, [nameLower])?.wallet ?? null;
  }

  upsertProfile(p: { wallet: string; name: string | null; bio: string | null; avatar: string | null; now: number }): void {
    this.stmts.upsertProfile.run({ ...p, name_lower: p.name?.toLowerCase() ?? null });
  }

  profilesOf(wallets: string[]): Map<string, ProfileRef> {
    const out = new Map<string, ProfileRef>();
    if (wallets.length === 0) return out;
    for (const p of rows<ProfileRef>(this.stmts.profilesIn, [JSON.stringify([...new Set(wallets)])])) out.set(p.wallet, p);
    return out;
  }

  isLaunchImage(url: string): boolean {
    return row(this.stmts.launchImageExists, [url]) !== undefined;
  }

  isUploadedImage(url: string): boolean {
    return row(this.stmts.uploadedImageExists, [url]) !== undefined;
  }

  addUploadedImage(url: string, nowSecs: number): void {
    this.stmts.insertUploadedImage.run(url, nowSecs);
  }

  // ---------------- arweave upload budget ----------------

  /** Lamports already reserved for Arweave funding on `day` (`YYYY-MM-DD`, UTC). */
  uploadSpend(day: string): number {
    return row<{ lamports: number }>(this.stmts.uploadSpend, [day])?.lamports ?? 0;
  }

  /** Atomically adds `lamports` to `day`'s spend unless the total would exceed `cap`; false when refused. */
  reserveUploadSpend(day: string, lamports: number, cap: number): boolean {
    return this.stmts.reserveUploadSpend.run({ day, lamports, cap }).changes > 0;
  }

  // ---------------- wallets ----------------

  walletTrades(wallet: string): WalletTradeAggDbRow {
    return row<WalletTradeAggDbRow>(this.stmts.walletTrades, { wallet })!;
  }

  /** Lamports deposited per launch. */
  walletDeposits(wallet: string): { launch: string; amount: number; first_ts: number }[] {
    return rows(this.stmts.walletDeposits, [wallet]);
  }

  /** Lamports refunded / claimed per launch and event type. */
  walletEventTotals(wallet: string): { launch: string; type: "refund" | "backer_claim" | "creator_claim"; amount: number }[] {
    return rows(this.stmts.walletEventTotals, [wallet]);
  }

  walletLaunches(wallet: string): SnapshotLaunchDbRow[] {
    return rows<SnapshotLaunchDbRow>(this.stmts.walletLaunches, [wallet]);
  }

  walletFirstSeen(wallet: string): number | null {
    return row<{ ts: number | null }>(this.stmts.walletFirstSeen, { wallet })?.ts ?? null;
  }

  walletCommentCount(wallet: string): number {
    return row<{ n: number }>(this.stmts.walletCommentCount, [wallet])?.n ?? 0;
  }

  /** Events the wallet acted in, plus actor-less events (launch, cancel) of launches it created. */
  walletActivity(wallet: string, beforeTs: number, limit: number): ActivityDbRow[] {
    return rows<ActivityDbRow>(this.stmts.walletActivity, { wallet, before: beforeTs, limit });
  }

  // ---------------- discovery ----------------

  /** Non-agent traders of one launch since `sinceSecs`, by volume. */
  launchTraderStats(launch: string, sinceSecs: number, limit: number): WalletTradeAggDbRow[] {
    return rows<WalletTradeAggDbRow>(this.stmts.launchTraderAgg, { launch, since: sinceSecs, limit });
  }

  /** Non-agent traders across all launches since `sinceSecs`, by volume. */
  traderBoard(sinceSecs: number, limit: number): WalletTradeAggDbRow[] {
    return rows<WalletTradeAggDbRow>(this.stmts.traderBoard, { since: sinceSecs, limit });
  }

  /** Per-launch fees (lamports), volume (SOL), trades and distinct traders since `sinceSecs`. */
  launchWindowAggregates(sinceSecs: number): Map<string, LaunchWindowAggDbRow> {
    return new Map(rows<LaunchWindowAggDbRow>(this.stmts.launchWindowAgg, [sinceSecs]).map((r) => [r.launch, r]));
  }

  /** Lamports deposited per (backer, launch). */
  depositsByBacker(): { backer: string; launch: string; amount: number }[] {
    return rows(this.stmts.depositsByBacker);
  }

  /** Lamports deposited per backer of one launch. */
  launchBackers(launch: string): { backer: string; amount: number }[] {
    return rows(this.stmts.launchBackers, [launch]);
  }

  /** Lamports refunded / claimed per backer of one launch. */
  launchBackerEvents(launch: string): { actor: string; type: "refund" | "backer_claim"; amount: number }[] {
    return rows(this.stmts.launchBackerEvents, [launch]);
  }

  /** Launches by name/symbol substring or mint/address prefix (`keyPrefix` null skips the key match). */
  searchLaunches(text: string, keyPrefix: string | null, limit: number): SnapshotLaunchDbRow[] {
    const like = escapeLike(text);
    return rows<SnapshotLaunchDbRow>(this.stmts.searchLaunches, {
      q: text,
      contains: `%${like}%`,
      prefix: `${like}%`,
      raw: keyPrefix,
      raw_len: keyPrefix?.length ?? null,
      limit,
    });
  }

  /** Profiles by name prefix or wallet prefix (`walletPrefix` null skips the wallet match). */
  searchProfiles(text: string, walletPrefix: string | null, limit: number): ProfileRef[] {
    return rows<ProfileRef>(this.stmts.searchProfiles, {
      q: text,
      prefix: `${escapeLike(text)}%`,
      raw: walletPrefix,
      raw_len: walletPrefix?.length ?? null,
      limit,
    });
  }

  /** Wallets seen on chain (any indexed event) whose address starts with `prefix` (case-sensitive). */
  searchWallets(prefix: string, limit: number): ProfileRef[] {
    return rows<ProfileRef>(this.stmts.searchWallets, { raw: prefix, raw_end: `${prefix}\u007f`, limit });
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
