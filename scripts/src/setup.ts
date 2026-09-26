/**
 * Initializes the platform and writes <KEYS_DIR>/config.json (default .localnet/).
 * Idempotent: re-running only tops up balances (localnet) and prints the current config.
 * With `--update`, pushes these params to an existing platform (admin only; live launches keep
 * the terms frozen at their creation).
 *
 *   RPC_URL=https://api.devnet.solana.com KEYS_DIR=.devnet PROFILE=production pnpm setup:localnet
 *
 * Optional overrides: MIN_RAISE_SOL (default 1), CREATE_FEE_SOL (default 0.02).
 * On non-local clusters the admin keypair must already be funded (no airdrops).
 */
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { PROGRAM_ID, platformPda, type PlatformParams } from "@moshsol/sdk";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, airdrop, clientFor, loadOrCreateKeypair, send } from "./common";

const LOCALNET_PARAMS: PlatformParams = {
  tradeFeeBps: 100,
  backerFeeShareBps: 5_000,
  creatorFeeShareBps: 3_000,
  launchFeeBps: 100,
  createFeeLamports: new BN(Math.round(Number(process.env.CREATE_FEE_SOL ?? 0.02) * LAMPORTS_PER_SOL)),
  virtualSolReserves: new BN(30 * LAMPORTS_PER_SOL),
  maxBundleSupplyBps: 2_500,
  minRaiseLamports: new BN(Math.round(Number(process.env.MIN_RAISE_SOL ?? 1) * LAMPORTS_PER_SOL)),
  agentBuyBpsPerWindow: 1_000,
  agentSellBpsPerWindow: 500,
  agentMaxImpactBps: 300,
  agentBandBps: 200,
  // Short windows on localnet so agent behaviour is observable within minutes;
  // PROFILE=production uses hourly windows and a 30 minute EMA.
  agentWindowSecs: process.env.PROFILE === "production" ? 3_600 : 600,
  emaPeriodSecs: process.env.PROFILE === "production" ? 1_800 : 600,
  paused: false,
  agentsPaused: false,
};

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadOrCreateKeypair("admin");
  const agent = loadOrCreateKeypair("agent");
  const treasury = loadOrCreateKeypair("treasury");

  const isLocal = /127\.0\.0\.1|localhost/.test(RPC_URL);
  for (const [kp, min] of [
    [admin, 20],
    [agent, 5],
    [treasury, 1],
  ] as const) {
    const bal = await connection.getBalance(kp.publicKey);
    if (bal >= min * LAMPORTS_PER_SOL) continue;
    if (isLocal) await airdrop(connection, kp.publicKey, min * 2);
    else if (kp === admin && bal < 0.01 * LAMPORTS_PER_SOL) {
      throw new Error(`fund the admin ${admin.publicKey.toBase58()} (≥0.01 SOL) before running setup`);
    }
  }

  const client = clientFor(connection, admin);
  const existing = await client.fetchPlatform();
  if (!existing) {
    const ix = await client.initializePlatformIx({
      admin: admin.publicKey,
      feeRecipient: treasury.publicKey,
      agentAuthority: agent.publicKey,
      params: LOCALNET_PARAMS,
    });
    const sig = await send(client, admin, [ix]);
    console.log(`platform initialized: ${sig}`);
  } else if (process.argv.includes("--update")) {
    const sig = await send(client, admin, [await client.updatePlatformIx(admin.publicKey, LOCALNET_PARAMS)]);
    console.log(`platform params updated: ${sig}`);
  } else {
    console.log("platform already initialized (pass --update to push params)");
  }

  const config = {
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID.toBase58(),
    platform: platformPda().toBase58(),
    admin: admin.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    treasury: treasury.publicKey.toBase58(),
  };
  fs.writeFileSync(path.join(LOCALNET_DIR, "config.json"), JSON.stringify(config, null, 2));
  console.log(config);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
