/**
 * `update_platform` through the platform admin with only `buyback_mint` changed: the Holdfast token every
 * pump launch's buyback pool buys and burns (`buyback_burn`). On mainnet the admin is the Squads vault, so
 * this is a vault transaction proposed, approved and executed like an upgrade; on a cluster whose platform
 * admin is the local admin key the instruction is sent directly.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json \
 *     BUYBACK_MINT=<mint> pnpm set-buyback-mint --dry-run
 *
 * Env otherwise as `pnpm upgrade` (KEYS_DIR — admin.json pays fees, config.json names the multisig —
 * MULTISIG, PROPOSER_KEYPAIR / APPROVER_KEYPAIRS). `--dry-run` prints the current and next value and
 * sends nothing. The mint may be a Holdfast pump launch's own mint: that launch's pool then buys its own
 * token, which needs a program at or after build ae04463e (burns only the fill, never its vault).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { PROGRAM_ID } from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

async function main() {
  const raw = process.env.BUYBACK_MINT?.trim();
  if (!raw) fail("BUYBACK_MINT is required");
  let next: PublicKey;
  try {
    next = new PublicKey(raw);
  } catch {
    fail(`BUYBACK_MINT ${raw} is not a public key`);
  }
  if (next.equals(PublicKey.default)) fail("BUYBACK_MINT must not be the unset default");

  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);

  const platform = await client.fetchPlatform();
  if (!platform) fail("the platform is not initialized on this cluster");
  const current = platform.params.buybackMint;
  console.log(`buyback_mint current ${current.toBase58()}${current.equals(PublicKey.default) ? " (unset)" : ""}`);
  console.log(`buyback_mint next    ${next.toBase58()}`);

  const mintInfo = await connection.getAccountInfo(next, "confirmed");
  if (!mintInfo) fail(`${next.toBase58()} does not exist on this cluster`);
  console.log(`mint owner ${mintInfo.owner.toBase58()}, ${mintInfo.data.length} bytes`);
  if (current.equals(next)) return done("buyback", "buyback_mint already set to this mint");

  const ixs = [await client.updatePlatformIx(platform.admin, { ...platform.params, buybackMint: next })];
  const label = `update_platform(buyback_mint ${current.toBase58()} → ${next.toBase58()}, other params unchanged)`;

  if (platform.admin.equals(admin.publicKey)) {
    if (DRY_RUN) return todo("buyback", `send [${label}] as the admin`);
    todo("buyback", `sending [${label}] as the admin`);
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
      "buyback",
      label,
      ixs,
    );
    if (DRY_RUN) return;
  }
  const after = await client.fetchPlatform();
  const executed = !!after && after.params.buybackMint.equals(next);
  console.log(`\n${executed ? "PASS" : "FAIL"}  buyback_mint now ${after?.params.buybackMint.toBase58() ?? "?"}${executed ? "" : " (proposal not executed yet?)"}`);
  if (!executed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
