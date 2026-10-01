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
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { PROGRAM_ID, type MoshClient } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, loadOrCreateKeypair, send } from "./common";
import { PROGRAM_DATA, fetchProgramData, setAuthorityIx } from "./loader";
import {
  CONFIG_FILE,
  DRY_RUN,
  done,
  fail,
  readConfig,
  readKeypair,
  readVaultSigners,
  runVaultTransaction,
  squadsUrl as squadsAppUrl,
  todo,
  type MultisigAccount,
} from "./squads";

const CREATE_KEY = "multisig-create-key";
const { Multisig, ProgramConfig } = multisig.accounts;

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

async function main() {
  const members = parseMembers();
  const threshold = parseThreshold(members.length);
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client: MoshClient = clientFor(connection, admin);

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
  const squadsUrl = multisigPda ? await squadsAppUrl(connection, multisigPda) : null;

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

    await runVaultTransaction(
      { connection, client, admin, multisigPda: multisigPda!, ms, vault, signers: readVaultSigners(ms), squadsHint: squadsUrl ?? multisigPda!.toBase58() },
      step,
      `${adminDone ? "" : "accept_admin, "}set_fee_recipient(${vault.toBase58()})`,
      ixs,
    );
  }

  // ---- 4. upgrade authority ----
  const programData = await fetchProgramData(connection);
  if (!programData) fail(`program ${PROGRAM_ID.toBase58()} has no ProgramData account on this cluster`);
  const authority = programData.authority;
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
    console.log(`   tx ${await send(client, admin, [setAuthorityIx(PROGRAM_DATA, admin.publicKey, vault)])}`);
  }

  // ---- 5. verification ----
  const now = (await client.fetchPlatform())!;
  const nowAuthority = (await fetchProgramData(connection))?.authority ?? null;
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
