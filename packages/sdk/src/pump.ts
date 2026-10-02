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

/** Little-endian u64 at `at`; DataView rather than `Buffer#readBigUInt64LE`, which browser Buffer polyfills may lack. */
const u64 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(at, true);
const putU64 = (b: Uint8Array, at: number, v: bigint) => new DataView(b.buffer, b.byteOffset, b.byteLength).setBigUint64(at, v, true);

export function decodeBondingCurve(data: Buffer | Uint8Array): BondingCurveState {
  const b = Buffer.from(data);
  return {
    virtualTokenReserves: u64(b, 8),
    virtualSolReserves: u64(b, 16),
    realTokenReserves: u64(b, 24),
    realSolReserves: u64(b, 32),
    tokenTotalSupply: u64(b, 40),
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
  /**
   * `Pool.virtual_quote_reserves` (signed i128 at offset 245; 0 for pools written before the
   * field existed): PumpSwap quotes every trade on `quote vault balance + this`.
   */
  virtualQuoteReserves: bigint;
}

/** Offset of `Pool.virtual_quote_reserves` (i128 LE); shorter (older) pool accounts carry none. */
const POOL_VIRTUAL_QUOTE_AT = 245;

export function decodePool(data: Buffer | Uint8Array): PoolState {
  const b = Buffer.from(data);
  const pk = (at: number) => new PublicKey(b.subarray(at, at + 32));
  let virtualQuoteReserves = 0n;
  if (b.length >= POOL_VIRTUAL_QUOTE_AT + 16) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const lo = view.getBigUint64(POOL_VIRTUAL_QUOTE_AT, true);
    const hi = view.getBigInt64(POOL_VIRTUAL_QUOTE_AT + 8, true);
    virtualQuoteReserves = (hi << 64n) + lo;
  }
  return {
    baseMint: pk(43),
    quoteMint: pk(75),
    poolBaseTokenAccount: pk(139),
    poolQuoteTokenAccount: pk(171),
    coinCreator: pk(211),
    virtualQuoteReserves,
  };
}

/**
 * The quote reserve PumpSwap prices on: the pool's WSOL vault balance plus its (signed)
 * `virtual_quote_reserves` — mirrors `pump::effective_quote` in the program, which rejects a
 * non-positive or overflowing result; here it floors at 0.
 */
export function poolEffectiveQuote(raw: bigint, virtualQuote: bigint): bigint {
  const q = raw + virtualQuote;
  return q > 0n ? q : 0n;
}

/** Every fee recipient the venues accept, read live because pump.fun can change them. */
export interface PumpFeeRecipients {
  /** pump.fun `Global.fee_recipient` and `Global.fee_recipients[7]` */
  feeRecipients: PublicKey[];
  /** PumpSwap `GlobalConfig.protocol_fee_recipients[8]` */
  protocolFeeRecipients: PublicKey[];
  /** pump.fun `Global.buyback_fee_recipients[8]` (the same list on both programs) */
  buybackFeeRecipients: PublicKey[];
}

/** One fee recipient of each kind for one instruction (see `pickPumpConfig`). */
export interface PumpConfig {
  feeRecipient: PublicKey;
  protocolFeeRecipient: PublicKey;
  buybackFeeRecipient: PublicKey;
}

/** `count` pubkeys from `at`, unset (all-zero) slots skipped. */
function pubkeyList(data: Buffer, at: number, count: number): PublicKey[] {
  const out: PublicKey[] = [];
  for (let i = 0; i < count; i++) {
    const key = new PublicKey(data.subarray(at + 32 * i, at + 32 * (i + 1)));
    if (!key.equals(PublicKey.default)) out.push(key);
  }
  return out;
}

export async function fetchPumpFeeRecipients(connection: Connection): Promise<PumpFeeRecipients> {
  const [global, config] = await connection.getMultipleAccountsInfo([pumpGlobalPda(), ammGlobalConfigPda()], "confirmed");
  if (!global || !config) throw new Error("pump.fun config accounts not found on this cluster");
  return {
    // Global: disc(8) initialized(1) authority(32) fee_recipient(32) … creator_fee_basis_points(8) fee_recipients[7] (162)
    feeRecipients: [...pubkeyList(global.data, 41, 1), ...pubkeyList(global.data, 162, 7)],
    // GlobalConfig: disc(8) admin(32) lp_fee(8) protocol_fee(8) disable_flags(1) protocol_fee_recipients[8]
    protocolFeeRecipients: pubkeyList(config.data, 57, 8),
    // Global: … reserved_fee_recipients[7] is_cashback_enabled(1) buyback_fee_recipients[8]
    buybackFeeRecipients: pubkeyList(global.data, 741, 8),
  };
}

