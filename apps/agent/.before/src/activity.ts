import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { log } from "./log";
import type { Narrator } from "./narrate";

export type ActivityKind = "sell" | "buy" | "buyback" | "hold" | "payout" | "collect_fees" | "wind_down";

/** One decision or crank for a launch, as served by `GET /launches/:key/activity`. */
export interface ActivityItem {
  /** Unix seconds (wall clock). */
  ts: number;
  kind: ActivityKind;
  reason: string;
  /** Flat, JSON-safe facts behind the decision (lamports and token amounts as decimal strings). */
  detail: Record<string, number | string | boolean>;
  sig?: string;
  /** Plain-English rendering by the narrator, filled in asynchronously after the item was recorded. */
  narrative?: string;
}

export interface ActivityLaunch {
  address: string;
  mint: string;
  symbol?: string;
  venue: string;
}

const NARRATE_SYSTEM =
  "You narrate decisions of an on-chain vault agent for a memecoin launch. The decisions were already made by fixed rules; never suggest trades or predict price. Two plain-English sentences max, no hype.";
/** Holds are narrated at most once per launch per this window; a hold of the same kind (drifting numbers) is re-recorded at most this often. */
const HOLD_NARRATION_GAP_MS = 10 * 60_000;
const HOLD_REPEAT_SECS = 600;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  address TEXT NOT NULL,
  mint TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  sig TEXT,
  narrative TEXT
);
CREATE INDEX IF NOT EXISTS activity_address_id ON activity (address, id);
`;

const SQL = {
  insert: "INSERT INTO activity (address, mint, ts, kind, reason, detail, sig, narrative) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
  narrate: "UPDATE activity SET narrative = ? WHERE id = ?",
  /** Everything at or below the (max+1)-th newest row of the launch. */
  prune: "DELETE FROM activity WHERE address = ? AND id <= (SELECT id FROM activity WHERE address = ? ORDER BY id DESC LIMIT 1 OFFSET ?)",
  load: "SELECT id, address, mint, ts, kind, reason, detail, sig, narrative FROM activity ORDER BY address, id DESC",
};

type Row = {
  id: number;
  address: string;
  mint: string;
  ts: number;
  kind: ActivityKind;
  reason: string;
  detail: string;
  sig: string | null;
  narrative: string | null;
};

/**
 * Per-launch ring of the agent's recent decisions, persisted in SQLite and narrated in the background.
 * Keyed by launch address; the mint of the last recorded item also resolves to the same ring.
 */
export class ActivityLog {
  private readonly db: DatabaseSync;
  private readonly stmts: Record<keyof typeof SQL, StatementSync>;
  private readonly narrator: Narrator | null;
  private readonly max: number;
  /** Newest first. */
  private readonly rings = new Map<string, ActivityItem[]>();
  private readonly mintToAddress = new Map<string, string>();
  private readonly ids = new WeakMap<ActivityItem, number>();
  private readonly holdNarratedAt = new Map<string, number>();

  constructor(opts: { file: string; narrator: Narrator | null; max?: number }) {
    this.narrator = opts.narrator;
    this.max = opts.max ?? 200;
    if (opts.file !== ":memory:") fs.mkdirSync(path.dirname(opts.file), { recursive: true });
    this.db = new DatabaseSync(opts.file);
    if (opts.file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const stmts: Partial<Record<keyof typeof SQL, StatementSync>> = {};
    for (const key of Object.keys(SQL) as (keyof typeof SQL)[]) stmts[key] = this.db.prepare(SQL[key]);
    this.stmts = stmts as Record<keyof typeof SQL, StatementSync>;
    this.load();
  }

  private load(): void {
    for (const row of this.stmts.load.all() as Row[]) {
      let ring = this.rings.get(row.address);
      if (!ring) {
        ring = [];
        this.rings.set(row.address, ring);
        // Rows come newest first per address: the first one carries the launch's current mint.
        this.mintToAddress.set(row.mint, row.address);
      }
      if (ring.length >= this.max) continue;
      const item: ActivityItem = { ts: row.ts, kind: row.kind, reason: row.reason, detail: JSON.parse(row.detail) };
      if (row.sig !== null) item.sig = row.sig;
      if (row.narrative !== null) item.narrative = row.narrative;
      this.ids.set(item, row.id);
      ring.push(item);
    }
  }

  /**
   * Appends the item (synchronously persisted) and kicks off its narration. Not re-recorded (the existing item is
   * returned so a long quiet stretch does not flood the ring or the narrator): a `hold` repeating the newest
   * item's (kind, reason); a `hold` of the same `detail.holdKind` as the newest hold within HOLD_REPEAT_SECS (the
   * same reason with drifting numbers, e.g. "dip −14.0%" → "dip −14.1%"); and a dry-run plan (`detail.dryRun`)
   * repeating the newest dry-run plan's kind and amount (nothing changes on chain, so the same plan comes back
   * every poll).
   */
  record(launch: ActivityLaunch, item: Omit<ActivityItem, "narrative">, context?: Record<string, unknown>): ActivityItem {
    for (const [k, v] of Object.entries(item.detail)) {
      if (typeof v === "bigint") throw new Error(`activity detail.${k} is a bigint; convert it to a string before recording`);
    }
    this.mintToAddress.set(launch.mint, launch.address);
    let ring = this.rings.get(launch.address);
    if (!ring) {
      ring = [];
      this.rings.set(launch.address, ring);
    }
    const newest = ring[0];
    if (item.kind === "hold" && newest?.kind === "hold") {
      if (newest.reason === item.reason) return newest;
      const holdKind = item.detail.holdKind;
      if (holdKind !== undefined && holdKind === newest.detail.holdKind && item.ts - newest.ts < HOLD_REPEAT_SECS) return newest;
    }
    if (item.detail.dryRun === true && newest?.detail.dryRun === true && newest.kind === item.kind) {
      const amountOf = (d: ActivityItem["detail"]) => d.amountSol ?? d.amountTokens;
      if (amountOf(newest.detail) === amountOf(item.detail)) return newest;
    }

    const stored: ActivityItem = { ts: item.ts, kind: item.kind, reason: item.reason, detail: { ...item.detail } };
    if (item.sig !== undefined) stored.sig = item.sig;
    const { lastInsertRowid } = this.stmts.insert.run(
      launch.address,
      launch.mint,
      stored.ts,
      stored.kind,
      stored.reason,
      JSON.stringify(stored.detail),
      stored.sig ?? null,
    );
    this.ids.set(stored, Number(lastInsertRowid));
    ring.unshift(stored);
    if (ring.length > this.max) {
      ring.length = this.max;
      this.stmts.prune.run(launch.address, launch.address, this.max);
    }
    if (this.narrator && this.shouldNarrate(launch.address, stored)) this.narrate(this.narrator, launch, stored, context);
    return stored;
  }

  private shouldNarrate(address: string, item: ActivityItem): boolean {
    if (item.kind !== "hold") return true;
    const now = Date.now();
    const last = this.holdNarratedAt.get(address);
    if (last !== undefined && now - last < HOLD_NARRATION_GAP_MS) return false;
    this.holdNarratedAt.set(address, now);
    return true;
  }

  private narrate(narrator: Narrator, launch: ActivityLaunch, item: ActivityItem, context: Record<string, unknown> | undefined): void {
    const user = JSON.stringify({ launch: { symbol: launch.symbol, venue: launch.venue }, item, context }, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    narrator
      .narrate(NARRATE_SYSTEM, user, { maxSentences: 2 })
      .then((text) => {
        if (!text) return;
        item.narrative = text;
        const id = this.ids.get(item);
        if (id !== undefined && this.db.isOpen) this.stmts.narrate.run(text, id);
      })
      .catch((e: unknown) => log("narration_failed", { error: e instanceof Error ? e.message : String(e) }));
  }

  /** Newest first, for a launch address or its mint; null when the launch is unknown. */
  items(key: string): ActivityItem[] | null {
    const ring = this.rings.get(key) ?? this.rings.get(this.mintToAddress.get(key) ?? "");
    return ring ? ring.slice() : null;
  }

  /** Drops every launch not in `keep` from memory (its SQLite rows stay and reload on the next start). */
  forget(keep: Set<string>): void {
    for (const address of this.rings.keys()) {
      if (keep.has(address)) continue;
      this.rings.delete(address);
      this.holdNarratedAt.delete(address);
    }
    for (const [mint, address] of this.mintToAddress) if (!this.rings.has(address)) this.mintToAddress.delete(mint);
  }

  close(): void {
    this.db.close();
  }
}
