/**
 * `update_platform` through the platform admin with only the named numeric params changed (every other param,
 * the buyback mint included, is re-sent as it is on-chain). New launches freeze the platform terms at creation,
 * so live launches keep theirs. On mainnet the admin is the Squads vault: a vault transaction proposed, approved
 * and executed like an upgrade; on a cluster whose admin is the local admin key it is sent directly.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json \
 *     pnpm --filter @holdfast/scripts exec tsx src/set-params.ts agentWindowSecs=300 agentSellBpsPerWindow=2000 --dry-run
 *
 * Env otherwise as `pnpm upgrade` (KEYS_DIR, MULTISIG, PROPOSER_KEYPAIR / APPROVER_KEYPAIRS). `--dry-run` prints the
 * current and next values and sends nothing.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";
import { PROGRAM_ID, type PlatformParams } from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

async function main() {
  const assignments = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!assignments.length) fail("name at least one param, e.g. agentWindowSecs=300");

  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);

  const platform = await client.fetchPlatform();
  if (!platform) fail("the platform is not initialized on this cluster");
  const current = platform.params;
  const next: PlatformParams = { ...current };
  const changes: string[] = [];
  for (const a of assignments) {
    const [key, value] = a.split("=");
    if (!(key in current)) fail(`unknown param "${key}" (known: ${Object.keys(current).join(", ")})`);
    const k = key as keyof PlatformParams;
    const old = current[k];
    if (typeof old === "boolean") {
      if (value !== "true" && value !== "false") fail(`${key} must be true or false`);
      (next as Record<string, unknown>)[k] = value === "true";
    } else if (typeof old === "number") {
      if (!/^\d+$/.test(value ?? "")) fail(`${key} must be a non-negative integer`);
      (next as Record<string, unknown>)[k] = Number(value);
    } else if (BN.isBN(old)) {
      if (!/^\d+$/.test(value ?? "")) fail(`${key} must be a non-negative integer (base units)`);
      (next as Record<string, unknown>)[k] = new BN(value);
    } else {
      fail(`${key} is not a numeric/boolean param${old instanceof PublicKey ? " (use set-buyback-mint for the mint)" : ""}`);
    }
    changes.push(`${key} ${String(old)} → ${String(next[k])}`);
  }
  for (const c of changes) console.log(`  ${c}`);
  if (assignments.every((a) => String(current[a.split("=")[0] as keyof PlatformParams]) === a.split("=")[1])) {
    return done("params", "already set");
  }

  const ixs = [await client.updatePlatformIx(platform.admin, next)];
  const label = `update_platform(${changes.join(", ")}, other params unchanged)`;

  if (platform.admin.equals(admin.publicKey)) {
    if (DRY_RUN) return todo("params", `send [${label}] as the admin`);
    todo("params", `sending [${label}] as the admin`);
    console.log(`   tx ${await send(client, admin, ixs)}`);
  } else {
    const config = readConfig();
    const multisigAddress = process.env.MULTISIG ?? (config.multisig as string | undefined);
    if (!multisigAddress) fail(`platform admin ${platform.admin.toBase58()} is not the local admin and no multisig is known (set MULTISIG or run \`pnpm handoff\`)`);
    const multisigPda = new PublicKey(multisigAddress);
    const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda).catch(() => null);
    if (!ms) fail(`${multisigPda.toBase58()} is not a Squads v4 multisig on this cluster`);
    const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
    if (!vault.equals(platform.admin)) fail(`platform admin is ${platform.admin.toBase58()}, not the multisig vault ${vault.toBase58()}`);
    console.log(`multisig ${multisigPda.toBase58()} (${ms.threshold}-of-${ms.members.length}), vault ${vault.toBase58()}\n`);
    const hint = (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58();
    await runVaultTransaction(
      { connection, client, admin, multisigPda, ms, vault, signers: readVaultSigners(ms), squadsHint: hint },
      "params",
      label,
      ixs,
    );
    if (DRY_RUN) return;
  }
  const after = await client.fetchPlatform();
  const bad = assignments.filter((a) => String(after?.params[a.split("=")[0] as keyof PlatformParams]) !== a.split("=")[1]);
  console.log(`\n${bad.length ? "FAIL" : "PASS"}  ${bad.length ? `not applied yet: ${bad.join(", ")} (proposal not executed?)` : "params updated"}`);
  if (bad.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
