/**
 * Shared by the multisig scripts (`handoff`, `upgrade`): `--dry-run`, step output, key loading and the
 * idempotent Squads v4 vault-transaction flow (find or create → propose → approve → execute).
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";
import type { MoshClient } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, ROOT, send } from "./common";

export const DRY_RUN = process.argv.includes("--dry-run");
export const CONFIG_FILE = path.join(LOCALNET_DIR, "config.json");
const SQUADS_APP: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "https://app.squads.so", // mainnet-beta
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "https://devnet.squads.so", // devnet
};
const { Proposal, VaultTransaction } = multisig.accounts;
export type MultisigAccount = multisig.accounts.Multisig;

export function fail(problem: string): never {
  console.error(`\n✗ ${path.basename(process.argv[1] ?? "script", ".ts")}: ${problem}\n`);
  process.exit(1);
}

export const done = (step: string, what: string) => console.log(`✓ ${step}: ${what}`);
export const todo = (step: string, what: string) =>
  console.log(`${DRY_RUN ? "→" : "…"} ${step}: ${DRY_RUN ? "would " : ""}${what}`);

export function readKeypair(file: string): Keypair {
  if (!fs.existsSync(file)) fail(`missing keypair ${file}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export function readConfig(): Record<string, unknown> {
  return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
}

/** The Squads app's transaction list for `multisigPda` on mainnet/devnet; null on other clusters. */
export async function squadsUrl(connection: Connection, multisigPda: PublicKey): Promise<string | null> {
  const app = SQUADS_APP[await connection.getGenesisHash()];
  return app ? `${app}/squads/${multisigPda.toBase58()}/transactions` : null;
}

export interface VaultSigners {
  /** Member that creates the vault transaction + proposal (PROPOSER_KEYPAIR, else the first approver). */
  proposer: Keypair | null;
  /** Members that approve; the first one executes. */
  approvers: Keypair[];
}

/**
 * PROPOSER_KEYPAIR / APPROVER_KEYPAIRS (key files relative to the repo root); each must be a member
 * of `ms`.
 */
export function readVaultSigners(ms: MultisigAccount): VaultSigners {
  const approvers = (process.env.APPROVER_KEYPAIRS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((file) => readKeypair(path.resolve(ROOT, file)));
  const proposerFile = process.env.PROPOSER_KEYPAIR;
  const proposer = proposerFile ? readKeypair(path.resolve(ROOT, proposerFile)) : (approvers[0] ?? null);
  for (const kp of proposer ? [proposer, ...approvers] : approvers) {
    if (!ms.members.some((m) => m.key.equals(kp.publicKey))) {
      fail(`${kp.publicKey.toBase58()} (PROPOSER_KEYPAIR/APPROVER_KEYPAIRS) is not a member of the multisig`);
    }
  }
  return { proposer, approvers };
}

/** Same program, accounts and data, in order. */
function messageMatches(tx: multisig.accounts.VaultTransaction, ixs: TransactionInstruction[]): boolean {
  const { accountKeys, instructions } = tx.message;
  return (
    instructions.length === ixs.length &&
    instructions.every((ci, i) => {
      const ix = ixs[i]!;
      return (
        accountKeys[ci.programIdIndex]?.equals(ix.programId) &&
        Buffer.from(ci.data).equals(ix.data) &&
        ci.accountIndexes.length === ix.keys.length &&
        [...ci.accountIndexes].every((k, j) => accountKeys[k]?.equals(ix.keys[j]!.pubkey))
      );
    })
  );
}

/** Newest non-stale vault transaction wrapping exactly `ixs` whose proposal is still live (or missing). */
async function findPendingVaultTx(connection: Connection, multisigPda: PublicKey, ms: MultisigAccount, ixs: TransactionInstruction[]) {
  const stale = BigInt(ms.staleTransactionIndex.toString());
  for (let index = BigInt(ms.transactionIndex.toString()); index > stale; index--) {
    const [txPda] = multisig.getTransactionPda({ multisigPda, index });
    const info = await connection.getAccountInfo(txPda);
    if (!info || !info.data.subarray(0, 8).equals(Buffer.from(multisig.accounts.vaultTransactionDiscriminator))) continue;
    if (!messageMatches(VaultTransaction.fromAccountInfo(info)[0], ixs)) continue;
    const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex: index });
    const pInfo = await connection.getAccountInfo(proposalPda);
    const proposal = pInfo ? Proposal.fromAccountInfo(pInfo)[0] : null;
    if (proposal && ["Rejected", "Cancelled", "Executed"].includes(proposal.status.__kind)) continue;
    return { index, proposal };
  }
  return null;
}

