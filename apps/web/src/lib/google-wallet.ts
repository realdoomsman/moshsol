"use client";

import {
  BaseSignerWalletAdapter,
  WalletConnectionError,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSignTransactionError,
  isVersionedTransaction,
  type TransactionOrVersionedTransaction,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export const GOOGLE_WALLET_NAME = "Google" as WalletName<"Google">;

/**
 * sessionStorage flag set before the Google round trip a key export needs; the wallet menu reopens
 * the export dialog when the page comes back signed in.
 */
export const EXPORT_AFTER_REAUTH_KEY = "holdfast:export-after-reauth";

const GOOGLE_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>',
)}`;

/** A failed call to the accounts API; `message` is the service's error (e.g. `reauth_required`). */
export class AccountsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Same-origin call to the accounts API (proxied by `app/api/{auth,wallet}`, cookies first-party).
 * Passing `init` makes it a POST with the CSRF header the service requires.
 */
async function accounts<T>(path: string, init?: { json?: unknown }): Promise<T> {
  const post = init !== undefined;
  const res = await fetch(path, {
    method: post ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: post ? { "x-holdfast": "1", ...(init.json !== undefined ? { "content-type": "application/json" } : {}) } : undefined,
    body: post && init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `${res.status} ${res.statusText}`;
    throw new AccountsError(res.status, error);
  }
  return body as T;
}

/**
 * Leaves for Google sign-in and comes back to the current page. `reauth` makes Google ask which
 * account to use even when one is signed in (required before a key export).
 */
export function startGoogleSignIn(reauth = false): void {
  const back = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/auth/google?return=${encodeURIComponent(back)}${reauth ? "&reauth=1" : ""}`);
}

/** The signed-in wallet's secret key (base58). Throws `AccountsError` "reauth_required" unless Google sign-in was < 10 min ago. */
export async function exportSecretKey(): Promise<string> {
  return (await accounts<{ secretKey: string }>("/api/wallet/export", {})).secretKey;
}

/**
 * "Continue with Google": a custodial wallet held by the accounts service. Connecting resumes the
 * session (or leaves for Google sign-in); `signTransaction`/`signAllTransactions` send the
 * transactions to `/api/wallet/sign`, which signs them if they pass its policy, so `useTx`
 * (prepare → sign → sendAndConfirm) works unchanged. Disconnecting signs out.
 */
export class GoogleWalletAdapter extends BaseSignerWalletAdapter<"Google"> {
  readonly name = GOOGLE_WALLET_NAME;
  readonly url = "https://myaccount.google.com";
  readonly icon = GOOGLE_ICON;
  readonly readyState = WalletReadyState.Loadable;
  readonly supportedTransactionVersions = new Set(["legacy", 0] as const);
  /** Google account of the connected session. */
  email: string | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  /** Page load with Google remembered: resume a live session, never redirect. */
  override async autoConnect(): Promise<void> {
    // Not emitted as an error: WalletProvider just forgets the selection.
    if (!(await this.resume())) throw new WalletConnectionError("no Google session");
  }

  /** Picked in the wallet modal: resume the session, or go sign in with Google (the page navigates away). */
  async connect(): Promise<void> {
    if (!(await this.resume())) startGoogleSignIn();
  }

  async disconnect(): Promise<void> {
    if (!this._publicKey) return;
    try {
      await accounts("/api/auth/logout", {});
    } catch (err) {
      this.emit("error", new WalletConnectionError(`Sign-out failed: ${err instanceof Error ? err.message : String(err)}`, err));
    }
    this.ended();
  }

  override async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(transaction: T): Promise<T> {
    const [signed] = await this.signAllTransactions([transaction]);
    return signed;
  }

  override async signAllTransactions<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(
    transactions: T[],
  ): Promise<T[]> {
    if (!this._publicKey) throw new WalletNotConnectedError();
    const encoded = transactions.map((tx) =>
      Buffer.from(isVersionedTransaction(tx) ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"),
    );
    let signed: string[];
    try {
      ({ transactions: signed } = await accounts<{ transactions: string[] }>("/api/wallet/sign", { json: { transactions: encoded } }));
    } catch (err) {
      if (err instanceof AccountsError && err.status === 401) {
        this.ended();
        throw new WalletSignTransactionError("Your Google session ended. Sign in again.", err);
      }
      throw new WalletSignTransactionError(err instanceof Error ? err.message : String(err), err);
    }
    return transactions.map((tx, i) => {
      const raw = Buffer.from(signed[i], "base64");
      // Same kind as the input, which is what T is (TS can't tie the branch to the type parameter).
      const out: Transaction | VersionedTransaction = isVersionedTransaction(tx) ? VersionedTransaction.deserialize(raw) : Transaction.from(raw);
      return out as T;
    });
  }

  /** Connects when the browser has a session; false when it has none. */
  private async resume(): Promise<boolean> {
    if (this._publicKey) return true;
    this._connecting = true;
    try {
      const me = await accounts<{ email: string; address: string }>("/api/auth/me");
      this._publicKey = new PublicKey(me.address);
      this.email = me.email;
      this.emit("connect", this._publicKey);
      return true;
    } catch (err) {
      if (err instanceof AccountsError && err.status === 401) return false;
      const error = new WalletConnectionError(err instanceof Error ? err.message : String(err), err);
      this.emit("error", error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  private ended(): void {
    this._publicKey = null;
    this.email = null;
    this.emit("disconnect");
  }
}
