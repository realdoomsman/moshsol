import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
  type TransactionError,
  type TransactionInstruction,
} from "@solana/web3.js";
import { SAME_SLOT_TRADE_MESSAGE, describeError } from "./program";

/**
 * Transaction landing shared by the agent, the web app and the scripts: compute limits sized from a
 * simulation, a priority fee from the recent fee market of the accounts the transaction writes, and a
 * send that rebroadcasts until the transaction confirms or its blockhash expires.
 */

/** Runtime ceiling on compute units per transaction. */
const MAX_COMPUTE_UNITS = 1_400_000;
/**
 * Limit = simulated units × margin + headroom: state can move between simulation and execution
 * (curve position, agent window roll-over, a token account created meanwhile), and the priority-fee
 * instruction is not part of the simulation.
 */
const CU_MARGIN = 1.15;
const CU_HEADROOM = 1_000;
/** Recent per-slot fees to bid at (nearest-rank percentile). */
const FEE_PERCENTILE = 0.75;
/** `getRecentPrioritizationFees` accepts at most this many accounts. */
const MAX_FEE_ACCOUNTS = 128;

/**
 * Priority fee bounds in µlamports per compute unit. Recent fees for accounts only this program writes
 * are mostly 0 on mainnet, so the floor is what normally gets paid (on localnet, where every transaction
 * pays it, the estimate tracks the floor); the cap bounds what a contended launch can cost.
 */
export interface PriorityFeeBounds {
  floor: number;
  cap: number;
}

/**
 * Defaults for mainnet: 0.1 lamport/CU keeps transactions ahead of unprioritized traffic in congested
 * blocks; at the 2 lamports/CU cap a ~60k CU trade pays ≈0.00012 SOL on top of the 5,000-lamport base fee.
 */
export const DEFAULT_PRIORITY_FEE: PriorityFeeBounds = { floor: 100_000, cap: 2_000_000 };

/**
 * `SameSlotTrade` collisions (a public and a vault-agent trade in one slot) clear on the next slot:
 * simulation and the first send retry them this many times, a slot apart, before the error surfaces.
 */
const SAME_SLOT_RETRIES = 5;
const SLOT_MS = 400;
const STATUS_POLL_MS = 500;
const REBROADCAST_MS = 2_000;
/** Simulation replaces the blockhash, so the simulated message needs none of its own. */
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();

// Browser-safe (no node:timers/promises); the ES2022 lib has no Promise.withResolvers.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A simulated or landed transaction failed; `logs` let `describeError` name the program error. */
export class TransactionFailedError extends Error {
  constructor(
    readonly txError: TransactionError,
    readonly logs: string[],
    readonly signature?: string,
  ) {
    super(`${signature ? `transaction ${signature}` : "simulation"} failed: ${JSON.stringify(txError)}`);
    this.name = "TransactionFailedError";
  }
}

/** The blockhash expired before the transaction was included: it never executed and cannot land anymore. */
export class TransactionExpiredError extends Error {
  constructor(
    readonly signature: string,
    readonly lastValidBlockHeight: number,
  ) {
    super(`Transaction expired unconfirmed (block height passed ${lastValidBlockHeight}); it did not execute`);
    this.name = "TransactionExpiredError";
  }
}

/** Compute-unit limit for a transaction that consumed `unitsConsumed` in simulation. */
function computeUnitLimit(unitsConsumed: number): number {
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(unitsConsumed * CU_MARGIN) + CU_HEADROOM);
}

/**
 * Compute units `ixs` consume when `payer` sends them, simulated unsigned at the compute ceiling
 * against the latest blockhash. `SameSlotTrade` is retried a slot later; any other failure throws
 * `TransactionFailedError` carrying the program logs.
 */
