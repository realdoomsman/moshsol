/**
 * Initializes the platform and writes <KEYS_DIR>/config.json (default .localnet/).
 * Idempotent: re-running only tops up balances (localnet) and prints the current config.
 * With `--update`, pushes these params to an existing platform (admin only; live launches keep
 * the terms frozen at their creation).
 *
 *   RPC_URL=https://api.devnet.solana.com KEYS_DIR=.devnet PROFILE=production pnpm setup:localnet
 *
 * Optional overrides: MIN_RAISE_SOL (default 1), CREATE_FEE_SOL (default 0.02), and the beta caps
 * MAX_RAISE_SOL (largest raise_max a new launch may set) and MAX_WALLET_SOL (most one wallet may
 * deposit into any raise); both default to 0 = no cap. HOLDFAST_CURVE=0/1 decides whether
 * `create_launch` (the in-program curve) stays open — off with PROFILE=production, where new
 * launches are pump.fun tokens — and BUYBACK_MINT sets the token `buyback_burn` buys and burns
 * (unset by default: push it with `--update` once the Holdfast token exists). The vault model
 * (creator fees 75% vault / 15% burn pool / 10% backers; backer payback at 5× initial vault SOL,
 * 15% of the vault per 4 h after the principal; dead launch at ≤ 5% outside holders; 0.1 SOL vault
 * floor) is `PAYBACK_DEFAULTS`, overridable with MIN_VAULT_SOL (SOL) and PAYOUT_MULT (e.g. 5).
 * On non-local clusters the admin keypair must already be funded (no airdrops).
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { PAYBACK_DEFAULTS, PROGRAM_ID, platformPda, type PlatformParams } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, airdrop, clientFor, loadOrCreateKeypair, send } from "./common";

const sol = (name: string, fallback: number) => new BN(Math.round(Number(process.env[name] ?? fallback) * LAMPORTS_PER_SOL));
const PRODUCTION = process.env.PROFILE === "production";

const LOCALNET_PARAMS: PlatformParams = {
  tradeFeeBps: 100,
  backerFeeShareBps: 5_000,
  creatorFeeShareBps: 3_000,
  launchFeeBps: 100,
  createFeeLamports: sol("CREATE_FEE_SOL", 0.02),
  virtualSolReserves: new BN(30 * LAMPORTS_PER_SOL),
  // The bundle follows the raise up to the program's hard cap (75%); creators may set a lower cap.
  maxBundleSupplyBps: 7_500,
  minRaiseLamports: sol("MIN_RAISE_SOL", 1),
  agentBuyBpsPerWindow: 1_000,
  agentSellBpsPerWindow: 500,
  agentMaxImpactBps: 300,
  agentBandBps: 200,
  // Short windows on localnet so agent behaviour is observable within minutes;
  // PROFILE=production uses hourly windows and a 30 minute EMA.
  agentWindowSecs: PRODUCTION ? 3_600 : 600,
  emaPeriodSecs: PRODUCTION ? 1_800 : 600,
  paused: false,
  agentsPaused: false,
  maxRaiseLamports: sol("MAX_RAISE_SOL", 0),
  maxWalletDepositLamports: sol("MAX_WALLET_SOL", 0),
  holdfastCurveEnabled: process.env.HOLDFAST_CURVE ? process.env.HOLDFAST_CURVE === "1" : !PRODUCTION,
  burnShareBps: PAYBACK_DEFAULTS.burnShareBps,
  buybackMint: process.env.BUYBACK_MINT ? new PublicKey(process.env.BUYBACK_MINT) : PublicKey.default,
  creatorFeeVaultBps: PAYBACK_DEFAULTS.creatorFeeVaultBps,
  payoutMultBps: process.env.PAYOUT_MULT ? Math.round(Number(process.env.PAYOUT_MULT) * 10_000) : PAYBACK_DEFAULTS.payoutMultBps,
  payoutShareBps: PAYBACK_DEFAULTS.payoutShareBps,
  payoutIntervalSecs: PAYBACK_DEFAULTS.payoutIntervalSecs,
  deadHoldersBps: PAYBACK_DEFAULTS.deadHoldersBps,
  minVaultSol: process.env.MIN_VAULT_SOL ? sol("MIN_VAULT_SOL", 0.1) : new BN(PAYBACK_DEFAULTS.minVaultSol.toString()),
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
    // A set buyback mint survives a re-run that doesn't name one.
    const params = { ...LOCALNET_PARAMS, buybackMint: process.env.BUYBACK_MINT ? LOCALNET_PARAMS.buybackMint : existing.params.buybackMint };
    const sig = await send(client, admin, [await client.updatePlatformIx(admin.publicKey, params)]);
    console.log(`platform params updated: ${sig}`);
  } else {
    console.log("platform already initialized (pass --update to push params)");
  }

  const configFile = path.join(LOCALNET_DIR, "config.json");
  // Merge so fields written by other scripts (e.g. the multisig handoff) survive a re-run.
  const previous = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  const config = {
    ...previous,
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID.toBase58(),
    platform: platformPda().toBase58(),
    admin: admin.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    treasury: treasury.publicKey.toBase58(),
  };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(config);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
