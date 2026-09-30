/**
 * Hands the platform admin, the platform fee recipient and the program upgrade authority from the
 * hot `$KEYS_DIR/admin.json` key to a Squads v4 multisig vault (index 0). Idempotent: every step
 * reads chain state first and is skipped when already done, so re-run it after each approval round.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet MEMBERS=<pk1>,<pk2>,<pk3> THRESHOLD=2 pnpm handoff --dry-run
 *
 * Env: RPC_URL, KEYS_DIR (must contain admin.json), MEMBERS (comma-separated member pubkeys),
 *      THRESHOLD, MULTISIG (optional: reuse this existing multisig instead of creating one),
 *      PROPOSER_KEYPAIR (optional: keypair file of one MEMBER, see step 3; defaults to the first
 *      APPROVER_KEYPAIRS entry), APPROVER_KEYPAIRS (optional: comma-separated MEMBER keypair files
 *      that approve and execute the step-3 proposal in the same run). Key paths are relative to
 *      the repo root.
 * `--dry-run` prints the plan and the current PASS/FAIL table without writing or sending anything.
 *
 * Steps (admin pays every fee and rent):
 *   1. Create the multisig (all MEMBERS get Initiate/Vote/Execute, no config authority, no time
 *      lock). The create key is persisted to $KEYS_DIR/multisig-create-key.json before sending, so a
 *      re-run finds the same multisig. Multisig + vault are merged into $KEYS_DIR/config.json.
 *      A reused/created multisig must match MEMBERS/THRESHOLD exactly and have no config
 *      authority, otherwise the script stops before handing anything over.
 *   2. propose_admin(vault), signed by the current admin.
 *   3. One vault transaction [accept_admin, set_fee_recipient(vault)] with a proposal. accept_admin
 *      must be signed by the pending admin (the vault) and set_fee_recipient requires the admin, so
 *      both run inside the same vault transaction, in that order. Squads v4 only lets a member with
 *      the Initiate permission create vault transactions/proposals (the admin is not a member and can
 *      only pay rent), so either set PROPOSER_KEYPAIR/APPROVER_KEYPAIRS to member keys (the script
 *      creates both accounts, admin pays) or follow the printed Squads app procedure (TX Builder →
 *      import the printed base58 transaction). With APPROVER_KEYPAIRS each approver that hasn't
 *      voted yet approves, and once the threshold is met the first approver executes the vault
 *      transaction (admin pays the fees); otherwise members approve and execute in the Squads app.
 *      The vault is topped up to the rent-exempt minimum first so small fee sweeps to it cannot fail.
 *   4. Upgrade authority → vault via the BPF upgradeable loader `SetAuthority` (no CLI needed).
 *   5. Verification table: platform admin / pending admin / fee recipient / upgrade authority must
 *      all point at the vault. Exits 1 while anything is still FAIL (e.g. proposal not executed yet).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, PROGRAM_ID, type MoshClient } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, ROOT, RPC_URL, clientFor, loadOrCreateKeypair, send } from "./common";

const DRY_RUN = process.argv.includes("--dry-run");
const CREATE_KEY = "multisig-create-key";
const CONFIG_FILE = path.join(LOCALNET_DIR, "config.json");
const SQUADS_APP: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "https://app.squads.so", // mainnet-beta
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "https://devnet.squads.so", // devnet
};
const PROGRAM_DATA = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)[0];
const { Multisig, Proposal, VaultTransaction, ProgramConfig } = multisig.accounts;
type MultisigAccount = multisig.accounts.Multisig;

function fail(problem: string): never {
  console.error(`\n✗ handoff: ${problem}\n`);
  process.exit(1);
}

const done = (step: string, what: string) => console.log(`✓ ${step}: ${what}`);
const todo = (step: string, what: string) => console.log(`${DRY_RUN ? "→" : "…"} ${step}: ${DRY_RUN ? "would " : ""}${what}`);

function readKeypair(file: string): Keypair {
  if (!fs.existsSync(file)) fail(`missing keypair ${file}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

function readConfig(): Record<string, unknown> {
  return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
}

function parseMembers(): PublicKey[] {
  const raw = (process.env.MEMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) fail("set MEMBERS to the comma-separated member pubkeys");
  const members = raw.map((s) => {
    try {
      return new PublicKey(s);
    } catch {
      fail(`MEMBERS entry "${s}" is not a valid pubkey`);
    }
  });
  if (new Set(members.map((m) => m.toBase58())).size !== members.length) fail("MEMBERS contains duplicates");
  return members;
}

function parseThreshold(memberCount: number): number {
  const t = Number(process.env.THRESHOLD);
  if (!Number.isInteger(t) || t < 1 || t > memberCount) fail(`THRESHOLD must be an integer in 1..${memberCount}`);
  return t;
}

/** Everything that must hold before the vault of `ms` may receive any authority. */
function multisigProblems(ms: MultisigAccount, members: PublicKey[], threshold: number): string[] {
  const problems: string[] = [];
  const onChain = new Set(ms.members.map((m) => m.key.toBase58()));
  const wanted = new Set(members.map((m) => m.toBase58()));
  if (onChain.size !== wanted.size || [...wanted].some((k) => !onChain.has(k))) {
    problems.push(`members on chain [${[...onChain].join(", ")}] ≠ MEMBERS`);
  }
  if (ms.threshold !== threshold) problems.push(`threshold on chain ${ms.threshold} ≠ THRESHOLD ${threshold}`);
  if (!ms.configAuthority.equals(PublicKey.default)) {
    problems.push(`config authority ${ms.configAuthority.toBase58()} could change members unilaterally`);
  }
  const full = multisig.types.Permissions.all().mask;
  for (const m of ms.members) {
    if (m.permissions.mask !== full) problems.push(`member ${m.key.toBase58()} lacks full permissions`);
  }
  return problems;
}