async function simulateComputeUnits(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
): Promise<number> {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: PLACEHOLDER_BLOCKHASH }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }),
    ...ixs,
  );
  const message = new VersionedTransaction(tx.compileMessage());
  for (let attempt = 0; ; attempt++) {
    const { value } = await connection.simulateTransaction(message, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    // An RPC that doesn't report usage gets the ceiling: the transaction still fits, it just bids on more units.
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

/**
 * µlamports per CU to bid: the 75th percentile of what recent slots (up to 150) required to write-lock
 * `accounts`, clamped to `bounds`.
 */
async function estimatePriorityFee(
  connection: Connection,
  accounts: PublicKey[],
  bounds: PriorityFeeBounds,
): Promise<number> {
  const recent = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: accounts });
  const fees = recent.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const market = fees.length ? fees[Math.ceil(fees.length * FEE_PERCENTILE) - 1]! : 0;
  return Math.min(bounds.cap, Math.max(bounds.floor, market));
}

export interface PreparedTx {
  /** `[compute limit, compute price (if > 0), ...ixs]`, fee payer and blockhash set, unsigned. */
  tx: Transaction;
  lastValidBlockHeight: number;
  /** Simulated usage and the limit derived from it. */
  unitsConsumed: number;
  computeUnits: number;
  priorityMicroLamports: number;
}

/**
 * Legacy transaction for `ixs`, ready to sign: simulation (which also surfaces program errors before
 * any signing), fee estimate and blockhash run concurrently.
 */
export async function prepareTx(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  fee: PriorityFeeBounds,
): Promise<PreparedTx> {
  const [unitsConsumed, priorityMicroLamports, { blockhash, lastValidBlockHeight }] = await Promise.all([
    simulateComputeUnits(connection, payer, ixs),
    estimatePriorityFee(connection, writableAccounts(payer, ixs), fee),
    connection.getLatestBlockhash("confirmed"),
  ]);
  const computeUnits = computeUnitLimit(unitsConsumed);
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
  );
  if (priorityMicroLamports > 0) tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }));
  tx.add(...ixs);
  return { tx, lastValidBlockHeight, unitsConsumed, computeUnits, priorityMicroLamports };
}

/**
 * Sends signed transaction bytes and waits until they are confirmed. The first send runs preflight; a
 * `SameSlotTrade` rejection there never landed, so the same bytes go out again a slot later. After that
 * `confirmSignature` rebroadcasts them until they land or expire. `onSent` gets the signature once the
 * first send is accepted.
 */
export async function sendAndConfirm(
  connection: Connection,
  raw: Uint8Array,
  lastValidBlockHeight: number,
  onSent?: (signature: string) => void,
): Promise<string> {
  let signature: string;
  for (let attempt = 0; ; attempt++) {
    try {
      signature = await connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" });
      break;
    } catch (err) {
      if (attempt >= SAME_SLOT_RETRIES || describeError(err) !== SAME_SLOT_TRADE_MESSAGE) throw err;
      await sleep(SLOT_MS);
    }
  }
  onSent?.(signature);
  return confirmSignature(connection, signature, lastValidBlockHeight, raw);
}

/**
 * Polls `signature` until it is confirmed and returns it; a landed failure throws
 * `TransactionFailedError` with its logs, and once the block height passes `lastValidBlockHeight` without
 * the signature showing up, `TransactionExpiredError`. With `raw`, the signed bytes are rebroadcast
 * every 2 s (no preflight, no RPC-side retries) so a dropped transaction still gets forwarded to leaders.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  raw?: Uint8Array,
): Promise<string> {
  let nextBroadcast = Date.now() + REBROADCAST_MS;
  for (;;) {
    await sleep(STATUS_POLL_MS);
    const due = Date.now() >= nextBroadcast;
    // Height before status: any block that could still include the transaction is then visible to the status read.
    const pastExpiry = due && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight;
    const [status] = (await connection.getSignatureStatuses([signature])).value;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.err) throw await landedFailure(connection, signature, status.err);
      return signature;
    }
    if (!due) continue;
    if (pastExpiry && !status) throw new TransactionExpiredError(signature, lastValidBlockHeight);
    nextBroadcast = Date.now() + REBROADCAST_MS;
    if (raw) void connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
  }
}

async function landedFailure(connection: Connection, signature: string, err: TransactionError) {
  const tx = await connection
    .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .catch(() => null);
  return new TransactionFailedError(err, tx?.meta?.logMessages ?? [], signature);
}
