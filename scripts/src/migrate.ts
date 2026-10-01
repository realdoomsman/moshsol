/**
 * Layout migration after the pump.fun upgrade (README "Layout migration"): one `migrate_platform` plus
 * one `migrate_launch` per launch still in the old layout, all in one Squads vault transaction signed
 * by the platform admin (the multisig vault). Idempotent: already-migrated accounts are skipped (the
 * program's own `AlreadyMigrated` check is mirrored on the account size), a pending vault transaction
 * with exactly the remaining instructions is reused, and nothing is sent once everything is migrated.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json pnpm migrate:launches --dry-run
 *
 * Env: as `pnpm upgrade` (RPC_URL, KEYS_DIR — admin.json pays rent and fees, config.json names the
 * multisig — MULTISIG, PROPOSER_KEYPAIR / APPROVER_KEYPAIRS). `--dry-run` only prints the plan.
 * When the platform admin is not a multisig (localnet), the admin keypair signs and sends directly.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { PROGRAM_ID, platformPda } from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

/** Account sizes (with discriminator) before the pump upgrade: `8 + PlatformV1/LaunchV1::INIT_SPACE`. */
const OLD_PLATFORM_LEN = 213;
const OLD_LAUNCH_LEN = 468;

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);

  const platform = platformPda();
  const platformInfo = await connection.getAccountInfo(platform);
  if (!platformInfo) fail("the platform is not initialized on this cluster");
  // The admin that signs the migration (`platform.admin` sits right after the discriminator in both layouts).
  const platformAdmin = new PublicKey(platformInfo.data.subarray(8, 40));
  const launchDiscriminator = client.program.coder.accounts.memcmp("launch").bytes as string;
  const launches = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: launchDiscriminator } }],
  });
  const oldLaunches = launches.filter((l) => l.account.data.length === OLD_LAUNCH_LEN).map((l) => l.pubkey);
  const platformOld = platformInfo.data.length === OLD_PLATFORM_LEN;

  console.log(`platform ${platform.toBase58()}: ${platformOld ? "old layout" : "migrated"}, admin ${platformAdmin.toBase58()}`);
  console.log(`launches: ${launches.length}, in the old layout: ${oldLaunches.length}${oldLaunches.length ? ` (${oldLaunches.map((k) => k.toBase58()).join(", ")})` : ""}`);
  if (!platformOld && oldLaunches.length === 0) return done("migrate", "nothing left to migrate");

  const ixs = [
    ...(platformOld ? [await client.migratePlatformIx(platformAdmin)] : []),
    ...(await Promise.all(oldLaunches.map((launch) => client.migrateLaunchIx(platformAdmin, launch)))),
  ];
  const label = `${platformOld ? "migrate_platform + " : ""}migrate_launch × ${oldLaunches.length}`;

  if (platformAdmin.equals(admin.publicKey)) {
    if (DRY_RUN) return todo("migrate", `send [${label}] as the admin`);
    todo("migrate", `sending [${label}] as the admin`);
    console.log(`   tx ${await send(client, admin, ixs)}`);
    return done("migrate", "all accounts are in the current layout");
  }

  const config = readConfig();
  const multisigAddress = process.env.MULTISIG ?? (config.multisig as string | undefined);
  if (!multisigAddress) fail(`platform admin ${platformAdmin.toBase58()} is not the local admin and no multisig is known (set MULTISIG or run \`pnpm handoff\`)`);
  const multisigPda = new PublicKey(multisigAddress);
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda).catch(() => null);
  if (!ms) fail(`${multisigPda.toBase58()} is not a Squads v4 multisig on this cluster`);
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  if (!vault.equals(platformAdmin)) fail(`platform admin is ${platformAdmin.toBase58()}, not the multisig vault ${vault.toBase58()}`);
  console.log(`multisig ${multisigPda.toBase58()} (${ms.threshold}-of-${ms.members.length}), vault ${vault.toBase58()}\n`);

  const hint = (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58();
  await runVaultTransaction(
    { connection, client, admin, multisigPda, ms, vault, signers: readVaultSigners(ms), squadsHint: hint },
    "migrate",
    label,
    ixs,
  );
  if (DRY_RUN) return;
  const after = await connection.getAccountInfo(platform);
  const migrated = after !== null && after.data.length !== OLD_PLATFORM_LEN;
  console.log(`\n${migrated ? "PASS" : "FAIL"}  platform layout ${migrated ? "current" : "still old (proposal not executed yet?)"}`);
  if (!migrated) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
