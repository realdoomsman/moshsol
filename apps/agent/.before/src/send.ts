import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Commitment,
  type Connection,
  type Keypair,
  type TransactionError,
  type TransactionInstruction,
} from "@solana/web3.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SAME_SLOT_TRADE_MESSAGE,
  TransactionExpiredError,
  TransactionFailedError,
  describeError,
  prepareTx,
  sendAndConfirm,
  type MoshClient,
  type MoshEvent,
  type PriorityFeeBounds,
} from "@holdfast/sdk";
import type { LookupTable } from "./alt";
import { log } from "./log";
import type { Stream } from "./stream";

/**
 * Sends the agent's instructions. Cranks go through `sendIxs`: a legacy transaction through the SDK's
 * `prepareTx` when it fits, else a v0 transaction with the agent's lookup table (PumpSwap trades carry ~30
 * accounts); the v0 path mirrors `prepareTx` — simulate for the compute limit, bid the recent fee market of the
 * written accounts, latest blockhash — because the SDK's helper is legacy-only. Trades go through `TradeSender`,
 * the latency-critical path (see its doc).
 */

/** Runtime ceiling on compute units per transaction. */
const MAX_COMPUTE_UNITS = 1_400_000;
/** `prepareTx`: limit = simulated units × margin + headroom. */
const CU_MARGIN = 1.15;
const CU_HEADROOM = 1_000;
/** `prepareTx`: nearest-rank percentile of recent per-slot fees, at most 128 accounts per query. */
const FEE_PERCENTILE = 0.75;
const MAX_FEE_ACCOUNTS = 128;
const SAME_SLOT_RETRIES = 5;
const SLOT_MS = 400;
/** Simulation replaces the blockhash, so the simulated message needs none of its own. */
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();

export interface SendCost {
  /** v0 transaction with the lookup table (legacy did not fit). */
  versioned: boolean;
  simulatedUnits: number;
  computeUnits: number;
  priorityMicroLamports: number;
  /** What the runtime charges on top of the base fee: limit × price, rounded up. */
  priorityFeeLamports: number;
}

export interface Sent {
  signature: string;
  cost: SendCost;
}

/** Whether `ixs` behind the two compute-budget instructions fit a legacy transaction (payer + every signer `ixs` mark). */
export function legacyFits(payer: PublicKey, ixs: TransactionInstruction[]): boolean {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: PLACEHOLDER_BLOCKHASH }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ...ixs,
  );
  const message = tx.compileMessage();
  // The signature count byte, 64 bytes per signature, then the message.
  return 1 + 64 * message.header.numRequiredSignatures + message.serialize().length <= PACKET_DATA_SIZE;
}

/** Units `tx` (compiled at the compute ceiling, unsigned) consumes; `SameSlotTrade` is retried a slot later. */
async function simulateUnits(connection: Connection, tx: VersionedTransaction, commitment: Commitment): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const { value } = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment });
    if (!value.err) return value.unitsConsumed ?? MAX_COMPUTE_UNITS;
    const error = new TransactionFailedError(value.err, value.logs ?? []);
    if (attempt >= SAME_SLOT_RETRIES || describeError(error) !== SAME_SLOT_TRADE_MESSAGE) throw error;
    await sleep(SLOT_MS);
  }
}

/** The fee payer and every account `ixs` write-lock: the local fee markets the transaction competes in. */
function writableAccounts(payer: PublicKey, ixs: TransactionInstruction[]): PublicKey[] {
  const keys = new Map<string, PublicKey>([[payer.toBase58(), payer]]);
  for (const ix of ixs) for (const k of ix.keys) if (k.isWritable) keys.set(k.pubkey.toBase58(), k.pubkey);
  return [...keys.values()].slice(0, MAX_FEE_ACCOUNTS);
}

/** µlamports per CU: the `percentile` (nearest rank) of what recent slots required to write-lock the accounts, clamped to `bounds`. */
async function estimatePriorityFee(connection: Connection, accounts: PublicKey[], bounds: PriorityFeeBounds, percentile: number): Promise<number> {
  const recent = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: accounts });
  const fees = recent.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const market = fees.length ? fees[Math.ceil(fees.length * percentile) - 1]! : 0;
  return Math.min(bounds.cap, Math.max(bounds.floor, market));
}

