import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { AGENT_EXECUTOR_SLOTS, WSOL_MINT, ammUserVolumeAccumulatorPda, pumpUserVolumeAccumulatorPda, splAta } from "@holdfast/sdk";

/** Where the agent wallets' secret keys come from: `AGENT_EXECUTORS_JSON` (hosted) or a directory of keypair files. */
export type ExecutorSource = { kind: "env"; json: string } | { kind: "dir"; path: string };

/** The agent wallets' keypairs; a missing directory is no wallets (the platform may have none registered either). */
export function loadExecutors(source: ExecutorSource): Keypair[] {
  let secrets: unknown[];
  if (source.kind === "env") {
    const parsed: unknown = JSON.parse(source.json);
    if (!Array.isArray(parsed)) throw new Error("AGENT_EXECUTORS_JSON must be a JSON array of secret-key arrays");
    secrets = parsed;
  } else {
    if (!fs.existsSync(source.path)) return [];
    secrets = fs
      .readdirSync(source.path)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(source.path, f), "utf8")) as unknown);
  }
  if (secrets.length > AGENT_EXECUTOR_SLOTS) throw new Error(`at most ${AGENT_EXECUTOR_SLOTS} agent wallets, got ${secrets.length}`);
  return secrets.map((bytes, i) => {
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
      throw new Error(`agent wallet #${i + 1} must be a JSON array of 64 bytes`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  });
}

type Side = "buy" | "sell";

/**
 * What `ExecutorPool.pick` hands out: a wallet for the trade, or why none may trade it now (`retryAt`: wall-clock ms
 * when the reason runs out by itself — the spacing between a buy and a sell).
 */
export type WalletPick = { wallet: Keypair } | { reason: string; retryAt?: number };

interface Wallet {
  keypair: Keypair;
  /** Lamports as of the last heartbeat read, less what trades since then cost; null until first read. */
  lamports: number | null;
  /** Wall-clock ms of the last trade handed to it (0 = never): least recently used goes first. */
  lastUsedAt: number;
  /** Launch it is trading right now. */
  inFlight: string | null;
}

/**
 * The shared agent wallets (`platform.agentExecutors`) that execute the vault agent's pump trades. Only wallets both
 * registered on chain and loaded here are used. `pick` hands out the least recently used wallet that has at least
 * `minLamports` for fees and rent and is not trading; per launch it refuses a second trade while one is in flight and
 * a trade of the other side within `spacingMs` of the last one, so the wallets never meet on one launch. Wallets
 * under `minLamports` are what `lowWallets` returns for the agent's top-up. Strategy decisions never see the pool:
 * it only chooses who signs.
 */
export class ExecutorPool {
  private readonly wallets = new Map<string, Wallet>();
  /** Registered on chain, in slot order (loaded or not). */
  private registered: PublicKey[] = [];
  /** Per launch: the trade in flight, and the side and time of the last one handed out. */
  private readonly launches = new Map<string, { inFlight: boolean; side: Side | null; at: number }>();
  /** Derived accounts per mint and wallet (`retarget`), so the hot path skips the PDA searches; pruned to live mints. */
  private readonly derived = new Map<string, Map<string, PublicKey[]>>();

  constructor(
    keypairs: Keypair[],
    private readonly opts: { minLamports: number; spacingMs: number },
  ) {
    for (const keypair of keypairs) this.wallets.set(keypair.publicKey.toBase58(), { keypair, lamports: null, lastUsedAt: 0, inFlight: null });
  }

  /** Whether the platform requires trades to go through a wallet (any is registered). */
  get required(): boolean {
    return this.registered.length > 0;
  }

  /** Keys of the registered wallets this agent holds (`active`) and of those it lacks (`missing`). */
  coverage(): { active: PublicKey[]; missing: PublicKey[] } {
    const active = this.registered.filter((k) => this.wallets.has(k.toBase58()));
    return { active, missing: this.registered.filter((k) => !this.wallets.has(k.toBase58())) };
  }

  setRegistered(keys: PublicKey[]): void {
    this.registered = keys;
  }

  /** Heartbeat balances (lamports by base58 key); a wallet in flight keeps its own estimate until it is released. */
  noteBalances(balances: Map<string, number>): void {
    for (const [key, lamports] of balances) {
      const w = this.wallets.get(key);
      if (w && !w.inFlight) w.lamports = lamports;
    }
  }