/**
 * A random recipient of each list, as pump.fun recommends per buy / sell: every recipient is
 * write-locked by the trade, so spreading them avoids queueing behind everyone else's trades on
 * the same account (and the priority fee that local fee market charges).
 */
export function pickPumpConfig(r: PumpFeeRecipients): PumpConfig {
  const pick = (keys: PublicKey[], what: string) => {
    if (keys.length === 0) throw new Error(`pump.fun ${what} list is empty`);
    return keys[Math.floor(Math.random() * keys.length)]!;
  };
  return {
    feeRecipient: pick(r.feeRecipients, "fee recipient"),
    protocolFeeRecipient: pick(r.protocolFeeRecipients, "protocol fee recipient"),
    buybackFeeRecipient: pick(r.buybackFeeRecipients, "buyback fee recipient"),
  };
}

/** Fee recipients for one venue instruction, picked at random (`pickPumpConfig`). */
export async function fetchPumpConfig(connection: Connection): Promise<PumpConfig> {
  return pickPumpConfig(await fetchPumpFeeRecipients(connection));
}

const w = (pubkey: PublicKey, isWritable = false): AccountMeta => ({ pubkey, isSigner: false, isWritable });

/** Remaining accounts of a bonding-curve trade (`pump::curve` layout). */
export function curveVenueAccounts(p: {
  mint: PublicKey;
  /** The mint's pump.fun creator (the launch for launch tokens). */
  creator: PublicKey;
  /** The launch whose pump authority trades (unless `user` is given). */
  launch: PublicKey;
  /** The venue user when it is not the launch's pump authority (an agent wallet). */
  user?: PublicKey;
  config: PumpConfig;
  programId?: PublicKey;
}): AccountMeta[] {
  const curve = bondingCurvePda(p.mint);
  const user = p.user ?? pumpAuthorityPda(p.launch, p.programId);
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
  /** The launch whose pump authority trades (unless `user` is given). */
  launch: PublicKey;
  /** The venue user when it is not the launch's pump authority (an agent wallet). */
  user?: PublicKey;
  config: PumpConfig;
  programId?: PublicKey;
}): AccountMeta[] {
  const pool = poolPda(p.mint);
  const user = p.user ?? pumpAuthorityPda(p.launch, p.programId);
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

/**
 * A PumpSwap pool as a `CurveState`: `x` = the effective quote (WSOL vault balance plus the pool's
 * signed `virtual_quote_reserves`, see `poolEffectiveQuote`), of which only the vault balance
 * (`realSol`) can leave on sells; `y` = the base vault balance.
 */
export function poolStateOf(quoteReserve: bigint, baseReserve: bigint, virtualQuoteReserves: bigint): CurveState {
  return {
    virtualSol: poolEffectiveQuote(quoteReserve, virtualQuoteReserves) - quoteReserve,
    realSol: quoteReserve,
    tokenReserve: baseReserve,
  };
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
    const [poolInfo, base, quote] = await connection.getMultipleAccountsInfo(
      [pool, poolBaseAta(pool, l.mint), poolQuoteAta(pool)],
      commitment,
    );
    if (!poolInfo || !base || !quote) return null;
    const quoteReserve = unpackAccount(poolQuoteAta(pool), quote, TOKEN_PROGRAM_ID).amount;
    const baseReserve = unpackAccount(poolBaseAta(pool, l.mint), base, TOKEN_PROGRAM_ID).amount;
    return { curve: poolStateOf(quoteReserve, baseReserve, decodePool(poolInfo.data).virtualQuoteReserves), complete: false };
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
  putU64(data, 8, p.solIn);
  putU64(data, 16, p.minTokensOut);
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
  putU64(data, 8, p.tokensIn);
  putU64(data, 16, p.minSolOut);
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
