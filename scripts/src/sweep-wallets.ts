/**
 * Emergency: move everything the platform's own keys control to ONE wallet. Customers' custodial wallets
 * (apps/accounts) are never touched.
 *
 *   pnpm sweep-wallets <wallet>                       # preview: what each step would move, sends nothing
 *   pnpm sweep-wallets <wallet> --go [--keep-dev-sol] # sends; optional dev fee reserve for automated rescues
 *
 * Reads `.mainnet/` (config.json for the RPC + multisig, the key files) unless RPC_URL is set.
 *   1. `sweep_platform_fees` on every launch with platform fees waiting (permissionless; they land in the
 *      fee recipient, the Squads vault). admin.json pays.
 *   2. Squads vault → <wallet>: one vault transaction (close its empty token accounts, transfer its SOL),
 *      proposed by member-1, approved by member-1 + member-2, executed. admin.json pays rent and fees.
 *   3. Every key file in `.mainnet/` (recursively; not the program keypair): tokens to <wallet>'s token
 *      accounts, every token account closed (rent to <wallet>), then all SOL to <wallet>. admin.json last.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as multisig from "@sqds/multisig";
import { PROGRAM_ID, launchToJson, lamportsToSol, seedKeyOf, type LaunchAccount, type LaunchJson } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { ROOT, clientFor, send } from "./common";
import { fail, readKeypair, runVaultTransaction, squadsUrl } from "./squads";

const GO = process.argv.includes("--go");
const KEEP_DEV_SOL = process.argv.includes("--keep-dev-sol");
const DEV_FEE_RESERVE = Math.round(Number(process.env.DEV_FEE_RESERVE_SOL ?? "0.02") * 1e9);
const KEYS = path.join(ROOT, ".mainnet");
/** Legacy transaction, one signature, no compute-budget instructions: exactly this fee. */
const BASE_FEE = 5_000;

const config: unknown = JSON.parse(fs.readFileSync(path.join(KEYS, "config.json"), "utf8"));
function configString(key: string): string {
  if (config && typeof config === "object" && key in config) {
    const v: unknown = Reflect.get(config, key);
    if (typeof v === "string") return v;
  }
  fail(`no ${key} in .mainnet/config.json`);
}

type TokenHolding = { account: PublicKey; mint: PublicKey; program: PublicKey; amount: bigint; decimals: number };

async function tokenHoldings(connection: Connection, owner: PublicKey): Promise<TokenHolding[]> {
  const out: TokenHolding[] = [];
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await connection.getParsedTokenAccountsByOwner(owner, { programId: program }, "confirmed");
    for (const a of r.value) {
      const info: { mint: string; tokenAmount: { amount: string; decimals: number } } = a.account.data.parsed.info;
      out.push({ account: a.pubkey, mint: new PublicKey(info.mint), program, amount: BigInt(info.tokenAmount.amount), decimals: info.tokenAmount.decimals });
    }
  }
  return out;
}

/** Tokens to `to`'s ATA (created, `payer` pays), then close the account with its rent to `to`. */
function tokenIxs(owner: PublicKey, payer: PublicKey, to: PublicKey, t: TokenHolding): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (t.amount > 0n) {
    const dest = getAssociatedTokenAddressSync(t.mint, to, true, t.program);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, dest, to, t.mint, t.program));
    ixs.push(createTransferCheckedInstruction(t.account, t.mint, dest, owner, t.amount, t.decimals, [], t.program));
  }
  ixs.push(createCloseAccountInstruction(t.account, to, owner, [], t.program));
  return ixs;
}

function keyFiles(dir: string): { file: string; kp: Keypair }[] {
  const out: { file: string; kp: Keypair }[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...keyFiles(p));
    else if (f.endsWith(".json") && f !== "config.json" && !f.startsWith("program-")) out.push({ file: path.relative(ROOT, p), kp: readKeypair(p) });
  }
  return out;
}

async function sendLegacy(connection: Connection, payer: Keypair, owner: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const signers = payer.publicKey.equals(owner.publicKey) ? [payer] : [payer, owner];
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
}

