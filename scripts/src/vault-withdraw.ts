/**
 * `admin_withdraw_vault` through the platform admin: moves vault SOL and/or vault tokens of one launch
 * to `platform.fee_recipient` (on mainnet both admin and fee recipient are the Squads vault, so the
 * withdrawal is a vault transaction proposed, approved and executed like an upgrade; on a cluster whose
 * platform admin is the local admin key the instruction is sent directly). Every withdrawal emits
 * `VaultWithdrawn` and is shown on the launch page (README "Developer access").
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json \
 *     LAUNCH=<launch address> SOL=all TOKENS=all pnpm --filter @holdfast/scripts vault-withdraw --dry-run
 *
 * LAUNCH: the launch account address. SOL: lamports to withdraw as a decimal SOL amount, or `all`
 * (default 0). TOKENS: whole tokens, or `all` (default 0). At least one must be non-zero. The fee
 * recipient's token account (its ATA under the launch's token program) is created by the admin key if
 * it is missing. Env otherwise as `pnpm upgrade` (KEYS_DIR — admin.json pays fees, config.json names the
 * multisig — MULTISIG, PROPOSER_KEYPAIR / APPROVER_KEYPAIRS). `--dry-run` only prints the plan.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import {
  PROGRAM_ID,
  createLaunchAtaIx,
  launchToJson,
  lamportsToSol,
  solToLamports,
  splAta,
  tokenAta,
  tokensToUi,
  uiToTokens,
  type LaunchAccount,
} from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

function amountArg(name: string, all: bigint, parse: (s: string) => bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return 0n;
  if (raw === "all") return all;
  const v = parse(raw);
  if (v > all) fail(`${name}=${raw} exceeds what the vault holds (${all} base units)`);
  return v;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);

  if (!process.env.LAUNCH) fail("set LAUNCH=<launch address>");
  const launchKey = new PublicKey(process.env.LAUNCH);
  const info = await connection.getAccountInfo(launchKey);
  if (!info || !info.owner.equals(PROGRAM_ID)) fail(`${launchKey.toBase58()} is not a launch of ${PROGRAM_ID.toBase58()} on this cluster`);
  let account: LaunchAccount;
  try {
    account = client.program.coder.accounts.decode<LaunchAccount>("launch", info.data);
  } catch {
    fail(`${launchKey.toBase58()} is not in the current layout; run \`pnpm migrate:launches\` first`);
  }
  const launch = launchToJson(launchKey, account);
  const platform = await client.fetchPlatform();
  if (!platform) fail("the platform is not initialized on this cluster");

  const vaultSol = BigInt(launch.vaultSol);
  const vaultTokens = BigInt(launch.vaultTokens);
  const sol = amountArg("SOL", vaultSol, solToLamports);
  const tokens = amountArg("TOKENS", vaultTokens, uiToTokens);
  if (sol === 0n && tokens === 0n) fail("nothing to withdraw: set SOL and/or TOKENS (a decimal amount or `all`)");

  const pump = launch.venue === "pump";
  const mint = new PublicKey(launch.mint);
  const recipient = platform.feeRecipient;
  const recipientTokens = pump ? splAta(recipient, mint) : tokenAta(recipient, mint);
  console.log(
    `launch ${launchKey.toBase58()} ${launch.symbol || ""} (${launch.status}, ${launch.venue}): vault ${lamportsToSol(vaultSol)} SOL + ${tokensToUi(vaultTokens)} tokens`,
  );
  console.log(`withdraw ${lamportsToSol(sol)} SOL + ${tokensToUi(tokens)} tokens → fee recipient ${recipient.toBase58()} (tokens to ${recipientTokens.toBase58()})`);

  // The recipient's token account must exist; creating an ATA is permissionless, the admin key pays its rent.
  if (tokens > 0n && !(await connection.getAccountInfo(recipientTokens))) {
    const create = createLaunchAtaIx(admin.publicKey, recipient, mint, launch.venue);
    if (DRY_RUN) todo("withdraw", `create the fee recipient's token account ${recipientTokens.toBase58()}`);
    else {
      todo("withdraw", `creating the fee recipient's token account ${recipientTokens.toBase58()}`);
      console.log(`   tx ${await send(client, admin, [create])}`);
    }
  }

  const ixs = [await client.adminWithdrawVaultIx(platform.admin, launch, sol, tokens, recipientTokens)];
  const label = `admin_withdraw_vault(${lamportsToSol(sol)} SOL, ${tokensToUi(tokens)} tokens) on ${launch.symbol || launchKey.toBase58()}`;

  if (platform.admin.equals(admin.publicKey)) {
    if (DRY_RUN) return todo("withdraw", `send [${label}] as the admin`);
    todo("withdraw", `sending [${label}] as the admin`);
    console.log(`   tx ${await send(client, admin, ixs)}`);
    return done("withdraw", "vault withdrawn");
  }

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
    "withdraw",
    label,
    ixs,
  );
  if (DRY_RUN) return;
  const after = await client.program.account.launch.fetch(launchKey);
  const left = { sol: BigInt(after.vaultSol.toString()), tokens: BigInt(after.vaultTokens.toString()) };
  const executed = left.sol === vaultSol - sol && left.tokens === vaultTokens - tokens;
  console.log(`\n${executed ? "PASS" : "FAIL"}  vault now ${lamportsToSol(left.sol)} SOL + ${tokensToUi(left.tokens)} tokens${executed ? "" : " (proposal not executed yet?)"}`);
  if (!executed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
