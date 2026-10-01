import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SAME_SLOT_TRADE_MESSAGE,
  TransactionFailedError,
  describeError,
  prepareTx,
  sendAndConfirm,
  type MoshClient,
  type MoshEvent,
  type PriorityFeeBounds,
} from "@holdfast/sdk";
import type { LookupTable } from "./alt";

/**
 * Sends the agent's instructions: a legacy transaction through the SDK's `prepareTx` when it fits, else
 * a v0 transaction with the agent's lookup table (PumpSwap trades carry ~30 accounts). The v0 path
 * mirrors `prepareTx` — simulate for the compute limit, bid the recent fee market of the written
 * accounts, latest blockhash — because the SDK's helper is legacy-only.
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

/** Whether `ixs` behind the two compute-budget instructions fit a legacy transaction with one signature. */
export function legacyFits(payer: PublicKey, ixs: TransactionInstruction[]): boolean {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: PLACEHOLDER_BLOCKHASH }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ...ixs,
  );
  // One signature: its count byte plus 64 bytes, then the message.
  return 1 + 64 + tx.compileMessage().serialize().length <= PACKET_DATA_SIZE;
}

async function simulateV0Units(connection: Connection, compile: (budget: TransactionInstruction[], blockhash: string) => VersionedTransaction): Promise<number> {
  const tx = compile([ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS })], PLACEHOLDER_BLOCKHASH);
  for (let attempt = 0; ; attempt++) {
    const { value } = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    if (!value.err) return value.unitsConsumed ?? MAX_COMPUTE_UNITS;
    const error = new TransactionFailedError(value.err, value.logs ?? []);
    if (attempt >= SAME_SLOT_RETRIES || describeError(error) !== SAME_SLOT_TRADE_MESSAGE) throw error;
    await sleep(SLOT_MS);
  }
}

async function estimatePriorityFee(connection: Connection, payer: PublicKey, ixs: TransactionInstruction[], bounds: PriorityFeeBounds): Promise<number> {
  const keys = new Map<string, PublicKey>([[payer.toBase58(), payer]]);
  for (const ix of ixs) for (const k of ix.keys) if (k.isWritable) keys.set(k.pubkey.toBase58(), k.pubkey);
  const recent = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: [...keys.values()].slice(0, MAX_FEE_ACCOUNTS) });
  const fees = recent.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const market = fees.length ? fees[Math.ceil(fees.length * FEE_PERCENTILE) - 1]! : 0;
  return Math.min(bounds.cap, Math.max(bounds.floor, market));
}

async function sendV0(connection: Connection, signer: Keypair, ixs: TransactionInstruction[], fee: PriorityFeeBounds, table: AddressLookupTableAccount): Promise<Sent> {
  const payer = signer.publicKey;
  const compile = (budget: TransactionInstruction[], recentBlockhash: string) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: [...budget, ...ixs] }).compileToV0Message([table]));
  const [simulatedUnits, priorityMicroLamports, { blockhash, lastValidBlockHeight }] = await Promise.all([
    simulateV0Units(connection, compile),
    estimatePriorityFee(connection, payer, ixs, fee),
    connection.getLatestBlockhash("confirmed"),
  ]);
  const computeUnits = Math.min(MAX_COMPUTE_UNITS, Math.ceil(simulatedUnits * CU_MARGIN) + CU_HEADROOM);
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })];
  if (priorityMicroLamports > 0) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }));
  const tx = compile(budget, blockhash);
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