async function main() {
  const target = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!target) fail("usage: pnpm sweep-wallets <destination wallet> [--go] [--keep-dev-sol]");
  let to: PublicKey;
  try {
    to = new PublicKey(target);
  } catch {
    fail(`${target} is not a wallet address`);
  }
  const connection = new Connection(process.env.RPC_URL ?? configString("rpcUrl"), "confirmed");
  const admin = readKeypair(path.join(KEYS, "admin.json"));
  const dev = readKeypair(path.join(KEYS, "dev.json"));
  const client = clientFor(connection, admin);
  const platform = await client.fetchPlatform();
  if (!platform) fail("can't read the platform account");
  console.log(GO ? "SENDING FOR REAL" : "PREVIEW — nothing is sent (add --go to do it)");
  console.log(`to ${to.toBase58()}\n`);

  // 1. platform fees → fee recipient
  console.log(`STEP 1  platform fees on launches → fee recipient ${platform.feeRecipient.toBase58()}`);
  const raw = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: client.program.coder.accounts.memcmp("launch").bytes as string } }],
  });
  const withFees: LaunchJson[] = [];
  for (const { pubkey, account } of raw) {
    try {
      const l = launchToJson(pubkey, client.program.coder.accounts.decode<LaunchAccount>("launch", account.data));
      if (BigInt(l.platformFeesUnclaimed) > 0n) withFees.push(l);
    } catch {}
  }
  const feeTotal = withFees.reduce((s, l) => s + BigInt(l.platformFeesUnclaimed), 0n);
  console.log(`${withFees.length} launches, ${lamportsToSol(feeTotal)} SOL`);
  for (let i = 0; i < withFees.length; i += 6) {
    const batch = withFees.slice(i, i + 6);
    const ixs = await Promise.all(batch.map((l) => client.sweepPlatformFeesIx(seedKeyOf(l), platform.feeRecipient)));
    try {
      if (GO) console.log(`✓ ${batch.length} launches  tx ${await send(client, admin, ixs)}`);
      else console.log(`  would sweep ${batch.map((l) => l.symbol || l.address.slice(0, 6)).join(", ")}`);
    } catch (e) {
      console.log(`✗ batch ${i / 6 + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Squads vault → to
  const multisigPda = new PublicKey(configString("multisig"));
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const vaultTokens = await tokenHoldings(connection, vault);
  const vaultSol = await connection.getBalance(vault, "confirmed");
  console.log(`\nSTEP 2  Squads vault ${vault.toBase58()}: ${lamportsToSol(BigInt(vaultSol))} SOL, ${vaultTokens.length} token accounts → you`);
  const vaultIxs = vaultTokens.flatMap((t) => tokenIxs(vault, admin.publicKey, to, t));
  if (vaultSol > 0) vaultIxs.push(SystemProgram.transfer({ fromPubkey: vault, toPubkey: to, lamports: vaultSol }));
  if (GO && vaultIxs.length) {
    const m1 = readKeypair(path.join(KEYS, "member-1.json"));
    const m2 = readKeypair(path.join(KEYS, "member-2.json"));
    await runVaultTransaction(
      { connection, client, admin, multisigPda, ms, vault, signers: { proposer: m1, approvers: [m1, m2] }, squadsHint: (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58() },
      "squads",
      `vault → ${to.toBase58()}`,
      vaultIxs,
    );
    console.log(`  vault now ${lamportsToSol(BigInt(await connection.getBalance(vault, "confirmed")))} SOL`);
  }

  // 3. every key file → to (admin last: it paid for steps 1 and 2)
  console.log("\nSTEP 3  every .mainnet key → you");
  const wallets = keyFiles(KEYS).sort((a, b) => Number(a.kp.publicKey.equals(admin.publicKey)) - Number(b.kp.publicKey.equals(admin.publicKey)));
  let moved = 0;
  for (const { file, kp } of wallets) {
    const owner = kp.publicKey;
    if (owner.equals(to)) continue;
    const tokens = await tokenHoldings(connection, owner);
    let sol = await connection.getBalance(owner, "confirmed");
    if (sol === 0 && tokens.length === 0) continue;
    const label = `${file.padEnd(36)} ${owner.toBase58()}`;
    try {
      if (tokens.length) {
        // Token-account owners sign; the dev key pays so already-drained wallets can close empty accounts.
        const ixs = tokens.flatMap((t) => tokenIxs(owner, dev.publicKey, to, t));
        if (GO) {
          for (let i = 0; i < ixs.length; i += 8) await sendLegacy(connection, dev, kp, ixs.slice(i, i + 8));
          sol = await connection.getBalance(owner, "confirmed");
        }
      }
      const reserve = KEEP_DEV_SOL && owner.equals(dev.publicKey) ? DEV_FEE_RESERVE : 0;
      const out = sol - BASE_FEE - reserve;
      if (out <= 0) {
        console.log(`- ${label}  ${lamportsToSol(BigInt(sol))} SOL, ${reserve ? `${lamportsToSol(BigInt(reserve))} SOL reserved for automated rescue fees` : "too little to move"}`);
        continue;
      }
      if (GO) {
        const sig = await sendLegacy(connection, kp, kp, [SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports: out })]);
        console.log(`✓ ${label}  ${lamportsToSol(BigInt(out))} SOL + ${tokens.length} token accounts  tx ${sig}`);
      } else console.log(`  ${label}  ${lamportsToSol(BigInt(out))} SOL + ${tokens.length} token accounts`);
      moved += out;
    } catch (e) {
      console.log(`✗ ${label}  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nkey wallets: ${lamportsToSol(BigInt(moved))} SOL ${GO ? "sent" : "would be sent"} (plus token-account rent)`);
  if (GO) console.log(`your wallet now ${lamportsToSol(BigInt(await connection.getBalance(to, "confirmed")))} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
