/**
 * pump.fun / PumpSwap addresses, PDAs, account decoders, the venue account lists the program's
 * pump instructions take as remaining accounts (mirrors `programs/moshsol/src/pump.rs`), the venue
 * reserves as a `CurveState` for quotes, and public trades on the bonding curve.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta, type Connection } from "@solana/web3.js";
import { PROGRAM_ID, SEEDS } from "./constants";
import type { CurveState } from "./math";

export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const MPL_TOKEN_METADATA_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const WSOL_MINT = NATIVE_MINT;

const enc = (s: string) => Buffer.from(s, "utf8");
const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

// ---- Holdfast ----

/** System-owned PDA that is a pump launch's venue `user` and owns its vault token account. */
export function pumpAuthorityPda(launch: PublicKey, programId = PROGRAM_ID): PublicKey {
  return pda([enc(SEEDS.pumpAuthority), launch.toBuffer()], programId);
}

/** SPL Token ATA (pump launches: vault = `splAta(pumpAuthority, mint)`). */
export function splAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
}

// ---- pump.fun ----

export const pumpGlobalPda = () => pda([enc("global")], PUMP_PROGRAM_ID);
export const pumpEventAuthorityPda = () => pda([enc("__event_authority")], PUMP_PROGRAM_ID);
export const pumpMintAuthorityPda = () => pda([enc("mint-authority")], PUMP_PROGRAM_ID);
export const pumpGlobalVolumeAccumulatorPda = () => pda([enc("global_volume_accumulator")], PUMP_PROGRAM_ID);
export const pumpUserVolumeAccumulatorPda = (user: PublicKey) =>
  pda([enc("user_volume_accumulator"), user.toBuffer()], PUMP_PROGRAM_ID);
