import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/** OAuth round trips (start → Google → callback) must finish within this many seconds. */
export const FLOW_TTL_SECS = 600;

export type AuditAction = "signup" | "login" | "logout" | "sign" | "sign_rejected" | "export";

export interface UserRow {
  id: number;
  google_sub: string;
  email: string;
  /** Wallet address (base58). */
  address: string;
  /** Sealed 64-byte secret key (see `WalletCipher`). */
  secret: Uint8Array;
  key_id: string;
}

export interface SessionUser extends UserRow {
  /** Unix seconds of the Google sign-in behind this session; null once spent on a key export. */
  auth_at: number | null;
}

export interface FlowRow {
  verifier: string;
  nonce: string;
  return_to: string;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  secret BLOB NOT NULL,
  key_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  auth_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_user ON audit_log(user_id, at);
`;

const USER_COLUMNS = "u.id, u.google_sub, u.email, u.address, u.secret, u.key_id";

const SQL = {
  userBySub: `SELECT ${USER_COLUMNS} FROM users u WHERE u.google_sub = ?`,
  insertUser: `INSERT INTO users (google_sub, email, address, secret, key_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  touchUser: `UPDATE users SET email = ?, last_login_at = ? WHERE id = ?`,
  foreignKeyCount: `SELECT COUNT(*) AS n FROM users WHERE key_id != ?`,
  insertSession: `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, auth_at) VALUES (?, ?, ?, ?, ?)`,
  sessionUser: `
    SELECT ${USER_COLUMNS}, s.auth_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ? AND s.expires_at > ?`,
  deleteSession: `DELETE FROM sessions WHERE id_hash = ?`,
  spendAuth: `UPDATE sessions SET auth_at = NULL WHERE id_hash = ?`,
  insertFlow: `INSERT INTO oauth_flows (state_hash, verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)`,
  takeFlow: `DELETE FROM oauth_flows WHERE state_hash = ? RETURNING verifier, nonce, return_to, created_at`,
  insertAudit: `INSERT INTO audit_log (user_id, action, detail, ip, at) VALUES (?, ?, ?, ?, ?)`,
  pruneSessions: `DELETE FROM sessions WHERE expires_at <= ?`,
  pruneFlows: `DELETE FROM oauth_flows WHERE created_at <= ?`,
} as const;

function row<T>(stmt: StatementSync, params: SQLInputValue[]): T | undefined {
  return stmt.get(...params) as unknown as T | undefined;
}

/**
 * Users (Google `sub` → custodial wallet, secret sealed), server-side sessions, in-flight OAuth
 * round trips and an audit log. node:sqlite, WAL; `:memory:` for tests.
 */
export class Store {
  private readonly db: DatabaseSync;
  private readonly stmts: Record<keyof typeof SQL, StatementSync>;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
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

  close(): void {
    this.db.close();
  }

  userBySub(sub: string): UserRow | undefined {
    return row<UserRow>(this.stmts.userBySub, [sub]);
  }

  insertUser(u: { sub: string; email: string; address: string; secret: Uint8Array; keyId: string }, now: number): number {
    return Number(this.stmts.insertUser.run(u.sub, u.email, u.address, u.secret, u.keyId, now, now).lastInsertRowid);
  }

  touchUser(id: number, email: string, now: number): void {
    this.stmts.touchUser.run(email, now, id);
  }

  /** Users whose wallet was sealed under a different master key than `keyId`. */
  foreignKeyCount(keyId: string): number {
    return row<{ n: number }>(this.stmts.foreignKeyCount, [keyId])?.n ?? 0;
  }

  createSession(idHash: string, userId: number, now: number, expiresAt: number): void {
    this.stmts.insertSession.run(idHash, userId, now, expiresAt, now);
  }

  sessionUser(idHash: string, now: number): SessionUser | undefined {
    return row<SessionUser>(this.stmts.sessionUser, [idHash, now]);
  }

  deleteSession(idHash: string): void {
    this.stmts.deleteSession.run(idHash);
  }

  /** Marks the session's Google sign-in as used by a key export; the next export needs a fresh one. */
  spendAuth(idHash: string): void {
    this.stmts.spendAuth.run(idHash);
  }

  insertFlow(stateHash: string, f: Omit<FlowRow, "created_at">, now: number): void {
    this.stmts.insertFlow.run(stateHash, f.verifier, f.nonce, f.return_to, now);
  }

  /** Removes and returns an OAuth round trip: every state is accepted once. */
  takeFlow(stateHash: string): FlowRow | undefined {
    return row<FlowRow>(this.stmts.takeFlow, [stateHash]);
  }

  audit(userId: number | null, action: AuditAction, detail: string | null, ip: string | null, now: number): void {
    this.stmts.insertAudit.run(userId, action, detail, ip, now);
  }

  prune(now: number): void {
    this.stmts.pruneSessions.run(now);
    this.stmts.pruneFlows.run(now - FLOW_TTL_SECS);
  }
}