function printManualProcedure(ixs: TransactionInstruction[], vault: PublicKey, blockhash: string) {
  const tx = new Transaction({ feePayer: vault, recentBlockhash: blockhash }).add(...ixs);
  const b58 = utils.bytes.bs58.encode(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  console.log("   No PROPOSER_KEYPAIR: a member creates the proposal in the Squads app:");
  console.log("   TX Builder → Create transaction → Import a base58 encoded transaction, paste:");
  console.log(`   ${b58}`);
  console.log("   It must contain exactly these instructions (vault signs), in this order:");
  ixs.forEach((ix, i) => {
    console.log(`   #${i + 1} program ${ix.programId.toBase58()} data(base58) ${utils.bytes.bs58.encode(ix.data)}`);
    for (const k of ix.keys) {
      console.log(`       ${k.pubkey.toBase58()}${k.isSigner ? " signer" : ""}${k.isWritable ? " writable" : ""}`);
    }
  });
  console.log("   Or re-run this script with PROPOSER_KEYPAIR=<member keypair file> to create it.");
}

export interface VaultTxRun {
  connection: Connection;
  /** Fee payer and rent payer of everything sent (never a member). */
  client: MoshClient;
  admin: Keypair;
  multisigPda: PublicKey;
  ms: MultisigAccount;
  /** Vault index 0 of `ms`: signs `ixs`. */
  vault: PublicKey;
  signers: VaultSigners;
  /** Squads app link, else the multisig address, for members who approve by hand. */
  squadsHint: string;
}

/**
 * Drives one vault transaction wrapping exactly `ixs` as far as the available keys allow: reuses a
 * pending one (creating its missing proposal) or creates vault tx + proposal as the proposer, approves
 * as every approver that hasn't voted yet and, once the threshold is met, executes as the first
 * approver. Without a proposer it prints the Squads app import procedure instead. `label` describes
 * `ixs` in the output. Only call it while `ixs` still have to run: an executed match isn't looked for.
 */
export async function runVaultTransaction(run: VaultTxRun, step: string, label: string, ixs: TransactionInstruction[]) {
  const { connection, client, admin, multisigPda, ms, vault, signers, squadsHint } = run;
  const { proposer, approvers } = signers;
  const pending = await findPendingVaultTx(connection, multisigPda, ms, ixs);

  // Index of the vault transaction whose proposal exists after this block (null: not created yet).
  let live: bigint | null = null;
  if (pending?.proposal) {
    live = pending.index;
    done(step, `vault tx #${pending.index} has a proposal`);
  } else if (pending) {
    if (DRY_RUN || !proposer) {
      todo(step, `create the missing proposal for vault tx #${pending.index} (needs a member: PROPOSER_KEYPAIR or Squads app)`);
    } else {
      const ix = multisig.instructions.proposalCreate({
        multisigPda,
        creator: proposer.publicKey,
        rentPayer: admin.publicKey,
        transactionIndex: pending.index,
      });
      todo(step, `creating proposal for vault tx #${pending.index}`);
      console.log(`   tx ${await send(client, admin, [ix], [proposer])}`);
      live = pending.index;
    }
  } else if (DRY_RUN || !proposer) {
    todo(step, `create vault tx + proposal [${label}]`);
    if (!proposer) printManualProcedure(ixs, vault, (await connection.getLatestBlockhash()).blockhash);
  } else {
    const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
    const { blockhash } = await connection.getLatestBlockhash();
    const create = multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex,
      creator: proposer.publicKey,
      rentPayer: admin.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: ixs }),
    });
    const propose = multisig.instructions.proposalCreate({
      multisigPda,
      creator: proposer.publicKey,
      rentPayer: admin.publicKey,
      transactionIndex,
    });
    todo(step, `creating vault tx #${transactionIndex} + proposal (creator ${proposer.publicKey.toBase58()})`);
    console.log(`   tx ${await send(client, admin, [create, propose], [proposer])}`);
    live = transactionIndex;
  }

  if (approvers.length === 0) {
    console.log(`   members approve + execute ${live === null ? "it" : `vault tx #${live}`}: ${squadsHint}`);
    return;
  }
  if (live === null) {
    todo(step, `approve the new vault tx as ${approvers.length} APPROVER_KEYPAIRS and execute it`);
    return;
  }
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex: live });
  let proposal = await Proposal.fromAccountAddress(connection, proposalPda);
  for (const approver of approvers) {
    const who = approver.publicKey.toBase58();
    if (proposal.status.__kind !== "Active") break;
    if (proposal.approved.some((k) => k.equals(approver.publicKey))) {
      done(step, `${who} already approved #${live}`);
    } else if (DRY_RUN) {
      todo(step, `approve #${live} as ${who}`);
    } else {
      todo(step, `approving #${live} as ${who}`);
      const ix = multisig.instructions.proposalApprove({ multisigPda, transactionIndex: live, member: approver.publicKey });
      console.log(`   tx ${await send(client, admin, [ix], [approver])}`);
      proposal = await Proposal.fromAccountAddress(connection, proposalPda);
    }
  }
  const status = `${proposal.status.__kind}, ${proposal.approved.length}/${ms.threshold} approvals`;
  if (DRY_RUN) {
    todo(step, `execute vault tx #${live} once approved (now ${status})`);
  } else if (proposal.status.__kind === "Approved") {
    const executor = approvers[0]!;
    const { instruction } = await multisig.instructions.vaultTransactionExecute({
      connection,
      multisigPda,
      transactionIndex: live,
      member: executor.publicKey,
    });
    todo(step, `executing vault tx #${live} as ${executor.publicKey.toBase58()}`);
    console.log(`   tx ${await send(client, admin, [instruction], [executor])}`);
  } else {
    console.log(`   proposal #${live} is ${status} — remaining members approve + execute: ${squadsHint}`);
  }
}
