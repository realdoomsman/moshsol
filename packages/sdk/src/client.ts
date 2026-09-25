import {
  AnchorProvider,
  BN,
  BorshCoder,
  EventParser,
  Program,
  type IdlAccounts,
  type IdlEvents,
  type IdlTypes,
  type Provider,
  type Wallet,
} from "@coral-xyz/anchor";
import { getTokenMetadata } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "./idl/moshsol.json";
import type { Moshsol } from "./idl/moshsol";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants";
import { backerPda, curvePda, launchPda, platformPda, tokenAta, vaultPda } from "./pda";
import { marketCapSol, q64ToSolPerToken, spotPrice } from "./math";

export const IDL = idlJson as unknown as Moshsol;
export type { Moshsol };

export type LaunchAccount = IdlAccounts<Moshsol>["launch"];
export type PlatformAccount = IdlAccounts<Moshsol>["platform"];
export type BackerAccount = IdlAccounts<Moshsol>["backer"];
export type PlatformParams = IdlTypes<Moshsol>["platformParams"];
export type CreateLaunchArgs = IdlTypes<Moshsol>["createLaunchArgs"];
export type MoshEvents = IdlEvents<Moshsol>;
export type MoshEventName = keyof MoshEvents;
export type MoshEvent = { [K in MoshEventName]: { name: K; data: MoshEvents[K] } }[MoshEventName];

export type LaunchStatus = "raising" | "live" | "refunding";

export function statusOf(l: { status: LaunchAccount["status"] }): LaunchStatus {
  if ("live" in l.status) return "live";
  if ("refunding" in l.status) return "refunding";
  return "raising";
}

const big = (v: BN | number | bigint): bigint => BigInt(v.toString());

/** JSON-safe launch snapshot (u64/u128 as decimal strings) shared by indexer, agent and web. */
export interface LaunchJson {
  address: string;
  mint: string;
  creator: string;
  index: number;
  status: LaunchStatus;
  createdAt: number;
  launchedAt: number;
  raiseMin: string;
  raiseMax: string;
  maxPerWallet: string;
  raiseDeadline: number;
  raised: string;
  refunded: string;
  backerCount: number;
  whitelisted: boolean;
  whitelistRoot: string;
  bundleSupplyBps: number;
  reserveBps: number;
  virtualSol: string;
  realSol: string;
  tokenReserve: string;
  vaultSol: string;
  vaultTokens: string;
  bundleSol: string;
  bundleTokens: string;
  accFeePerShare: string;
  backerFeesAccrued: string;
  backerFeesClaimed: string;
  creatorFeesUnclaimed: string;
  creatorFeesClaimed: string;
  platformFeesUnclaimed: string;
  windowStart: number;
  windowBuyCap: string;
  windowSolSpent: string;
  windowSellCap: string;
  windowTokensSold: string;
  emaPriceQ64: string;
  lastTradeTs: number;
  agentBuys: number;
  agentSells: number;
  agentSolSpent: string;
  agentSolReceived: string;
  volumeSol: string;
  tradeCount: number;
  /** Derived: SOL per whole token. */
  priceSol: number;
  /** Derived: EMA in SOL per whole token. */
  emaSol: number;
  /** Derived: fully diluted market cap in SOL. */
  marketCapSol: number;
}

export function launchToJson(address: PublicKey, l: LaunchAccount): LaunchJson {
  const curve = { virtualSol: big(l.virtualSol), realSol: big(l.realSol), tokenReserve: big(l.tokenReserve) };
  const s = (v: BN) => v.toString();
  const n = (v: BN | number) => Number(v.toString());
  const root = Buffer.from(l.whitelistRoot as number[]);
  return {
    address: address.toBase58(),
    mint: l.mint.toBase58(),
    creator: l.creator.toBase58(),
    index: n(l.index),
    status: statusOf(l),
    createdAt: n(l.createdAt),
    launchedAt: n(l.launchedAt),
    raiseMin: s(l.raiseMin),
    raiseMax: s(l.raiseMax),
    maxPerWallet: s(l.maxPerWallet),
    raiseDeadline: n(l.raiseDeadline),
    raised: s(l.raised),
    refunded: s(l.refunded),
    backerCount: l.backerCount,
    whitelisted: root.some((b) => b !== 0),
    whitelistRoot: root.toString("hex"),
    bundleSupplyBps: l.bundleSupplyBps,
    reserveBps: l.reserveBps,
    virtualSol: s(l.virtualSol),
    realSol: s(l.realSol),
    tokenReserve: s(l.tokenReserve),
    vaultSol: s(l.vaultSol),
    vaultTokens: s(l.vaultTokens),
    bundleSol: s(l.bundleSol),
    bundleTokens: s(l.bundleTokens),
    accFeePerShare: s(l.accFeePerShare),
    backerFeesAccrued: s(l.backerFeesAccrued),
    backerFeesClaimed: s(l.backerFeesClaimed),
    creatorFeesUnclaimed: s(l.creatorFeesUnclaimed),
    creatorFeesClaimed: s(l.creatorFeesClaimed),
    platformFeesUnclaimed: s(l.platformFeesUnclaimed),
    windowStart: n(l.windowStart),
    windowBuyCap: s(l.windowBuyCap),
    windowSolSpent: s(l.windowSolSpent),
    windowSellCap: s(l.windowSellCap),
    windowTokensSold: s(l.windowTokensSold),
    emaPriceQ64: s(l.emaPrice),
    lastTradeTs: n(l.lastTradeTs),
    agentBuys: l.agentBuys,
    agentSells: l.agentSells,
    agentSolSpent: s(l.agentSolSpent),
    agentSolReceived: s(l.agentSolReceived),
    volumeSol: s(l.volumeSol),
    tradeCount: n(l.tradeCount),
    priceSol: spotPrice(curve),
    emaSol: q64ToSolPerToken(big(l.emaPrice)),
    marketCapSol: marketCapSol(curve),
  };
}