function v0(payer: PublicKey, ixs: TransactionInstruction[], recentBlockhash: string, table: AddressLookupTableAccount): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: ixs }).compileToV0Message([table]));
}

async function sendV0(connection: Connection, signer: Keypair, ixs: TransactionInstruction[], fee: PriorityFeeBounds, table: AddressLookupTableAccount): Promise<Sent> {
  const payer = signer.publicKey;
  const [simulatedUnits, priorityMicroLamports, { blockhash, lastValidBlockHeight }] = await Promise.all([
    simulateUnits(connection, v0(payer, [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }), ...ixs], PLACEHOLDER_BLOCKHASH, table), "confirmed"),
    estimatePriorityFee(connection, writableAccounts(payer, ixs), fee, FEE_PERCENTILE),
    connection.getLatestBlockhash("confirmed"),
  ]);
  const computeUnits = Math.min(MAX_COMPUTE_UNITS, Math.ceil(simulatedUnits * CU_MARGIN) + CU_HEADROOM);
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })];
  if (priorityMicroLamports > 0) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }));
  const tx = v0(payer, [...budget, ...ixs], blockhash, table);
  tx.sign([signer]);
  const signature = await sendAndConfirm(connection, tx.serialize(), lastValidBlockHeight);
  return { signature, cost: cost(true, simulatedUnits, computeUnits, priorityMicroLamports) };
}

function cost(versioned: boolean, simulatedUnits: number, computeUnits: number, priorityMicroLamports: number): SendCost {
  return { versioned, simulatedUnits, computeUnits, priorityMicroLamports, priorityFeeLamports: Math.ceil((computeUnits * priorityMicroLamports) / 1_000_000) };
}

/** Prepares, signs, sends and confirms `ixs`; legacy when it fits, else v0 with the lookup table. */
export async function sendIxs(connection: Connection, signer: Keypair, ixs: TransactionInstruction[], fee: PriorityFeeBounds, alt: LookupTable): Promise<Sent> {
  if (!legacyFits(signer.publicKey, ixs)) return sendV0(connection, signer, ixs, fee, await alt.get());
  const prepared = await prepareTx(connection, signer.publicKey, ixs, fee);
  prepared.tx.sign(signer);
  const signature = await sendAndConfirm(connection, prepared.tx.serialize(), prepared.lastValidBlockHeight);
  return { signature, cost: cost(false, prepared.unitsConsumed, prepared.computeUnits, prepared.priorityMicroLamports) };
}

/** Compute used, fee paid and emitted events of a landed transaction (log detail only; null when unavailable). */
export async function landed(client: MoshClient, signature: string): Promise<{ cost: Record<string, unknown>; events: MoshEvent[] } | null> {
  const tx = await client.connection
    .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .catch(() => null);
  if (!tx?.meta) return null;
  return {
    cost: { unitsConsumed: tx.meta.computeUnitsConsumed, feeLamports: tx.meta.fee },
    events: client.parseEvents(tx.meta.logMessages ?? []),
  };
}

// ------------------------------------------------------------------ trades: the fast path

/** Trades bid this percentile of the recent fee market of their accounts (cranks: FEE_PERCENTILE): land in the next slot or two. */
const TRADE_FEE_PERCENTILE = 0.9;
/** The cached blockhash is refreshed this often in the background and used up to TRADE_BLOCKHASH_MAX_AGE_MS old (it stays valid ≈ 60 s). */
const BLOCKHASH_REFRESH_MS = 5_000;
const TRADE_BLOCKHASH_MAX_AGE_MS = 20_000;
/** A launch's fee estimate is reused this long (re-estimated in the background once used past it). */
const FEE_TTL_MS = 10_000;
/** Limit from a remembered (landed) unit count: × margin + headroom, more slack than a fresh simulation gets. */
const CACHED_CU_MARGIN = 1.3;
const CACHED_CU_HEADROOM = 5_000;
/** Status poll while waiting for a trade: fast without the stream, a slow fallback next to its signature notifications. */
const STATUS_POLL_MS = 400;
const STATUS_POLL_STREAM_MS = 1_000;
const REBROADCAST_MS = 2_000;
/** Helius Sender keeps its connection warm with a GET /ping during idle stretches (> 5 s). */
const SENDER_PING_MS = 5_000;
/** Helius Sender's designated tip accounts (mainnet-beta); one is picked at random per transaction. */
const SENDER_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
].map((a) => new PublicKey(a));

