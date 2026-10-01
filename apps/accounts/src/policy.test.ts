import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { test } from "node:test";
import { PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "@holdfast/sdk";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type PublicKey,
} from "@solana/web3.js";
import { PolicyError, checkTransaction, signChecked } from "./policy";

const owner = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

/** An instruction for `programId` (the policy looks at the program, not the data). */
function ixFor(programId: PublicKey, extraSigner?: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      ...(extraSigner ? [{ pubkey: extraSigner, isSigner: true, isWritable: true }] : []),
    ],
    data: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  });
}

const holdfastIx = (extraSigner?: PublicKey) => ixFor(PROGRAM_ID, extraSigner);

function legacy(ixs: TransactionInstruction[], feePayer = owner.publicKey): Transaction {
  return new Transaction({ feePayer, blockhash, lastValidBlockHeight: 1 }).add(...ixs);
}

const wire = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false });

function rejects(tx: Transaction, reason: RegExp): void {
  assert.throws(() => checkTransaction(wire(tx), owner.publicKey), (err: unknown) => err instanceof PolicyError && reason.test(err.message));
}

test("signs a buy-shaped transaction and keeps signatures other signers already added", () => {
  const mint = Keypair.generate();
  const tx = legacy([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    holdfastIx(mint.publicKey),
    SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5_000 }),
  ]);
  tx.partialSign(mint);
  const raw = wire(tx);
  const signed = Transaction.from(signChecked(raw, checkTransaction(raw, owner.publicKey), owner.secretKey));
  assert.ok(signed.verifySignatures(), "fee payer and mint signatures both verify");
  assert.ok(signed.signatures.some((s) => s.publicKey.equals(mint.publicKey) && s.signature !== null));
});

test("signs pump.fun / PumpSwap venue trades (where pump launches are traded)", () => {
  for (const program of [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID]) {
    const raw = wire(legacy([ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }), ixFor(program)]));
    const signed = Transaction.from(signChecked(raw, checkTransaction(raw, owner.publicKey), owner.secretKey));
    assert.ok(signed.verifySignatures());
  }
});

test("signs versioned (v0) transactions", () => {
  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }), holdfastIx()],
  }).compileToV0Message();
  const raw = new VersionedTransaction(message).serialize();
  const out = VersionedTransaction.deserialize(signChecked(raw, checkTransaction(raw, owner.publicKey), owner.secretKey));
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: owner.publicKey.toBuffer().toString("base64url") }, format: "jwk" });
  assert.ok(verify(null, out.message.serialize(), key, out.signatures[0]));
});

test("rejects a fee payer other than the user's wallet", () => {
  const other = Keypair.generate().publicKey;
  rejects(legacy([holdfastIx()], other), /fee payer .* is not your wallet/);
});

test("rejects instructions for programs outside the allowlist", () => {
  const drainer = new TransactionInstruction({
    programId: Keypair.generate().publicKey,
    keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.alloc(8),
  });
  rejects(legacy([ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }), drainer]), /instruction 2: program .* is not allowed/);
});

test("rejects System transfers that don't come from the user's wallet", () => {
  const other = Keypair.generate();
  const tx = legacy([
    holdfastIx(),
    SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: owner.publicKey, lamports: 1 }),
  ]);
  tx.partialSign(other);
  rejects(tx, /instruction 2: System Transfer must be funded by your wallet/);
});

test("rejects System instructions that hand the wallet account to a program", () => {
  rejects(legacy([SystemProgram.assign({ accountPubkey: owner.publicKey, programId: PROGRAM_ID })]), /System instruction 1 is not allowed/);
});