/** bigint curve state from either the raw account or its JSON snapshot. */
export function curveOf(l: Pick<LaunchJson, "virtualSol" | "realSol" | "tokenReserve"> | LaunchAccount) {
  return {
    virtualSol: BigInt(l.virtualSol.toString()),
    realSol: BigInt(l.realSol.toString()),
    tokenReserve: BigInt(l.tokenReserve.toString()),
  };
}

export interface TokenMeta {
  name: string;
  symbol: string;
  uri: string;
}

const bn = (v: bigint | number | string) => new BN(v.toString());

/**
 * Thin typed wrapper around the Anchor program: account fetchers, instruction builders
 * and event parsing. Signing and sending stay with the caller (wallet adapter, keypair, …).
 */
export class MoshClient {
  readonly program: Program<Moshsol>;
  readonly connection: Connection;
  private readonly parser: EventParser;

  constructor(connection: Connection, wallet?: Wallet) {
    this.connection = connection;
    const provider: Provider = wallet
      ? new AnchorProvider(connection, wallet, { commitment: "confirmed" })
      : ({ connection } as Provider);
    this.program = new Program<Moshsol>(IDL, provider);
    this.parser = new EventParser(this.program.programId, new BorshCoder(this.program.idl));
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  // ---------------- reads ----------------

  async fetchPlatform(): Promise<PlatformAccount | null> {
    return this.program.account.platform.fetchNullable(platformPda(this.programId));
  }

  async fetchLaunch(mint: PublicKey): Promise<LaunchAccount | null> {
    return this.program.account.launch.fetchNullable(launchPda(mint, this.programId));
  }

  async fetchAllLaunches(): Promise<{ publicKey: PublicKey; account: LaunchAccount }[]> {
    return this.program.account.launch.all();
  }

  async fetchBacker(mint: PublicKey, owner: PublicKey): Promise<BackerAccount | null> {
    const launch = launchPda(mint, this.programId);
    return this.program.account.backer.fetchNullable(backerPda(launch, owner, this.programId));
  }

  async fetchBackersOf(owner: PublicKey) {
    return this.program.account.backer.all([{ memcmp: { offset: 8 + 32, bytes: owner.toBase58() } }]);
  }

  async fetchBackersForLaunch(launch: PublicKey) {
    return this.program.account.backer.all([{ memcmp: { offset: 8, bytes: launch.toBase58() } }]);
  }

  async fetchTokenMeta(mint: PublicKey): Promise<TokenMeta | null> {
    const m = await getTokenMetadata(this.connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    return m ? { name: m.name, symbol: m.symbol, uri: m.uri } : null;
  }

  parseEvents(logs: string[]): MoshEvent[] {
    const out: MoshEvent[] = [];
    for (const e of this.parser.parseLogs(logs)) out.push(e as unknown as MoshEvent);
    return out;
  }

  // ---------------- instruction builders ----------------

  async initializePlatformIx(p: {
    admin: PublicKey;
    feeRecipient: PublicKey;
    agentAuthority: PublicKey;
    params: PlatformParams;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .initializePlatform(p.feeRecipient, p.agentAuthority, p.params)
      .accountsStrict({
        admin: p.admin,
        platform: platformPda(this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async updatePlatformIx(admin: PublicKey, params: PlatformParams) {
    return this.program.methods
      .updatePlatform(params)
      .accountsStrict({ admin, platform: platformPda(this.programId) })
      .instruction();
  }

  async createLaunchIx(p: {
    creator: PublicKey;
    mint: PublicKey;
    feeRecipient: PublicKey;
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
  }) {
    const launch = launchPda(p.mint, this.programId);
    return this.program.methods
      .createLaunch({
        name: p.name,
        symbol: p.symbol,
        uri: p.uri,
        raiseMin: bn(p.raiseMin),
        raiseMax: bn(p.raiseMax),
        maxPerWallet: bn(p.maxPerWallet),
        durationSecs: bn(p.durationSecs),
        whitelistRoot: p.whitelistRoot,
        bundleSupplyBps: p.bundleSupplyBps,
        reserveBps: p.reserveBps,
      })
      .accountsStrict({
        creator: p.creator,
        platform: platformPda(this.programId),
        feeRecipient: p.feeRecipient,
        launch,
        mint: p.mint,
        curveTokens: curvePda(launch, this.programId),
        vaultTokens: vaultPda(launch, this.programId),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async depositIx(owner: PublicKey, mint: PublicKey, amount: bigint, proof: number[][] = []) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .deposit(bn(amount), proof)
      .accountsStrict({
        owner,
        platform: platformPda(this.programId),
        launch,
        backer: backerPda(launch, owner, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async cancelLaunchIx(creator: PublicKey, mint: PublicKey) {
    return this.program.methods
      .cancelLaunch()
      .accountsStrict({ creator, launch: launchPda(mint, this.programId) })
      .instruction();
  }

  async refundIx(owner: PublicKey, mint: PublicKey) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .refund()
      .accountsStrict({ owner, launch, backer: backerPda(launch, owner, this.programId) })
      .instruction();
  }

  async launchIx(cranker: PublicKey, mint: PublicKey) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .launch()
      .accountsStrict({
        cranker,
        platform: platformPda(this.programId),
        launch,
        mint,
        curveTokens: curvePda(launch, this.programId),
        vaultTokens: vaultPda(launch, this.programId),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  async buyIx(trader: PublicKey, mint: PublicKey, solIn: bigint, minTokensOut: bigint) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .buy(bn(solIn), bn(minTokensOut))
      .accountsStrict({
        trader,
        platform: platformPda(this.programId),
        launch,
        mint,
        curveTokens: curvePda(launch, this.programId),
        traderTokens: tokenAta(trader, mint),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async sellIx(trader: PublicKey, mint: PublicKey, tokensIn: bigint, minSolOut: bigint) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .sell(bn(tokensIn), bn(minSolOut))
      .accountsStrict({
        trader,
        platform: platformPda(this.programId),
        launch,
        mint,
        curveTokens: curvePda(launch, this.programId),
        traderTokens: tokenAta(trader, mint),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  private agentAccounts(agent: PublicKey, mint: PublicKey) {
    const launch = launchPda(mint, this.programId);
    return {
      agent,
      platform: platformPda(this.programId),
      launch,
      mint,
      curveTokens: curvePda(launch, this.programId),
      vaultTokens: vaultPda(launch, this.programId),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    };
  }

  async agentBuyIx(agent: PublicKey, mint: PublicKey, solIn: bigint, minTokensOut: bigint) {
    return this.program.methods
      .agentBuy(bn(solIn), bn(minTokensOut))
      .accountsStrict(this.agentAccounts(agent, mint))
      .instruction();
  }

  async agentSellIx(agent: PublicKey, mint: PublicKey, tokensIn: bigint, minSolOut: bigint) {
    return this.program.methods
      .agentSell(bn(tokensIn), bn(minSolOut))
      .accountsStrict(this.agentAccounts(agent, mint))
      .instruction();
  }

  async claimBackerFeesIx(owner: PublicKey, mint: PublicKey) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .claimBackerFees()
      .accountsStrict({ owner, launch, backer: backerPda(launch, owner, this.programId) })
      .instruction();
  }

  async claimCreatorFeesIx(creator: PublicKey, mint: PublicKey) {
    return this.program.methods
      .claimCreatorFees()
      .accountsStrict({ creator, launch: launchPda(mint, this.programId) })
      .instruction();
  }

  async sweepPlatformFeesIx(mint: PublicKey, feeRecipient: PublicKey) {
    return this.program.methods
      .sweepPlatformFees()
      .accountsStrict({
        platform: platformPda(this.programId),
        launch: launchPda(mint, this.programId),
        feeRecipient,
      })
      .instruction();
  }

  // ---------------- transactions ----------------

  /** Legacy transaction with compute budget + optional priority fee, ready to sign. */
  async buildTx(
    payer: PublicKey,
    ixs: TransactionInstruction[],
    opts: { computeUnits?: number; priorityMicroLamports?: number } = {},
  ): Promise<{ tx: Transaction; blockhash: string; lastValidBlockHeight: number }> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 300_000 }));
    if (opts.priorityMicroLamports) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.priorityMicroLamports }));
    }
    tx.add(...ixs);
    return { tx, blockhash, lastValidBlockHeight };
  }
}

/** Human-readable message for program errors thrown by Anchor/web3 during send/simulate. */
export function describeError(err: unknown): string {
  const anyErr = err as { error?: { errorMessage?: string }; logs?: string[]; message?: string };
  if (anyErr?.error?.errorMessage) return anyErr.error.errorMessage;
  const logs: string[] = anyErr?.logs ?? [];
  const msg = String(anyErr?.message ?? err);
  const all = [msg, ...logs].join("\n");
  const m = all.match(/Error Message: ([^.\n]+)/);
  if (m) return m[1]!;
  const code = all.match(/custom program error: 0x([0-9a-f]+)/i);
  if (code) {
    const n = parseInt(code[1]!, 16);
    const e = IDL.errors.find((x) => x.code === n);
    if (e) return e.msg;
  }
  if (/User rejected/i.test(msg)) return "Transaction rejected in wallet";
  if (/insufficient (funds|lamports)/i.test(all)) return "Insufficient SOL balance";
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}
