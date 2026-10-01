import { createHash } from "node:crypto";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MPL_TOKEN_METADATA_ID,
  PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@holdfast/sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PACKET_DATA_SIZE, PublicKey, SystemProgram, VersionedMessage } from "@solana/web3.js";
import { ed25519Sign } from "./crypto";

/**
 * Programs a custodial wallet signs top-level instructions for (CPIs are the called program's business).
 * The pump.fun venue programs are here so a custodial wallet can trade a pump launch's token on
 * pump.fun / PumpSwap and crank `launch_pump`-style flows that touch them directly.
 */
export const ALLOWED_PROGRAMS: Record<string, string> = {
  [PROGRAM_ID.toBase58()]: "Holdfast",
  [SystemProgram.programId.toBase58()]: "System",
  [ComputeBudgetProgram.programId.toBase58()]: "Compute Budget",
  [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()]: "Associated Token",
  [TOKEN_2022_PROGRAM_ID.toBase58()]: "Token-2022",
  [TOKEN_PROGRAM_ID.toBase58()]: "SPL Token",
  [PUMP_PROGRAM_ID.toBase58()]: "pump.fun",
  [PUMP_AMM_PROGRAM_ID.toBase58()]: "PumpSwap",
  [PUMP_FEE_PROGRAM_ID.toBase58()]: "pump.fun fees",
  [MPL_TOKEN_METADATA_ID.toBase58()]: "Metaplex Token Metadata",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
};

/**
 * System instructions allowed at top level, by instruction index. Each moves lamports out of its
 * first account (the funder/sender), which must be the user's wallet. Everything else (assign,
 * allocate, nonce accounts, transfers from seed-derived accounts) is refused.
 */
const SYSTEM_FUNDED: Record<number, string> = { 0: "CreateAccount", 2: "Transfer", 3: "CreateAccountWithSeed" };

export class PolicyError extends Error {}

export interface Signable {
  /** The serialized message the signatures cover (exactly the bytes that were checked). */
  message: Uint8Array;
  /** Byte offset of the fee payer's signature slot (signature 0) in the wire transaction. */
  signatureOffset: number;
  /** sha256 of `message`, hex: the audit log's transaction reference. */
  messageHash: string;
}

/** Compact-u16 ("shortvec") at `offset`: [value, bytes read]. */
function readShortVec(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = bytes[offset + i];
    if (b === undefined) throw new PolicyError("truncated transaction");
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, i + 1];
  }
  throw new PolicyError("malformed transaction");
}

/**
 * Checks a wire-format transaction (legacy or v0, unsigned by the owner; other signers may already
 * have signed) against the custodial signing policy for `owner`:
 * - the fee payer (account 0) is `owner`;
 * - every instruction's program is in ALLOWED_PROGRAMS;
 * - System instructions are CreateAccount / Transfer / CreateAccountWithSeed funded by `owner`.
 * The message must re-serialize to the same bytes, so what was checked is what gets signed.
 */
export function checkTransaction(raw: Uint8Array, owner: PublicKey): Signable {
  if (raw.length > PACKET_DATA_SIZE) throw new PolicyError(`transaction is larger than ${PACKET_DATA_SIZE} bytes`);
  const [signatureCount, prefix] = readShortVec(raw, 0);
  const messageStart = prefix + signatureCount * 64;
  if (signatureCount < 1 || messageStart >= raw.length) throw new PolicyError("malformed transaction");
  const message = raw.subarray(messageStart);
  let parsed: VersionedMessage;
  try {
    parsed = VersionedMessage.deserialize(message);
  } catch {
    throw new PolicyError("malformed transaction message");
  }
  if (!Buffer.from(parsed.serialize()).equals(message)) throw new PolicyError("non-canonical transaction message");
  if (parsed.header.numRequiredSignatures !== signatureCount) throw new PolicyError("signature count does not match the message");

  const keys = parsed.staticAccountKeys;
  const payer = keys[0];
  if (!payer?.equals(owner)) throw new PolicyError(`fee payer ${payer?.toBase58() ?? "(none)"} is not your wallet`);
  parsed.compiledInstructions.forEach((ix, i) => {
    const where = `instruction ${i + 1}`;
    const program = keys[ix.programIdIndex];
    if (!program) throw new PolicyError(`${where}: program must be a static account`);
    if (!Object.hasOwn(ALLOWED_PROGRAMS, program.toBase58())) {
      throw new PolicyError(`${where}: program ${program.toBase58()} is not allowed`);
    }
    if (!program.equals(SystemProgram.programId)) return;
    const kind = ix.data.length >= 4 ? Buffer.from(ix.data).readUInt32LE(0) : -1;
    if (!Object.hasOwn(SYSTEM_FUNDED, kind)) throw new PolicyError(`${where}: System instruction ${kind} is not allowed`);
    const source = keys[ix.accountKeyIndexes[0] ?? -1];
    if (!source?.equals(owner)) throw new PolicyError(`${where}: System ${SYSTEM_FUNDED[kind]} must be funded by your wallet`);
  });
  return { message, signatureOffset: prefix, messageHash: createHash("sha256").update(message).digest("hex") };
}

/** `raw` with the fee payer's signature (by `secretKey`) filled in; other signatures are kept as sent. */
export function signChecked(raw: Uint8Array, signable: Signable, secretKey: Uint8Array): Uint8Array {
  const out = Uint8Array.from(raw);
  out.set(ed25519Sign(secretKey, signable.message), signable.signatureOffset);
  return out;
}
