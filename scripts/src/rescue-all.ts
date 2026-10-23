/**
 * Emergency: empty EVERY launch vault (SOL + tokens) into ONE wallet, with the dev key alone.
 *
 *   pnpm rescue <wallet>          # preview: lists every vault and simulates each transfer, sends nothing
 *   pnpm rescue <wallet> --go     # does it
 *
 * Uses `.mainnet/dev.json` and the RPC in `.mainnet/config.json` (override with DEV_KEYPAIR / RPC_URL).
 * Step 1: `collect_pump_fees` on every live pump launch with pump.fun creator fees waiting (permissionless,
 * the dev key cranks it): the launch's `creatorFeeVaultBps` share becomes vault SOL, the buyback-pool and
 * backer shares stay on the launch. Step 2: one transaction per launch, signed and paid by the dev key:
 * `dev_withdraw_vault(all, all)` into the dev key, then the same SOL and tokens straight on to <wallet>
 * (its token account is created if missing). Each transaction is all-or-nothing; a failing launch is
 * reported and skipped, the rest still go.
 * The dev key pays the fees plus ~0.002 SOL rent per token account it creates (only the first sweep of a mint).
 */
import { Connection, Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { createTransferCheckedInstruction, unpackAccount } from "@solana/spl-token";
import {
  DEFAULT_PRIORITY_FEE,
  MoshClient,
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_DECIMALS,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
  ammCreatorVaultAuthorityPda,
  createLaunchAtaIx,
  creatorVaultPda,
  describeError,
  lamportsToSol,
  launchToJson,
  prepareTx,
  pumpRefOf,
  splAta,
  tokenAta,
  tokensToUi,
  type LaunchAccount,
  type LaunchJson,
} from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { ROOT, clientFor, send } from "./common";
import { fail, readKeypair } from "./squads";

const GO = process.argv.includes("--go");
/** Fee allowance per transaction (base + priority), generous. */
const TX_FEE_ALLOWANCE = 500_000n;
/** Rent of one token account the dev key creates. */
const ATA_RENT = 2_100_000n;
/** Below this a collection isn't worth its fee. */
const COLLECT_MIN_LAMPORTS = 1_000_000n;
/** A vault holding only SOL is swept once it reaches this (env `SWEEP_MIN_SOL`); smaller amounts wait for the next run. */
const SWEEP_MIN_LAMPORTS = BigInt(Math.round(Number(process.env.SWEEP_MIN_SOL ?? "0.005") * 1e9));
/** The dev key keeps this much of the withdrawn SOL (env `DEV_FLOAT_SOL`) so unattended runs never run out of fees. */
const DEV_FLOAT_LAMPORTS = BigInt(Math.round(Number(process.env.DEV_FLOAT_SOL ?? "0.02") * 1e9));

function rpcUrl(): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const config = path.join(ROOT, ".mainnet/config.json");
  if (!fs.existsSync(config)) fail("set RPC_URL (no .mainnet/config.json)");
  const parsed: unknown = JSON.parse(fs.readFileSync(config, "utf8"));
  if (parsed && typeof parsed === "object" && "rpcUrl" in parsed && typeof parsed.rpcUrl === "string") return parsed.rpcUrl;
  fail(`no rpcUrl in ${config}; set RPC_URL`);
}

/** What step 2 costs the dev key: a fee per launch plus rent for each token account that doesn't exist yet. */
async function sweepCost(connection: Connection, dev: PublicKey, to: PublicKey, full: LaunchJson[]): Promise<bigint> {
  const atas = full.flatMap((l) => {
    const mint = new PublicKey(l.mint);
    const ata = l.venue === "pump" ? splAta : tokenAta;
    return !to.equals(dev) && BigInt(l.vaultTokens) > 0n ? [ata(dev, mint), ata(to, mint)] : [ata(dev, mint)];
  });
  const missing = (await connection.getMultipleAccountsInfo(atas, "confirmed")).filter((a) => !a).length;
  return TX_FEE_ALLOWANCE * BigInt(full.length) + ATA_RENT * BigInt(missing);
}

