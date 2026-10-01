/**
 * THROWAWAY mainnet e2e helper (PumpMainnetE2E). Removed after the proof.
 *   RPC_URL=… KEYS_DIR=.mainnet tsx src/e2e-pump.ts <cmd> …
 * cmds: fund <to> <sol> | bal <pk…> | launch <address> | buy <address> <sol> | sell <address> [tokens]
 *       | withdraw <address> (Squads) | vault-sell <address> (Squads) | ata <address>
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  PUMP_VENUE_FEE_BPS,
  fetchPumpConfig,
  fetchVenueState,
  launchToJson,
  minOut,
  pumpAuthorityPda,
  pumpSellIx,
  quoteBuy,
  quoteSell,
  splAta,
  type LaunchJson,
} from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, VenueTrader, clientFor, send } from "./common";
import { readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl } from "./squads";

const connection = new Connection(RPC_URL, "confirmed");
const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
const client = clientFor(connection, admin);
const sol = (l: bigint | number) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);

async function launchJson(address: string): Promise<LaunchJson> {
  const pk = new PublicKey(address);
  const acc = await client.program.account.launch.fetch(pk);
  return launchToJson(pk, acc);
}

async function tokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    return BigInt((await connection.getTokenAccountBalance(splAta(owner, mint), "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}

/** `CreateIdempotent` (1) of the SPL ATA of `owner` for `mint`, paid by `payer`. */
function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: splAta(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

async function vaultRun() {
  const config = readConfig();
  const multisigPda = new PublicKey(config.multisig as string);
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const hint = (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58();
  return { connection, client, admin, multisigPda, ms, vault, signers: readVaultSigners(ms), squadsHint: hint };
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "fund": {
    const to = new PublicKey(args[0]!);
    const lamports = Math.round(Number(args[1]) * LAMPORTS_PER_SOL);
    const sig = await send(client, admin, [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: to, lamports })]);
    console.log(`fund ${to.toBase58()} ${sol(lamports)} SOL: ${sig}`);
    break;
  }
  case "bal": {
    for (const a of args) console.log(`${a} ${sol(await connection.getBalance(new PublicKey(a)))} SOL`);
    break;
  }
  case "launch": {
    const l = await launchJson(args[0]!);
    const authority = pumpAuthorityPda(new PublicKey(l.address));
    const mint = new PublicKey(l.mint);
    const info = {
      address: l.address, mint: l.mint, venue: l.venue, status: l.status, symbol: l.symbol,
      vaultSol: sol(BigInt(l.vaultSol)), vaultTokens: l.venue === "pump" ? (Number(await tokenBalance(authority, mint)) / 1e6).toFixed(2) : "n/a",
      pump: l.pump, buybackPoolSol: sol(BigInt(l.buybackPoolSol)), creatorFeesCollected: sol(BigInt(l.creatorFeesCollected)), launchedAt: l.launchedAt, lastTradeTs: l.lastTradeTs,
      launchPdaLamports: sol(await connection.getBalance(new PublicKey(l.address))),
      pumpAuthorityLamports: sol(await connection.getBalance(authority)),
    };
    console.log(JSON.stringify(info, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    if (l.status === "raising") break;
    const venue = await fetchVenueState(connection, { mint, graduated: l.pump.graduated });
    if (venue) console.log("venue", JSON.stringify(venue, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    break;
  }
  case "buy": {
    const l = await launchJson(args[0]!);
    const solIn = BigInt(Math.round(Number(args[1]) * LAMPORTS_PER_SOL));
    const venue = await fetchVenueState(connection, { mint: new PublicKey(l.mint), graduated: l.pump.graduated });
    if (!venue) throw new Error("no venue");
    const q = quoteBuy(venue.curve, solIn, PUMP_VENUE_FEE_BPS);
    const ixs = await new VenueTrader(client).buyIxs(admin.publicKey, l, solIn, minOut(q.tokensOut, 300));
    const sig = await send(client, admin, ixs);
    console.log(`buy ${sol(solIn)} SOL → ~${(Number(q.tokensOut) / 1e6).toFixed(2)} ${l.symbol} (impact ${q.impactBps} bps): ${sig}`);
    console.log(`deployer tokens now ${(Number(await tokenBalance(admin.publicKey, new PublicKey(l.mint))) / 1e6).toFixed(2)}`);
    break;
  }
  case "sell": {
    const l = await launchJson(args[0]!);
    const mint = new PublicKey(l.mint);
    const have = await tokenBalance(admin.publicKey, mint);
    const tokensIn = args[1] ? BigInt(Math.round(Number(args[1]) * 1e6)) : have;
    const venue = await fetchVenueState(connection, { mint, graduated: l.pump.graduated });
    if (!venue) throw new Error("no venue");
    const q = quoteSell(venue.curve, tokensIn, PUMP_VENUE_FEE_BPS);
    const ixs = await new VenueTrader(client).sellIxs(admin.publicKey, l, tokensIn, minOut(q.solOut, 300));
    const sig = await send(client, admin, ixs);
    console.log(`sell ${(Number(tokensIn) / 1e6).toFixed(2)} ${l.symbol} → ~${sol(q.solOut)} SOL (impact ${q.impactBps} bps): ${sig}`);
    break;
  }
  case "ata": {
    const l = await launchJson(args[0]!);
    const mint = new PublicKey(l.mint);
    const platform = await client.fetchPlatform();
    const ata = splAta(platform!.feeRecipient, mint);
    const sig = await send(client, admin, [createAtaIdempotentIx(admin.publicKey, platform!.feeRecipient, mint)]);
    console.log(`ata ${ata.toBase58()} for fee recipient ${platform!.feeRecipient.toBase58()}: ${sig}`);
    break;
  }
  case "withdraw": {
    const l = await launchJson(args[0]!);
    const mint = new PublicKey(l.mint);
    const platform = await client.fetchPlatform();
    const authority = pumpAuthorityPda(new PublicKey(l.address));
    const tokens = await tokenBalance(authority, mint);
    const vaultSol = BigInt(l.vaultSol);
    const ata = splAta(platform!.feeRecipient, mint);
    const ix = await client.adminWithdrawVaultIx(platform!.admin, l, vaultSol, tokens, ata);
    console.log(`admin_withdraw_vault sol=${sol(vaultSol)} tokens=${(Number(tokens) / 1e6).toFixed(2)} → ${platform!.feeRecipient.toBase58()} / ${ata.toBase58()}`);
    await runVaultTransaction(await vaultRun(), "withdraw", "admin_withdraw_vault", [ix]);
    break;
  }
  case "vault-sell": {
    const l = await launchJson(args[0]!);
    const mint = new PublicKey(l.mint);
    const run = await vaultRun();
    const tokensIn = await tokenBalance(run.vault, mint);
    const venue = await fetchVenueState(connection, { mint, graduated: l.pump.graduated });
    if (!venue) throw new Error("no venue");
    const q = quoteSell(venue.curve, tokensIn, PUMP_VENUE_FEE_BPS);
    const ix = pumpSellIx({
      user: run.vault, mint, creator: new PublicKey(l.address), tokensIn, minSolOut: minOut(q.solOut, 500), config: await fetchPumpConfig(connection),
    });
    console.log(`vault ${run.vault.toBase58()} sells ${(Number(tokensIn) / 1e6).toFixed(2)} ${l.symbol} → ~${sol(q.solOut)} SOL`);
    await runVaultTransaction(run, "vault-sell", "pump sell as vault", [ix]);
    break;
  }
  default:
    throw new Error(`unknown cmd ${cmd}`);
}