  /** A wallet for a `side` trade on `launch`, or why none may trade it now. */
  pick(launch: string, side: Side, now: number): WalletPick {
    const l = this.launches.get(launch);
    if (l?.inFlight) return { reason: "an agent wallet is already trading this launch" };
    if (l?.side && l.side !== side && now - l.at < this.opts.spacingMs) {
      return { reason: `last ${l.side} on this launch was ${Math.round((now - l.at) / 1000)}s ago (spacing ${Math.round(this.opts.spacingMs / 1000)}s)`, retryAt: l.at + this.opts.spacingMs };
    }
    let best: Wallet | null = null;
    for (const key of this.registered) {
      const w = this.wallets.get(key.toBase58());
      if (!w || w.inFlight || w.lamports === null || w.lamports < this.opts.minLamports) continue;
      if (!best || w.lastUsedAt < best.lastUsedAt) best = w;
    }
    if (!best) {
      const { active } = this.coverage();
      return { reason: active.length === 0 ? "no registered agent wallet is loaded (AGENT_EXECUTORS_JSON / agent-wallets)" : "every agent wallet is busy or low on SOL" };
    }
    best.inFlight = launch;
    best.lastUsedAt = now;
    this.launches.set(launch, { inFlight: true, side, at: now });
    return { wallet: best.keypair };
  }

  /** The trade `pick` handed out is over; `costLamports` = what it took from the wallet (fee and tip; 0 if not sent). */
  release(wallet: PublicKey, launch: string, costLamports: number): void {
    const w = this.wallets.get(wallet.toBase58());
    if (w) {
      w.inFlight = null;
      if (w.lamports !== null) w.lamports -= costLamports;
    }
    const l = this.launches.get(launch);
    if (l) l.inFlight = false;
  }

  /** Registered, loaded, not trading and under `minLamports`: what the agent tops up. */
  lowWallets(): { key: PublicKey; lamports: number }[] {
    const low: { key: PublicKey; lamports: number }[] = [];
    for (const key of this.registered) {
      const w = this.wallets.get(key.toBase58());
      if (w && !w.inFlight && w.lamports !== null && w.lamports < this.opts.minLamports) low.push({ key, lamports: w.lamports });
    }
    return low;
  }

  /** Drops launches that are no longer live (`live`: launch addresses) and the derived accounts of mints no longer live. */
  retain(live: Set<string>, liveMints: Set<string>): void {
    for (const key of [...this.launches.keys()]) if (!live.has(key) && !this.launches.get(key)!.inFlight) this.launches.delete(key);
    for (const mint of [...this.derived.keys()]) if (!liveMints.has(mint)) this.derived.delete(mint);
  }

  /** Status view: every registered wallet, whether this agent holds it, its balance and last use. */
  snapshot(): { key: string; loaded: boolean; sol: number | null; lastUsedAt: number | null; trading: string | null }[] {
    return this.registered.map((k) => {
      const w = this.wallets.get(k.toBase58());
      return {
        key: k.toBase58(),
        loaded: w !== undefined,
        sol: w?.lamports == null ? null : w.lamports / 1e9,
        lastUsedAt: w?.lastUsedAt || null,
        trading: w?.inFlight ?? null,
      };
    });
  }

  /**
   * `ix` built for wallet `from` (an `agent_*_pump` template) as wallet `to` would send it: the wallet, its token
   * account for `mint`, its WSOL account and its pump.fun / PumpSwap volume accumulators are swapped; every other key
   * (and every flag) is kept.
   */
  retarget(ix: TransactionInstruction, from: PublicKey, to: PublicKey, mint: PublicKey): TransactionInstruction {
    if (from.equals(to)) return ix;
    const a = this.accountsOf(from, mint);
    const b = this.accountsOf(to, mint);
    const swap = new Map(a.map((k, i) => [k.toBase58(), b[i]!]));
    return new TransactionInstruction({
      programId: ix.programId,
      keys: ix.keys.map((k) => ({ ...k, pubkey: swap.get(k.pubkey.toBase58()) ?? k.pubkey })),
      data: ix.data,
    });
  }

  private accountsOf(wallet: PublicKey, mint: PublicKey): PublicKey[] {
    const m = mint.toBase58();
    let byWallet = this.derived.get(m);
    if (!byWallet) this.derived.set(m, (byWallet = new Map()));
    const w = wallet.toBase58();
    let keys = byWallet.get(w);
    if (!keys) {
      keys = [wallet, splAta(wallet, mint), splAta(wallet, WSOL_MINT), pumpUserVolumeAccumulatorPda(wallet), ammUserVolumeAccumulatorPda(wallet)];
      byWallet.set(w, keys);
    }
    return keys;
  }
}