async function allLaunches(connection: Connection, client: MoshClient): Promise<{ launches: LaunchJson[]; unreadable: string[] }> {
  const raw = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: client.program.coder.accounts.memcmp("launch").bytes as string } }],
  });
  const launches: LaunchJson[] = [];
  const unreadable: string[] = [];
  for (const { pubkey, account } of raw) {
    try {
      launches.push(launchToJson(pubkey, client.program.coder.accounts.decode<LaunchAccount>("launch", account.data)));
    } catch {
      unreadable.push(pubkey.toBase58());
    }
  }
  return { launches, unreadable };
}

function rescueIxs(
  client: MoshClient,
  dev: PublicKey,
  to: PublicKey,
  l: LaunchJson,
  sol: bigint,
  tokens: bigint,
  forward: bigint,
): Promise<TransactionInstruction[]> {
  const mint = new PublicKey(l.mint);
  const pump = l.venue === "pump";
  const ata = pump ? splAta : tokenAta;
  const ixs: TransactionInstruction[] = [createLaunchAtaIx(dev, dev, mint, l.venue)];
  return client.devWithdrawVaultIx(dev, l, sol, tokens).then((withdraw) => {
    ixs.push(withdraw);
    if (to.equals(dev)) return ixs;
    if (tokens > 0n) {
      ixs.push(createLaunchAtaIx(dev, to, mint, l.venue));
      ixs.push(
        createTransferCheckedInstruction(ata(dev, mint), mint, ata(to, mint), dev, tokens, TOKEN_DECIMALS, [], pump ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID),
      );
    }
    if (forward > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: dev, toPubkey: to, lamports: forward }));
    return ixs;
  });
}

/** Creator fees waiting in pump.fun's creator vault and, once graduated, PumpSwap's creator vault WSOL account. */
async function collectableFees(connection: Connection, l: LaunchJson, rentExemptZero: bigint): Promise<bigint> {
  const launch = new PublicKey(l.address);
  const keys = [creatorVaultPda(launch)];
  if (l.pump.graduated) keys.push(splAta(ammCreatorVaultAuthorityPda(launch), WSOL_MINT));
  const [vault, wsol] = await connection.getMultipleAccountsInfo(keys, "confirmed");
  let total = 0n;
  if (vault && BigInt(vault.lamports) > rentExemptZero) total += BigInt(vault.lamports) - rentExemptZero;
  if (wsol) total += unpackAccount(keys[1]!, wsol).amount;
  return total;
}

/** Step 1: `collect_pump_fees` on every live pump launch with fees waiting. Returns how many landed (or simulated). */
async function collectCreatorFees(client: MoshClient, dev: Keypair, launches: LaunchJson[]): Promise<number> {
  const connection = client.connection;
  const rentExemptZero = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  console.log("STEP 1  pump.fun creator fees → each launch's vault");
  let okCount = 0;
  let toVault = 0n;
  for (const l of launches.filter((x) => x.venue === "pump" && x.status === "live")) {
    const fees = await collectableFees(connection, l, rentExemptZero);
    if (fees < COLLECT_MIN_LAMPORTS) continue;
    const vaultShare = (fees * BigInt(l.terms.creatorFeeVaultBps)) / 10_000n;
    const what = `${lamportsToSol(fees)} SOL waiting, ~${lamportsToSol(vaultShare)} to the vault`;
    const name = `${(l.symbol || "?").padEnd(10)} ${l.address}`;
    try {
      const ixs = [await client.collectPumpFeesIx(dev.publicKey, pumpRefOf(l))];
      if (GO) console.log(`✓ ${name}  ${what}  tx ${await send(client, dev, ixs)}`);
      else {
        await prepareTx(connection, dev.publicKey, ixs, DEFAULT_PRIORITY_FEE);
        console.log(`✓ ${name}  ${what}  (simulation ok)`);
      }
      okCount++;
      toVault += vaultShare;
    } catch (e) {
      console.log(`✗ ${name}  ${what}  ${describeError(e)}`);
    }
  }
  console.log(okCount ? `~${lamportsToSol(toVault)} SOL of creator fees ${GO ? "added to" : "would be added to"} vaults\n` : "nothing waiting\n");
  return okCount;
}

