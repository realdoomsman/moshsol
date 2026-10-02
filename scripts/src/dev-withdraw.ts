/**
 * `dev_withdraw_vault` with the platform's single dev key (`platform.dev_authority`, set by the admin
 * multisig with `set_dev_authority`): moves vault SOL and/or vault tokens of one launch straight to the
 * dev key's own wallet and its ATA for the mint, in one transaction the dev key signs and pays — no
 * multisig, not blocked by `paused` / `agents_paused`. Every withdrawal emits `VaultWithdrawnByDev` and is
 * shown on the launch page (README "Developer access").
 *
 *   RPC_URL=<rpc> DEV_KEYPAIR=.mainnet/dev.json LAUNCH=<launch address or mint> SOL=all TOKENS=all \
 *     pnpm vault:dev-withdraw --dry-run
 *
 * DEV_KEYPAIR: the dev key file, relative to the repo root (default `$KEYS_DIR/dev.json`). LAUNCH: the launch
 * account address or its mint. SOL: a decimal SOL amount or `all`; TOKENS: whole tokens or `all` (default 0
 * each, at least one non-zero). The dev key's ATA (SPL Token on pump launches, Token-2022 on Holdfast
 * launches) is created idempotently in the same transaction; the dev key pays its rent (~0.002 SOL) and
 * the fee, so it needs a little SOL. `--dry-run` prints the plan and simulates the transaction; nothing
 * is sent.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_PRIORITY_FEE,
  PROGRAM_ID,
  createLaunchAtaIx,
  describeError,
  lamportsToSol,
  prepareTx,
  splAta,
  tokenAta,
  tokensToUi,
} from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, ROOT, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readKeypair, todo } from "./squads";
import { loadLaunch, withdrawAmounts } from "./vault";

/** Fee + the dev ATA's rent, with room: below this the transaction can't pay for itself. */
const MIN_DEV_BALANCE = 3_000_000;

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const devFile = process.env.DEV_KEYPAIR ? path.resolve(ROOT, process.env.DEV_KEYPAIR) : path.join(LOCALNET_DIR, "dev.json");
  const dev = readKeypair(devFile);
  const client = clientFor(connection, dev);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);
  const balance = await connection.getBalance(dev.publicKey);
  console.log(`dev key ${dev.publicKey.toBase58()} (${path.relative(ROOT, devFile)}): ${lamportsToSol(BigInt(balance))} SOL`);

  const platform = await client.fetchPlatform().catch(() => null);
  if (!platform) fail("the platform is not initialized or not in the current layout on this cluster (upgrade + `pnpm migrate:launches` first)");
  if (platform.devAuthority.equals(PublicKey.default)) {
    fail("the platform has no dev key: set it from the admin with `DEV_AUTHORITY=<pubkey> pnpm migrate:launches` (set_dev_authority)");
  }
  if (!platform.devAuthority.equals(dev.publicKey)) fail(`the platform's dev key is ${platform.devAuthority.toBase58()}, not ${dev.publicKey.toBase58()}`);

  const launch = await loadLaunch(connection, client);
  const launchKey = new PublicKey(launch.address);
  const { vaultSol, vaultTokens, sol, tokens } = withdrawAmounts(launch);
  const mint = new PublicKey(launch.mint);
  const devTokens = launch.venue === "pump" ? splAta(dev.publicKey, mint) : tokenAta(dev.publicKey, mint);
  console.log(
    `launch ${launchKey.toBase58()} ${launch.symbol || ""} (${launch.status}, ${launch.venue}): vault ${lamportsToSol(vaultSol)} SOL + ${tokensToUi(vaultTokens)} tokens`,
  );
  console.log(`withdraw ${lamportsToSol(sol)} SOL → ${dev.publicKey.toBase58()}, ${tokensToUi(tokens)} tokens → ${devTokens.toBase58()}`);
  if (balance < MIN_DEV_BALANCE) {
    (DRY_RUN ? todo : fail)("dev key", `fund ${dev.publicKey.toBase58()} with ~0.01 SOL first (fee + its token account's rent)`);
  }

  const ixs = [
    createLaunchAtaIx(dev.publicKey, dev.publicKey, mint, launch.venue),
    await client.devWithdrawVaultIx(dev.publicKey, launch, sol, tokens),
  ];
  const label = `create-idempotent ${devTokens.toBase58()} + dev_withdraw_vault(${lamportsToSol(sol)} SOL, ${tokensToUi(tokens)} tokens) on ${launch.symbol || launchKey.toBase58()}`;
  if (DRY_RUN) {
    todo("withdraw", `send [${label}] signed by the dev key`);
    try {
      const { unitsConsumed } = await prepareTx(connection, dev.publicKey, ixs, DEFAULT_PRIORITY_FEE);
      done("simulation", `ok, ${unitsConsumed} CU`);
    } catch (e) {
      console.log(`✗ simulation: ${describeError(e)}`);
    }
    return;
  }
  todo("withdraw", `sending [${label}]`);
  console.log(`   tx ${await send(client, dev, ixs)}`);
  const after = await client.program.account.launch.fetch(launchKey);
  const left = { sol: BigInt(after.vaultSol.toString()), tokens: BigInt(after.vaultTokens.toString()) };
  const ok = left.sol === vaultSol - sol && left.tokens === vaultTokens - tokens;
  console.log(`\n${ok ? "PASS" : "FAIL"}  vault now ${lamportsToSol(left.sol)} SOL + ${tokensToUi(left.tokens)} tokens`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