async function upgradeAuthority(connection: Connection): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(PROGRAM_DATA);
  if (!info || !info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || info.data.readUInt32LE(0) !== 3) {
    fail(`program ${PROGRAM_ID.toBase58()} has no ProgramData account on this cluster`);
  }
  // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
  return info.data[12] === 1 ? new PublicKey(info.data.subarray(13, 45)) : null;
}

/** BPF upgradeable loader `SetAuthority` (instruction 4); the new authority does not sign. */
function setUpgradeAuthorityIx(current: PublicKey, vault: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(4, 0);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: PROGRAM_DATA, isSigner: false, isWritable: true },
      { pubkey: current, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
    ],
    data,
  });
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

async function main() {
  const members = parseMembers();
  const threshold = parseThreshold(members.length);
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client: MoshClient = clientFor(connection, admin);
  const squadsApp = SQUADS_APP[await connection.getGenesisHash()];

  // RPC URLs can carry API keys (Helius): only show the host.
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent or written\n" : ""}rpc ${new URL(RPC_URL).host}`);
  console.log(`program ${PROGRAM_ID.toBase58()}, admin ${admin.publicKey.toBase58()}`);
  console.log(`members ${members.map((m) => m.toBase58()).join(", ")} (threshold ${threshold})\n`);

  const platform = await client.fetchPlatform();
  if (!platform) fail(`platform not initialized for program ${PROGRAM_ID.toBase58()} on this cluster`);

  // ---- 1. multisig ----
  const createKeyFile = path.join(LOCALNET_DIR, `${CREATE_KEY}.json`);
  const recorded = readConfig().multisig as string | undefined;
  let createKey: Keypair | null = null;
  let multisigPda: PublicKey | null = null;
  if (process.env.MULTISIG) {
    multisigPda = new PublicKey(process.env.MULTISIG);
  } else if (fs.existsSync(createKeyFile) || !DRY_RUN) {
    createKey = loadOrCreateKeypair(CREATE_KEY);
    multisigPda = multisig.getMultisigPda({ createKey: createKey.publicKey })[0];
  } else if (recorded) {
    fail(`config.json records multisig ${recorded} but ${createKeyFile} is missing; set MULTISIG=${recorded}`);
  }
  if (recorded && multisigPda && recorded !== multisigPda.toBase58()) {
    fail(`config.json records multisig ${recorded}, but this run resolves to ${multisigPda.toBase58()}`);
  }

  let ms = multisigPda ? await Multisig.fromAccountAddress(connection, multisigPda).catch(() => null) : null;
  if (ms) {
    done("1 multisig", `${multisigPda!.toBase58()} exists`);
  } else if (process.env.MULTISIG) {
    fail(`MULTISIG ${process.env.MULTISIG} is not a Squads v4 multisig on this cluster`);
  } else {
    const [programConfigPda] = multisig.getProgramConfigPda({});
    const programConfig = await ProgramConfig.fromAccountAddress(connection, programConfigPda);
    const fee = `creation fee ${Number(programConfig.multisigCreationFee.toString()) / 1e9} SOL`;
    if (DRY_RUN || !createKey) {
      const target = createKey ? multisigPda!.toBase58() : "with a new create key";
      todo("1 multisig", `create ${threshold}-of-${members.length} Squads multisig ${target} (${fee})`);
    } else {
      todo("1 multisig", `creating ${multisigPda!.toBase58()} (${fee})`);
      const ix = multisig.instructions.multisigCreateV2({
        treasury: programConfig.treasury,
        creator: admin.publicKey,
        multisigPda: multisigPda!,
        configAuthority: null,
        threshold,
        members: members.map((key) => ({ key, permissions: multisig.types.Permissions.all() })),
        timeLock: 0,
        createKey: createKey.publicKey,
        rentCollector: null,
      });
      console.log(`   tx ${await send(client, admin, [ix], [createKey])}`);
      ms = await Multisig.fromAccountAddress(connection, multisigPda!);
    }
  }

  if (ms) {
    const problems = multisigProblems(ms, members, threshold);
    if (problems.length) fail(`multisig ${multisigPda!.toBase58()} does not match:\n  - ${problems.join("\n  - ")}`);
  }
  // Only ever derived from a multisig that exists on chain and passed the checks above.
  const vault = ms ? multisig.getVaultPda({ multisigPda: multisigPda!, index: 0 })[0] : null;
  const vaultLabel = vault?.toBase58() ?? "<new vault>";
  if (vault) {
    console.log(`   vault (index 0) ${vault.toBase58()}`);
    if (!DRY_RUN) {
      const config = { ...readConfig(), multisig: multisigPda!.toBase58(), multisigVault: vault.toBase58() };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
  }
  const squadsUrl = squadsApp && multisigPda ? `${squadsApp}/squads/${multisigPda.toBase58()}/transactions` : null;

  // ---- 2. propose_admin ----
  if (vault && platform.admin.equals(vault)) {
    done("2 propose_admin", "vault is already the platform admin");
  } else if (vault && platform.pendingAdmin.equals(vault)) {
    done("2 propose_admin", "vault is already the pending admin");
  } else if (!platform.admin.equals(admin.publicKey)) {
    fail(`platform admin is ${platform.admin.toBase58()}, not ${admin.publicKey.toBase58()} from ${LOCALNET_DIR}`);
  } else if (DRY_RUN || !vault) {
    todo("2 propose_admin", `propose_admin(${vaultLabel}) signed by the admin`);
  } else {
    todo("2 propose_admin", `propose_admin(${vault.toBase58()})`);
    console.log(`   tx ${await send(client, admin, [await client.proposeAdminIx(admin.publicKey, vault)])}`);
  }

  // ---- 3. vault transaction [accept_admin, set_fee_recipient(vault)] ----
  const adminDone = vault !== null && platform.admin.equals(vault);
  const feeDone = vault !== null && platform.feeRecipient.equals(vault);
  if (adminDone && feeDone) {
    done("3 accept_admin + set_fee_recipient", "vault is admin and fee recipient");
  } else if (!vault || !ms) {
    todo("3 accept_admin + set_fee_recipient", `have a member propose vault tx [accept_admin, set_fee_recipient(${vaultLabel})]`);
  } else {
    const ixs = [
      ...(adminDone ? [] : [await client.acceptAdminIx(vault)]),
      await client.setFeeRecipientIx(vault, vault),
    ];
    const step = `3 ${adminDone ? "" : "accept_admin + "}set_fee_recipient`;

    const rentMin = await connection.getMinimumBalanceForRentExemption(0);
    const vaultBalance = await connection.getBalance(vault);
    if (vaultBalance >= rentMin) {
      done(step, `vault holds ≥ rent-exempt minimum (${vaultBalance} lamports)`);
    } else if (DRY_RUN) {
      todo(step, `top up the vault to the rent-exempt minimum (${rentMin - vaultBalance} lamports)`);
    } else {
      const ix = SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: vault, lamports: rentMin - vaultBalance });
      console.log(`… ${step}: vault rent top-up tx ${await send(client, admin, [ix])}`);
    }

    const pending = await findPendingVaultTx(connection, multisigPda!, ms, ixs);
    const approvers = (process.env.APPROVER_KEYPAIRS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((file) => readKeypair(path.resolve(ROOT, file)));
    const proposerFile = process.env.PROPOSER_KEYPAIR;
    const proposer = proposerFile ? readKeypair(path.resolve(ROOT, proposerFile)) : (approvers[0] ?? null);
    for (const kp of proposer ? [proposer, ...approvers] : approvers) {
      if (!members.some((m) => m.equals(kp.publicKey))) {
        fail(`${kp.publicKey.toBase58()} (PROPOSER_KEYPAIR/APPROVER_KEYPAIRS) is not one of MEMBERS`);
      }
    }

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
          multisigPda: multisigPda!,
          creator: proposer.publicKey,
          rentPayer: admin.publicKey,
          transactionIndex: pending.index,
        });
        todo(step, `creating proposal for vault tx #${pending.index}`);
        console.log(`   tx ${await send(client, admin, [ix], [proposer])}`);
        live = pending.index;
      }
    } else if (DRY_RUN || !proposer) {
      todo(step, `create vault tx + proposal [${adminDone ? "" : "accept_admin, "}set_fee_recipient(${vault.toBase58()})]`);
      if (!proposer) printManualProcedure(ixs, vault, (await connection.getLatestBlockhash()).blockhash);
    } else {
      const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
      const { blockhash } = await connection.getLatestBlockhash();
      const create = multisig.instructions.vaultTransactionCreate({
        multisigPda: multisigPda!,
        transactionIndex,
        creator: proposer.publicKey,
        rentPayer: admin.publicKey,
        vaultIndex: 0,
        ephemeralSigners: 0,
        transactionMessage: new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: ixs }),
      });
      const propose = multisig.instructions.proposalCreate({
        multisigPda: multisigPda!,
        creator: proposer.publicKey,
        rentPayer: admin.publicKey,
        transactionIndex,
      });
      todo(step, `creating vault tx #${transactionIndex} + proposal (creator ${proposer.publicKey.toBase58()})`);
      console.log(`   tx ${await send(client, admin, [create, propose], [proposer])}`);
      live = transactionIndex;
    }

    const squadsHint = squadsUrl ?? multisigPda!.toBase58();
    if (approvers.length === 0) {
      console.log(`   members approve + execute ${live === null ? "it" : `vault tx #${live}`}: ${squadsHint}`);
    } else if (live === null) {
      todo(step, `approve the new vault tx as ${approvers.length} APPROVER_KEYPAIRS and execute it`);
    } else {
      const [proposalPda] = multisig.getProposalPda({ multisigPda: multisigPda!, transactionIndex: live });
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
          const ix = multisig.instructions.proposalApprove({ multisigPda: multisigPda!, transactionIndex: live, member: approver.publicKey });
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
          multisigPda: multisigPda!,
          transactionIndex: live,
          member: executor.publicKey,
        });
        todo(step, `executing vault tx #${live} as ${executor.publicKey.toBase58()}`);
        console.log(`   tx ${await send(client, admin, [instruction], [executor])}`);
      } else {
        console.log(`   proposal #${live} is ${status} — remaining members approve + execute: ${squadsHint}`);
      }
    }
  }

  // ---- 4. upgrade authority ----
  const authority = await upgradeAuthority(connection);
  if (!authority) {
    fail(`program ${PROGRAM_ID.toBase58()} is immutable (no upgrade authority)`);
  } else if (vault && authority.equals(vault)) {
    done("4 upgrade authority", "already the vault");
  } else if (!authority.equals(admin.publicKey)) {
    fail(`upgrade authority is ${authority.toBase58()}, not the admin ${admin.publicKey.toBase58()}`);
  } else if (DRY_RUN || !vault) {
    todo("4 upgrade authority", `SetAuthority ${PROGRAM_DATA.toBase58()}: ${authority.toBase58()} → ${vaultLabel}`);
  } else {
    todo("4 upgrade authority", `SetAuthority → ${vault.toBase58()}`);
    console.log(`   tx ${await send(client, admin, [setUpgradeAuthorityIx(admin.publicKey, vault)])}`);
  }

  // ---- 5. verification ----
  const now = (await client.fetchPlatform())!;
  const nowAuthority = await upgradeAuthority(connection);
  const is = (actual: PublicKey | null, expected: PublicKey | null) => !!actual && !!expected && actual.equals(expected);
  const rows: [string, string, boolean][] = [
    ["multisig", ms ? `${multisigPda!.toBase58()} (${ms.threshold}-of-${ms.members.length})` : "missing", ms !== null],
    ["platform.admin", now.admin.toBase58(), is(now.admin, vault)],
    ["platform.pending_admin", now.pendingAdmin.equals(PublicKey.default) ? "none" : now.pendingAdmin.toBase58(), now.pendingAdmin.equals(PublicKey.default)],
    ["platform.fee_recipient", now.feeRecipient.toBase58(), is(now.feeRecipient, vault)],
    ["upgrade authority", nowAuthority?.toBase58() ?? "none (immutable)", is(nowAuthority, vault)],
  ];
  console.log(`\n5 verification (expected: vault ${vaultLabel})`);
  for (const [label, value, ok] of rows) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(24)} ${value}`);
  if (squadsUrl) console.log(`\nSquads app: ${squadsUrl}`);
  if (rows.some(([, , ok]) => !ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