export interface TradeSendCost extends SendCost {
  /** Compute units came from a remembered landing (no simulation in the hot path). */
  cachedUnits: boolean;
  /** Lamports tipped to Helius Sender (0 without `SENDER_URL`). */
  tipLamports: number;
}

/** Wall-clock ms of one trade's way out. */
export interface SendTiming {
  /** Instruction handed over → transaction signed (compute limit, fee, blockhash). */
  preparedAt: number;
  /** First send accepted (RPC or Sender). */
  sentAt: number;
  /** Seen processed (null when only the confirmation was observed). */
  landedAt: number | null;
  confirmedAt: number;
  slot: number | null;
}

export interface TradeSent {
  signature: string;
  cost: TradeSendCost;
  timing: SendTiming;
}

/**
 * The latency-critical send of `agent_*` trades. Nothing waits on a round trip that can be done ahead of time:
 * the blockhash is refreshed in the background, a launch's fee estimate (the TRADE_FEE_PERCENTILE of its
 * accounts' recent fee market, within the configured floor/cap) is warmed by the heartbeat and reused for
 * FEE_TTL_MS, and the compute limit comes from the units the same trade kind consumed when it last landed (a
 * simulation only the first time). The transaction goes out without preflight — the plan was made on the same
 * state, and every rule is the program's to enforce anyway — to the RPC (Helius paid plans route it over staked
 * connections) and, with `SENDER_URL`, to Helius Sender at the same time (the transaction then carries the
 * Sender tip). Landing is tracked through the stream's signature notifications (processed, then confirmed) with
 * a status poll as fallback, rebroadcasting every 2 s until the blockhash expires.
 */
