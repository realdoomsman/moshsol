import { Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, type Signer, type TransactionInstruction } from "@solana/web3.js";
import {
  DEFAULT_PRIORITY_FEE,
  MoshClient,
  PUMP_VENUE_FEE_BPS,
  curveOf,
  fetchPumpFeeRecipients,
  fetchVenueState,
  launchPda,
  pickPumpConfig,
  prepareTx,
  pumpBuyIxs,
  pumpSellIx,
  sendAndConfirm,
  type CurveState,
  type LaunchJson,
  type PlatformAccount,
  type PumpConfig,
  type PumpFeeRecipients,
  type ReviewedTerms,
} from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOCALNET_DIR = path.resolve(ROOT, process.env.KEYS_DIR ?? ".localnet");
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";

export function loadOrCreateKeypair(name: string): Keypair {
  fs.mkdirSync(LOCALNET_DIR, { recursive: true });
  const file = path.join(LOCALNET_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/**
 * The agent wallets (`platform.agentExecutors`) from `dir` (relative to the repo root): every `*.json`
 * keypair file in name order. With `create`, files `01.json … <count>.json` that are missing are generated
 * first (existing ones are never touched). Secret keys never leave the files.
 */
export function agentWallets(dir: string, create?: { count: number }): Keypair[] {
  const abs = path.resolve(ROOT, dir);
  if (create) {
    fs.mkdirSync(abs, { recursive: true });
    for (let i = 1; i <= create.count; i++) {
      const file = path.join(abs, `${String(i).padStart(2, "0")}.json`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
    }
  }
  if (!fs.existsSync(abs)) throw new Error(`no agent wallet directory ${abs}`);
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(abs, f), "utf8")) as number[])));
}

export async function airdrop(connection: Connection, to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, Math.round(sol * LAMPORTS_PER_SOL));
  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

/** Simulation-sized compute limit, fee-market priority fee (`DEFAULT_PRIORITY_FEE`), rebroadcast until confirmed. */
export async function send(
  client: MoshClient,
  payer: Keypair,
  ixs: TransactionInstruction[],
  extraSigners: Signer[] = [],
): Promise<string> {
  const { tx, lastValidBlockHeight } = await prepareTx(client.connection, payer.publicKey, ixs, DEFAULT_PRIORITY_FEE);
  tx.sign(payer, ...extraSigners);
  return sendAndConfirm(client.connection, tx.serialize(), lastValidBlockHeight);
}

export function clientFor(connection: Connection, kp: Keypair) {
  return new MoshClient(connection, new Wallet(kp));
}

// ---------------------------------------------------------------- venues

/** What a public trader pays on the launch's venue: the frozen trade fee on the Holdfast curve, pump.fun's fee otherwise. */
export function venueFeeBps(l: Pick<LaunchJson, "venue" | "terms">): number {
  return l.venue === "pump" ? PUMP_VENUE_FEE_BPS : l.terms.tradeFeeBps;
}

/** The reserves a live launch trades against: its own curve (Holdfast) or its pump.fun venue (null before `launch_pump`). */
export async function venueCurveOf(connection: Connection, l: LaunchJson): Promise<CurveState | null> {
  if (l.venue !== "pump") return curveOf(l);
  const state = await fetchVenueState(connection, { mint: new PublicKey(l.mint), graduated: l.pump.graduated });
  return state?.curve ?? null;
}

export interface RaiseArgs {
  name: string;
  symbol: string;
  uri: string;
  raiseMin: bigint;
  raiseMax: bigint;
  maxPerWallet: bigint;
  durationSecs: number;
  whitelistRoot: number[];
  bundleSupplyBps: number;
  reserveBps: number;
}

/**
 * Opens a raise on the platform's current venue — pump.fun unless the Holdfast curve is still enabled —
 * and returns the launch's PDA and seed key (the mint on the Holdfast curve, a one-time create key on
 * pump.fun, where the mint only exists once the raise launches).
 */
export async function createRaise(
  client: MoshClient,
  creator: Keypair,
  platform: PlatformAccount,
  args: RaiseArgs,
): Promise<{ address: PublicKey; seedKey: PublicKey }> {
  const seed = Keypair.generate();
  const common = { creator: creator.publicKey, feeRecipient: platform.feeRecipient, terms: platform.params as ReviewedTerms, ...args };
  const ix = platform.params.holdfastCurveEnabled
    ? await client.createLaunchIx({ ...common, mint: seed.publicKey })
    : await client.createLaunchPumpIx({ ...common, createKey: seed.publicKey });
  await send(client, creator, [ix], [seed]);
  return { address: launchPda(seed.publicKey), seedKey: seed.publicKey };
}

/** `launch` / `launch_pump` (with an ephemeral mint keypair) by `cranker`; returns the launch's mint. */
export async function launchRaise(client: MoshClient, cranker: Keypair, l: Pick<LaunchJson, "address" | "mint" | "venue">): Promise<PublicKey> {
  if (l.venue !== "pump") {
    const mint = new PublicKey(l.mint);
    await send(client, cranker, [await client.launchIx(cranker.publicKey, mint)]);
    return mint;
  }
  const mint = Keypair.generate();
  const ix = await client.launchPumpIx({ cranker: cranker.publicKey, launch: new PublicKey(l.address), mint: mint.publicKey });
  await send(client, cranker, [ix], [mint]);
  return mint.publicKey;
}

/** Public trades on a live launch's venue: the program's `buy`/`sell` on the Holdfast curve, pump.fun's otherwise. */
export class VenueTrader {
  private recipients: PumpFeeRecipients | null = null;

  constructor(private readonly client: MoshClient) {}

  /** pump.fun's fee recipient lists are read once; each trade picks its own at random. */
  private async pumpConfig(): Promise<PumpConfig> {
    return pickPumpConfig((this.recipients ??= await fetchPumpFeeRecipients(this.client.connection)));
  }

  async buyIxs(trader: PublicKey, l: Pick<LaunchJson, "address" | "mint" | "venue">, solIn: bigint, minTokensOut: bigint): Promise<TransactionInstruction[]> {
    const mint = new PublicKey(l.mint);
    if (l.venue !== "pump") return [await this.client.buyIx(trader, mint, solIn, minTokensOut)];
    return pumpBuyIxs({ user: trader, mint, creator: new PublicKey(l.address), solIn, minTokensOut, config: await this.pumpConfig() });
  }

  async sellIxs(trader: PublicKey, l: Pick<LaunchJson, "address" | "mint" | "venue">, tokensIn: bigint, minSolOut: bigint): Promise<TransactionInstruction[]> {
    const mint = new PublicKey(l.mint);
    if (l.venue !== "pump") return [await this.client.sellIx(trader, mint, tokensIn, minSolOut)];
    return [pumpSellIx({ user: trader, mint, creator: new PublicKey(l.address), tokensIn, minSolOut, config: await this.pumpConfig() })];
  }
}
