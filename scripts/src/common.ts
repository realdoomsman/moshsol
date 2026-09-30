import { Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, type Signer, type TransactionInstruction } from "@solana/web3.js";
import { DEFAULT_PRIORITY_FEE, MoshClient, prepareTx, sendAndConfirm } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOCALNET_DIR = path.resolve(ROOT, process.env.KEYS_DIR ?? ".localnet");
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";

export function loadOrCreateKeypair(name: string): Keypair {
  fs.mkdirSync(LOCALNET_DIR, { recursive: true });
  const file = path.join(LOCALNET_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export async function airdrop(connection: Connection, to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, Math.round(sol * LAMPORTS_PER_SOL));
  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

/** Simulation-sized compute limit, fee-market priority fee (`DEFAULT_PRIORITY_FEE`), rebroadcast until confirmed. */
export async function send(
  client: MoshClient,
  payer: Keypair,
  ixs: TransactionInstruction[],
  extraSigners: Signer[] = [],
): Promise<string> {
  const { tx, lastValidBlockHeight } = await prepareTx(client.connection, payer.publicKey, ixs, DEFAULT_PRIORITY_FEE);
  tx.sign(payer, ...extraSigners);
  return sendAndConfirm(client.connection, tx.serialize(), lastValidBlockHeight);
}

export function clientFor(connection: Connection, kp: Keypair) {
  return new MoshClient(connection, new Wallet(kp));
}