async function main() {
  const target = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!target) fail("usage: pnpm rescue <destination wallet> [--go]");
  let to: PublicKey;
  try {
    to = new PublicKey(target);
  } catch {
    fail(`${target} is not a wallet address`);
  }

  const connection = new Connection(rpcUrl(), "confirmed");
  const dev = readKeypair(path.resolve(ROOT, process.env.DEV_KEYPAIR ?? ".mainnet/dev.json"));
  const client = clientFor(connection, dev);

  const platform = await client.fetchPlatform().catch(() => null);
  if (!platform) fail("can't read the platform account on this RPC");
  if (!platform.devAuthority.equals(dev.publicKey)) {
    fail(`this dev key (${dev.publicKey.toBase58()}) is not the platform's dev key (${platform.devAuthority.toBase58()})`);
  }

  let { launches, unreadable } = await allLaunches(connection, client);
  // Collected fees change the vaults: re-read them before sweeping.
  if ((await collectCreatorFees(client, dev, launches)) > 0 && GO) ({ launches, unreadable } = await allLaunches(connection, client));
  const full = launches.filter((l) => BigInt(l.vaultSol) >= SWEEP_MIN_LAMPORTS || BigInt(l.vaultTokens) > 0n);
  const totalSol = full.reduce((s, l) => s + BigInt(l.vaultSol), 0n);
  const balance = BigInt(await connection.getBalance(dev.publicKey));
  const needed = await sweepCost(connection, dev.publicKey, to, full);

  console.log(GO ? "SENDING FOR REAL" : "PREVIEW — nothing is sent (add --go to do it)");
  if (!GO) console.log("(step 2 shows the vaults as they are now; after step 1 they also hold the collected fees)");
  console.log("\nSTEP 2  every vault → your wallet");
  console.log(`dev key  ${dev.publicKey.toBase58()}  balance ${lamportsToSol(balance)} SOL (needs ~${lamportsToSol(needed)})`);
  console.log(`to       ${to.toBase58()}`);
  console.log(`vaults   ${full.length} with at least ${lamportsToSol(SWEEP_MIN_LAMPORTS)} SOL or any tokens, out of ${launches.length} launches, ${lamportsToSol(totalSol)} SOL total\n`);
  if (unreadable.length) console.log(`! ${unreadable.length} launch accounts in an old layout, skipped: ${unreadable.join(", ")}\n`);
  if (!full.length) return;
  if (GO && balance < needed) fail(`fund the dev key ${dev.publicKey.toBase58()} with at least ${lamportsToSol(needed - balance)} more SOL first`);

  let okCount = 0;
  const failed: string[] = [];
  // Top the dev key back up to its fee float out of the withdrawn SOL before forwarding the rest.
  let deficit = DEV_FLOAT_LAMPORTS > balance ? DEV_FLOAT_LAMPORTS - balance : 0n;
  for (const l of full) {
    const sol = BigInt(l.vaultSol);
    const tokens = BigInt(l.vaultTokens);
    const name = `${(l.symbol || "?").padEnd(10)} ${l.address}`;
    const keep = sol < deficit ? sol : deficit;
    const what = `${lamportsToSol(sol)} SOL + ${tokensToUi(tokens)} tokens${keep > 0n ? ` (${lamportsToSol(keep)} SOL kept on the dev key for fees)` : ""}`;
    try {
      const ixs = await rescueIxs(client, dev.publicKey, to, l, sol, tokens, sol - keep);
      if (GO) {
        const sig = await send(client, dev, ixs);
        console.log(`✓ ${name}  ${what}  tx ${sig}`);
      } else {
        await prepareTx(connection, dev.publicKey, ixs, DEFAULT_PRIORITY_FEE);
        console.log(`✓ ${name}  ${what}  (simulation ok)`);
      }
      okCount++;
      deficit -= keep;
    } catch (e) {
      console.log(`✗ ${name}  ${what}  ${describeError(e)}`);
      failed.push(l.address);
    }
  }

  console.log(`\n${okCount}/${full.length} ${GO ? "sent" : "would succeed"}`);
  if (failed.length) {
    console.log(`failed: ${failed.join(", ")}`);
    if (GO) console.log("re-run the same command to retry them (already-emptied vaults are skipped)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