export class TradeSender {
  private blockhash: { blockhash: string; lastValidBlockHeight: number; at: number } | null = null;
  private blockhashPending: Promise<void> | null = null;
  /** Fee estimate per launch address. */
  private readonly fees = new Map<string, { micro: number; at: number; pending: boolean }>();
  /** Units consumed by the last landing, per trade kind (`<launch address>:<side>:<venue stage>`). */
  private readonly units = new Map<string, number>();
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly signer: Keypair,
    private readonly bounds: PriorityFeeBounds,
    private readonly alt: LookupTable,
    private readonly stream: Stream | null,
    private readonly sender: { url: string; tipLamports: number } | null,
  ) {}

  start(): void {
    const refresh = setInterval(() => void this.refreshBlockhash(), BLOCKHASH_REFRESH_MS);
    refresh.unref();
    this.timers.push(refresh);
    void this.refreshBlockhash();
    if (this.sender) {
      const ping = new URL(this.sender.url);
      ping.pathname = "/ping";
      ping.search = "";
      const warm = setInterval(() => void fetch(ping).then((r) => r.body?.cancel()).catch(() => undefined), SENDER_PING_MS);
      warm.unref();
      this.timers.push(warm);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  /** Pre-estimates the fee of `ixs` under `feeKey` (heartbeat, off the hot path). */
  async warm(feeKey: string, ixs: TransactionInstruction[]): Promise<void> {
    const cached = this.fees.get(feeKey);
    if (cached && Date.now() - cached.at < FEE_TTL_MS) return;
    await this.estimate(feeKey, ixs);
  }

  /** Remembers what a landed trade of `unitsKey` consumed (its next send skips the simulation). */
  noteUnits(unitsKey: string, unitsConsumed: number): void {
    if (unitsConsumed > 0) this.units.set(unitsKey, unitsConsumed);
  }

  /** The next send of `unitsKey` simulates first (after a failure: a program error is then caught before it costs a fee). */
  forgetUnits(unitsKey: string): void {
    this.units.delete(unitsKey);
  }

  /** Forgets the fee estimates and unit counts of launches no longer in `live` (launch addresses). */
  retain(live: Set<string>): void {
    for (const key of [...this.fees.keys()]) if (!live.has(key)) this.fees.delete(key);
    for (const key of [...this.units.keys()]) if (!live.has(key.slice(0, key.indexOf(":")))) this.units.delete(key);
  }

  /**
   * Signs and sends `ixs` (one trade), resolving once confirmed; a landed failure throws `TransactionFailedError`
   * (logs attached), an expired blockhash `TransactionExpiredError`. `onSent` fires once the send was accepted.
   * `payerWallet` (an agent wallet executing the trade) pays the fee and the Sender tip and signs next to the agent.
   */
  async send(
    ixs: TransactionInstruction[],
    keys: { fee: string; units: string },
    onSent?: (signature: string) => void,
    payerWallet?: Keypair,
  ): Promise<TradeSent> {
    const payer = (payerWallet ?? this.signer).publicKey;
    const extra: TransactionInstruction[] = [];
    if (this.sender) {
      const tip = SENDER_TIP_ACCOUNTS[Math.floor(Math.random() * SENDER_TIP_ACCOUNTS.length)]!;
      extra.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: tip, lamports: this.sender.tipLamports }));
    }
    const body = [...ixs, ...extra];
    const legacy = legacyFits(payer, body);
    const table = legacy ? null : await this.alt.get();
    const compile = (budget: TransactionInstruction[], recentBlockhash: string) => {
      const all = [...budget, ...body];
      if (table) return v0(payer, all, recentBlockhash, table);
      return new VersionedTransaction(new Transaction({ feePayer: payer, recentBlockhash }).add(...all).compileMessage());
    };
    const remembered = this.units.get(keys.units);
    const [units, micro, hash] = await Promise.all([
      remembered ?? simulateUnits(this.connection, compile([ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS })], PLACEHOLDER_BLOCKHASH), "processed"),
      this.fee(keys.fee, ixs),
      this.freshBlockhash(),
    ]);
    const computeUnits =
      remembered !== undefined
        ? Math.min(MAX_COMPUTE_UNITS, Math.ceil(units * CACHED_CU_MARGIN) + CACHED_CU_HEADROOM)
        : Math.min(MAX_COMPUTE_UNITS, Math.ceil(units * CU_MARGIN) + CU_HEADROOM);
    // Sender rejects a transaction without a compute-unit price instruction.
    const price = this.sender ? Math.max(1, micro) : micro;
    const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })];
    if (price > 0) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }));
    const tx = compile(budget, hash.blockhash);
    tx.sign(payerWallet ? [payerWallet, this.signer] : [this.signer]);
    const raw = tx.serialize();
    const preparedAt = Date.now();
    const signature = await this.broadcast(raw, true);
    const sentAt = Date.now();
    onSent?.(signature);
    const timing = await this.confirm(signature, raw, hash.lastValidBlockHeight);
    return {
      signature,
      cost: { ...cost(table !== null, units, computeUnits, price), cachedUnits: remembered !== undefined, tipLamports: this.sender?.tipLamports ?? 0 },
      timing: { preparedAt, sentAt, ...timing },
    };
  }

  private async fee(feeKey: string, ixs: TransactionInstruction[]): Promise<number> {
    const cached = this.fees.get(feeKey);
    if (!cached) return this.estimate(feeKey, ixs);
    if (Date.now() - cached.at >= FEE_TTL_MS && !cached.pending) {
      cached.pending = true;
      void this.estimate(feeKey, ixs).catch(() => undefined);
    }
    return cached.micro;
  }

  private async estimate(feeKey: string, ixs: TransactionInstruction[]): Promise<number> {
    const micro = await estimatePriorityFee(this.connection, writableAccounts(this.signer.publicKey, ixs), this.bounds, TRADE_FEE_PERCENTILE);
    this.fees.set(feeKey, { micro, at: Date.now(), pending: false });
    return micro;
  }

  private refreshBlockhash(): Promise<void> {
    this.blockhashPending ??= this.connection
      .getLatestBlockhash("confirmed")
      .then((h) => {
        this.blockhash = { ...h, at: Date.now() };
      })
      .catch((err: unknown) => log("blockhash_refresh_failed", { error: describeError(err) }))
      .finally(() => {
        this.blockhashPending = null;
      });
    return this.blockhashPending;
  }

  private async freshBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    if (!this.blockhash || Date.now() - this.blockhash.at > TRADE_BLOCKHASH_MAX_AGE_MS) {
      const h = await this.connection.getLatestBlockhash("confirmed");
      this.blockhash = { ...h, at: Date.now() };
    }
    return this.blockhash;
  }

  /** Sends `raw` to the RPC and Sender at once; resolves with the first acceptance (rejects only if every path does). */
  private async broadcast(raw: Uint8Array, first: boolean): Promise<string> {
    const paths: Promise<string>[] = [this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })];
    if (this.sender) paths.push(this.viaSender(raw));
    if (!first) {
      for (const p of paths) p.catch(() => undefined);
      return "";
    }
    try {
      return await Promise.any(paths);
    } catch (err) {
      throw err instanceof AggregateError ? err.errors[0] : err;
    }
  }

  private async viaSender(raw: Uint8Array): Promise<string> {
    const res = await fetch(this.sender!.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "sendTransaction",
        params: [Buffer.from(raw).toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (json.error || !json.result) throw new Error(`Sender: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return json.result;
  }

  /** Waits for `signature`: processed (timing only), then confirmed; a failure is only reported once confirmed. */
  private async confirm(signature: string, raw: Uint8Array, lastValidBlockHeight: number): Promise<Omit<SendTiming, "preparedAt" | "sentAt">> {
    let landedAt: number | null = null;
    let slot: number | null = null;
    let confirmed: { err: TransactionError | null; at: number; slot: number } | null = null;
    const subs: number[] = [];
    let wake: (() => void) | null = null;
    const notify = () => wake?.();
    if (this.stream?.healthy) {
      subs.push(
        this.stream.signature(signature, "processed", (u) => {
          landedAt ??= u.at;
          slot ??= u.slot;
        }),
        this.stream.signature(signature, "confirmed", (u) => {
          confirmed ??= { err: u.err, at: u.at, slot: u.slot };
          notify();
        }),
      );
    }
    try {
      let nextBroadcast = Date.now() + REBROADCAST_MS;
      for (;;) {
        if (!confirmed) {
          const { promise, resolve } = Promise.withResolvers<void>();
          wake = resolve;
          const timer = setTimeout(resolve, subs.length ? STATUS_POLL_STREAM_MS : STATUS_POLL_MS);
          await promise;
          clearTimeout(timer);
          wake = null;
        }
        if (!confirmed) {
          const due = Date.now() >= nextBroadcast;
          // Height before status: any block that could still include the transaction is then visible to the status read.
          const pastExpiry = due && (await this.connection.getBlockHeight("confirmed")) > lastValidBlockHeight;
          const [status] = (await this.connection.getSignatureStatuses([signature])).value;
          if (status) {
            landedAt ??= Date.now();
            slot ??= status.slot;
            if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
              confirmed = { err: status.err, at: Date.now(), slot: status.slot };
            }
          }
          if (!confirmed) {
            if (pastExpiry && !status) throw new TransactionExpiredError(signature, lastValidBlockHeight);
            if (due) {
              nextBroadcast = Date.now() + REBROADCAST_MS;
              void this.broadcast(raw, false);
            }
            continue;
          }
        }
        const done: { err: TransactionError | null; at: number; slot: number } = confirmed;
        if (done.err) {
          const tx = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
          throw new TransactionFailedError(done.err, tx?.meta?.logMessages ?? [], signature);
        }
        return { landedAt: landedAt ?? done.at, confirmedAt: done.at, slot: slot ?? done.slot };
      }
    } finally {
      for (const id of subs) this.stream!.remove(id);
    }
  }
}