export const bondingCurvePda = (mint: PublicKey) => pda([enc("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID);
export const bondingCurveV2Pda = (mint: PublicKey) => pda([enc("bonding-curve-v2"), mint.toBuffer()], PUMP_PROGRAM_ID);
export const creatorVaultPda = (creator: PublicKey) => pda([enc("creator-vault"), creator.toBuffer()], PUMP_PROGRAM_ID);
export const poolAuthorityPda = (mint: PublicKey) => pda([enc("pool-authority"), mint.toBuffer()], PUMP_PROGRAM_ID);
export const metadataPda = (mint: PublicKey) =>
  pda([enc("metadata"), MPL_TOKEN_METADATA_ID.toBuffer(), mint.toBuffer()], MPL_TOKEN_METADATA_ID);
export const feeConfigPda = (program: PublicKey) => pda([enc("fee_config"), program.toBuffer()], PUMP_FEE_PROGRAM_ID);

// ---- PumpSwap ----

export const ammGlobalConfigPda = () => pda([enc("global_config")], PUMP_AMM_PROGRAM_ID);
export const poolV2Pda = (baseMint: PublicKey) => pda([enc("pool-v2"), baseMint.toBuffer()], PUMP_AMM_PROGRAM_ID);
export const ammEventAuthorityPda = () => pda([enc("__event_authority")], PUMP_AMM_PROGRAM_ID);
export const ammGlobalVolumeAccumulatorPda = () => pda([enc("global_volume_accumulator")], PUMP_AMM_PROGRAM_ID);
export const ammUserVolumeAccumulatorPda = (user: PublicKey) =>
  pda([enc("user_volume_accumulator"), user.toBuffer()], PUMP_AMM_PROGRAM_ID);
export const ammCreatorVaultAuthorityPda = (coinCreator: PublicKey) =>
  pda([enc("creator_vault"), coinCreator.toBuffer()], PUMP_AMM_PROGRAM_ID);
/** The canonical pool pump.fun migrates a graduated curve into (index 0, quoted in WSOL). */
export function poolPda(mint: PublicKey): PublicKey {
  const index = Buffer.alloc(2);
  index.writeUInt16LE(0);
  return pda([enc("pool"), index, poolAuthorityPda(mint).toBuffer(), mint.toBuffer(), WSOL_MINT.toBuffer()], PUMP_AMM_PROGRAM_ID);
}
export const poolBaseAta = (pool: PublicKey, mint: PublicKey) => splAta(pool, mint);
export const poolQuoteAta = (pool: PublicKey) => splAta(pool, WSOL_MINT);

// ---- account decoders (prefixes only) ----

export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey;
}

export function decodeBondingCurve(data: Buffer | Uint8Array): BondingCurveState {
  const b = Buffer.from(data);
  const u = (at: number) => b.readBigUInt64LE(at);
  return {
    virtualTokenReserves: u(8),
    virtualSolReserves: u(16),
    realTokenReserves: u(24),
    realSolReserves: u(32),
    tokenTotalSupply: u(40),
    complete: b[48] !== 0,
    creator: new PublicKey(b.subarray(49, 81)),
  };
}

export interface PoolState {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  coinCreator: PublicKey;
}

export function decodePool(data: Buffer | Uint8Array): PoolState {
  const b = Buffer.from(data);
  const pk = (at: number) => new PublicKey(b.subarray(at, at + 32));
  return {
    baseMint: pk(43),
    quoteMint: pk(75),
    poolBaseTokenAccount: pk(139),
    poolQuoteTokenAccount: pk(171),
    coinCreator: pk(211),
  };
}

/** Fee recipients the venues require on every trade; read live because pump.fun can change them. */
export interface PumpConfig {
  /** pump.fun `Global.fee_recipient` */
  feeRecipient: PublicKey;
  /** first of PumpSwap `GlobalConfig.protocol_fee_recipients` */
  protocolFeeRecipient: PublicKey;
  /** first of `Global.buyback_fee_recipients` (the same list on both programs) */
  buybackFeeRecipient: PublicKey;
}

export async function fetchPumpConfig(connection: Connection): Promise<PumpConfig> {
  const [global, config] = await connection.getMultipleAccountsInfo([pumpGlobalPda(), ammGlobalConfigPda()], "confirmed");
  if (!global || !config) throw new Error("pump.fun config accounts not found on this cluster");
  return {
    // Global: disc(8) initialized(1) authority(32) fee_recipient(32)
    feeRecipient: new PublicKey(global.data.subarray(41, 73)),
    // GlobalConfig: disc(8) admin(32) lp_fee(8) protocol_fee(8) disable_flags(1) recipients[8]
    protocolFeeRecipient: new PublicKey(config.data.subarray(57, 89)),
    // Global: … reserved_fee_recipients[7] is_cashback_enabled(1) buyback_fee_recipients[8]
    buybackFeeRecipient: new PublicKey(global.data.subarray(741, 773)),
  };
}

const w = (pubkey: PublicKey, isWritable = false): AccountMeta => ({ pubkey, isSigner: false, isWritable });

/** Remaining accounts of a bonding-curve trade (`pump::curve` layout). */
export function curveVenueAccounts(p: {
  mint: PublicKey;
  /** The mint's pump.fun creator (the launch for launch tokens). */
  creator: PublicKey;
  /** The launch whose pump authority trades. */
  launch: PublicKey;
  config: PumpConfig;
  programId?: PublicKey;
}): AccountMeta[] {
  const curve = bondingCurvePda(p.mint);
  const user = pumpAuthorityPda(p.launch, p.programId);
  return [
    w(pumpGlobalPda()),
    w(p.config.feeRecipient, true),
    w(curve, true),
    w(splAta(curve, p.mint), true),
    w(creatorVaultPda(p.creator), true),
    w(pumpEventAuthorityPda()),
    w(PUMP_PROGRAM_ID),
    w(pumpGlobalVolumeAccumulatorPda()),
    w(pumpUserVolumeAccumulatorPda(user), true),
    w(feeConfigPda(PUMP_PROGRAM_ID)),
    w(PUMP_FEE_PROGRAM_ID),
    w(bondingCurveV2Pda(p.mint)),
    w(p.config.buybackFeeRecipient, true),
  ];
}

/** Remaining accounts of a PumpSwap trade (`pump::pool` layout). */
export function poolVenueAccounts(p: {
  mint: PublicKey;
  /** The launch (pool coin creator) for launch tokens; the buyback mint's own creator for buybacks. */
  coinCreator: PublicKey;
  /** The launch whose pump authority trades. */
  launch: PublicKey;
  config: PumpConfig;
  programId?: PublicKey;
}): AccountMeta[] {
  const pool = poolPda(p.mint);
  const user = pumpAuthorityPda(p.launch, p.programId);
  const creatorVaultAuthority = ammCreatorVaultAuthorityPda(p.coinCreator);
  return [
    w(pool, true),
    w(ammGlobalConfigPda()),
    w(WSOL_MINT),
    w(splAta(user, WSOL_MINT), true),
    w(poolBaseAta(pool, p.mint), true),
    w(poolQuoteAta(pool), true),
    w(p.config.protocolFeeRecipient),
    w(splAta(p.config.protocolFeeRecipient, WSOL_MINT), true),
    w(ASSOCIATED_TOKEN_PROGRAM_ID),
    w(ammEventAuthorityPda()),
    w(PUMP_AMM_PROGRAM_ID),
    w(splAta(creatorVaultAuthority, WSOL_MINT), true),
    w(creatorVaultAuthority),
    w(ammGlobalVolumeAccumulatorPda()),
    w(ammUserVolumeAccumulatorPda(user), true),
    w(feeConfigPda(PUMP_AMM_PROGRAM_ID)),
    w(PUMP_FEE_PROGRAM_ID),
    w(poolV2Pda(p.mint)),
    w(p.config.buybackFeeRecipient),
    w(splAta(p.config.buybackFeeRecipient, WSOL_MINT), true),
  ];
}

/** Remaining accounts of `collect_pump_fees` once graduated (`pump_fees::collect_pool` layout). */
export function collectPoolAccounts(launch: PublicKey): AccountMeta[] {
  const creatorVaultAuthority = ammCreatorVaultAuthorityPda(launch);
  return [
    w(WSOL_MINT),
    w(creatorVaultAuthority),
    w(splAta(creatorVaultAuthority, WSOL_MINT), true),
    w(splAta(launch, WSOL_MINT), true),
    w(ammEventAuthorityPda()),
    w(PUMP_AMM_PROGRAM_ID),
    w(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
}

// ---- venue reserves as a constant-product curve ----

/**
 * A bonding curve as the `CurveState` the SDK quote helpers understand: `x` = virtual SOL reserves
 * (of which `realSol` can leave on sells), `y` = virtual token reserves.
 */
export function curveStateOf(c: BondingCurveState): CurveState {
  return { virtualSol: c.virtualSolReserves - c.realSolReserves, realSol: c.realSolReserves, tokenReserve: c.virtualTokenReserves };
}

/** A PumpSwap pool (quote = WSOL balance, base = token balance) as a `CurveState`: everything is real. */
export function poolStateOf(quoteReserve: bigint, baseReserve: bigint): CurveState {
  return { virtualSol: 0n, realSol: quoteReserve, tokenReserve: baseReserve };
}

export interface VenueState {
  curve: CurveState;
  /** The bonding curve filled up: agent trades fail until pump.fun migrates it and `graduate_pump` runs. */
  complete: boolean;
}

/**
 * The reserves a pump launch currently trades against: its PumpSwap pool once graduated, its
 * bonding curve before. null when the venue account doesn't exist (yet).
 */
export async function fetchVenueState(
  connection: Connection,
  l: { mint: PublicKey; graduated: boolean },
  commitment: "confirmed" | "processed" = "confirmed",
): Promise<VenueState | null> {
  if (l.graduated) {
    const pool = poolPda(l.mint);
    const [base, quote] = await connection.getMultipleAccountsInfo([poolBaseAta(pool, l.mint), poolQuoteAta(pool)], commitment);
    if (!base || !quote) return null;
    const quoteReserve = unpackAccount(poolQuoteAta(pool), quote, TOKEN_PROGRAM_ID).amount;
    const baseReserve = unpackAccount(poolBaseAta(pool, l.mint), base, TOKEN_PROGRAM_ID).amount;
    return { curve: poolStateOf(quoteReserve, baseReserve), complete: false };
  }
  const info = await connection.getAccountInfo(bondingCurvePda(l.mint), commitment);
  if (!info) return null;
  const c = decodeBondingCurve(info.data);
  return { curve: curveStateOf(c), complete: c.complete };
}

// ---- public trades on the bonding curve (what the public does on pump.fun's site) ----

/** `buy_exact_sol_in(solIn, minTokensOut)` by `user` on `mint`'s curve, preceded by its idempotent ATA creation. */
export function pumpBuyIxs(p: {
  user: PublicKey;
  mint: PublicKey;
  /** The curve's creator (`decodeBondingCurve(...).creator`). */
  creator: PublicKey;
  solIn: bigint;
  minTokensOut: bigint;
  config: PumpConfig;
}): TransactionInstruction[] {
  const curve = bondingCurvePda(p.mint);
  const userTokens = splAta(p.user, p.mint);
  const data = Buffer.alloc(25);
  Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]).copy(data);
  data.writeBigUInt64LE(p.solIn, 8);
  data.writeBigUInt64LE(p.minTokensOut, 16);
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.user, userTokens, p.user, p.mint, TOKEN_PROGRAM_ID),
    new TransactionInstruction({
      programId: PUMP_PROGRAM_ID,
      keys: [
        w(pumpGlobalPda()),
        w(p.config.feeRecipient, true),
        w(p.mint),
        w(curve, true),
        w(splAta(curve, p.mint), true),
        w(userTokens, true),
        { pubkey: p.user, isSigner: true, isWritable: true },
        w(SystemProgram.programId),
        w(TOKEN_PROGRAM_ID),
        w(creatorVaultPda(p.creator), true),
        w(pumpEventAuthorityPda()),
        w(PUMP_PROGRAM_ID),
        w(pumpGlobalVolumeAccumulatorPda()),
        w(pumpUserVolumeAccumulatorPda(p.user), true),
        w(feeConfigPda(PUMP_PROGRAM_ID)),
        w(PUMP_FEE_PROGRAM_ID),
        w(bondingCurveV2Pda(p.mint)),
        w(p.config.buybackFeeRecipient, true),
      ],
      data,
    }),
  ];
}

/** `sell(tokensIn, minSolOut)` by `user` on `mint`'s curve. */
export function pumpSellIx(p: {
  user: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  tokensIn: bigint;
  minSolOut: bigint;
  config: PumpConfig;
}): TransactionInstruction {
  const curve = bondingCurvePda(p.mint);
  const data = Buffer.alloc(24);
  Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]).copy(data);
  data.writeBigUInt64LE(p.tokensIn, 8);
  data.writeBigUInt64LE(p.minSolOut, 16);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      w(pumpGlobalPda()),
      w(p.config.feeRecipient, true),
      w(p.mint),
      w(curve, true),
      w(splAta(curve, p.mint), true),
      w(splAta(p.user, p.mint), true),
      { pubkey: p.user, isSigner: true, isWritable: true },
      w(SystemProgram.programId),
      w(creatorVaultPda(p.creator), true),
      w(TOKEN_PROGRAM_ID),
      w(pumpEventAuthorityPda()),
      w(PUMP_PROGRAM_ID),
      w(feeConfigPda(PUMP_PROGRAM_ID)),
      w(PUMP_FEE_PROGRAM_ID),
      w(bondingCurveV2Pda(p.mint)),
      w(p.config.buybackFeeRecipient, true),
    ],
    data,
  });
}
