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
import { getTokenMetadata, TOKEN_PROGRAM_ID, unpackAccount, unpackMint } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, type TransactionInstruction } from "@solana/web3.js";
import idlJson from "./idl/moshsol.json";
import type { Moshsol } from "./idl/moshsol";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WIND_DOWN_IDLE_SECS,
  WIND_DOWN_MIN_AGE_SECS,
} from "./constants";
import { backerPda, curvePda, launchPda, platformPda, tokenAta, vaultPda } from "./pda";
import {
  ammEventAuthorityPda,
  bondingCurvePda,
  bondingCurveV2Pda,
  collectPoolAccounts,
  creatorVaultPda,
  curveVenueAccounts,
  decodeBondingCurve,
  feeConfigPda,
  fetchPumpConfig,
  metadataPda,
  poolBaseAta,
  poolPda,
  poolVenueAccounts,
  pumpAuthorityPda,
  pumpEventAuthorityPda,
  pumpGlobalPda,
  pumpGlobalVolumeAccumulatorPda,
  pumpMintAuthorityPda,
  pumpUserVolumeAccumulatorPda,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  MPL_TOKEN_METADATA_ID,
  splAta,
} from "./pump";
import { marketCapSol, q64ToSolPerToken, spotPrice } from "./math";

export const IDL = idlJson as unknown as Moshsol;
export type { Moshsol };

export type LaunchAccount = IdlAccounts<Moshsol>["launch"];
export type PlatformAccount = IdlAccounts<Moshsol>["platform"];
export type BackerAccount = IdlAccounts<Moshsol>["backer"];
export type PlatformParams = IdlTypes<Moshsol>["platformParams"];
export type CreateLaunchArgs = IdlTypes<Moshsol>["createLaunchArgs"];
export type CreateLaunchPumpArgs = IdlTypes<Moshsol>["createLaunchPumpArgs"];
export type MoshEvents = IdlEvents<Moshsol>;
export type MoshEventName = keyof MoshEvents;
export type MoshEvent = { [K in MoshEventName]: { name: K; data: MoshEvents[K] } }[MoshEventName];

export type LaunchStatus = "raising" | "live" | "refunding" | "woundDown";
export type LaunchVenue = "holdfast" | "pump";

export function statusOf(l: { status: LaunchAccount["status"] }): LaunchStatus {
  if ("live" in l.status) return "live";
  if ("refunding" in l.status) return "refunding";
  if ("woundDown" in l.status) return "woundDown";
  return "raising";
}

export function venueOf(l: { venue: LaunchAccount["venue"] }): LaunchVenue {
  return "pump" in l.venue ? "pump" : "holdfast";
}

/**
 * Second seed of a launch's PDA: its mint for Holdfast launches, its create key for pump launches
 * (whose mint doesn't exist until `launch_pump`). What the shared builders (`depositIx`, `refundIx`,
 * claims…) take as `seedKey`.
 */
export function seedKeyOf(l: Pick<LaunchJson, "createKey">): PublicKey {
  return new PublicKey(l.createKey);
}

/** What a pump launch's venue builders need, from its JSON snapshot. */
export interface PumpLaunchRef {
  address: PublicKey;
  mint: PublicKey;
  graduated: boolean;
}

export function pumpRefOf(l: Pick<LaunchJson, "address" | "mint" | "pump">): PumpLaunchRef {
  return { address: new PublicKey(l.address), mint: new PublicKey(l.mint), graduated: l.pump.graduated };
}

/** Why `wind_down` would fail right now; null = it would succeed. */
export type WindDownBlocker = "notLive" | "tooYoung" | "recentTrade" | "outsideHolders";

/** Unix time from which the program's age and idle rules allow `wind_down`. */
export function windDownOpensAt(l: Pick<LaunchJson, "launchedAt" | "lastTradeTs">): number {
  return Math.max(l.launchedAt + WIND_DOWN_MIN_AGE_SECS, l.lastTradeTs + WIND_DOWN_IDLE_SECS);
}

/** The status, age and idle rules of `wind_down` (the holder rule needs balances: `MoshClient.windDownBlocker`). */
export function windDownTimingBlocker(
  l: Pick<LaunchJson, "status" | "launchedAt" | "lastTradeTs">,
  nowSec: number,
): WindDownBlocker | null {
  if (l.status !== "live") return "notLive";
  if (nowSec < l.launchedAt + WIND_DOWN_MIN_AGE_SECS) return "tooYoung";
  if (nowSec < l.lastTradeTs + WIND_DOWN_IDLE_SECS) return "recentTrade";
  return null;
}

const big = (v: BN | number | bigint): bigint => BigInt(v.toString());

/** u16/u32 terms decode to plain numbers. */
export type LaunchTermsJson = IdlTypes<Moshsol>["launchTerms"];

/**
 * Platform params a creator reviewed: the on-chain `PlatformParams` (u64 as BN) or the indexer's
 * JSON (u64 as strings). `create_launch` fails with `TermsChanged` if the chain differs.
 */
export type ReviewedTerms = LaunchTermsJson & {
  virtualSolReserves: { toString(): string };
  createFeeLamports: { toString(): string };
};

/** The terms a pump launch freezes from platform params (`LaunchTerms::pump`): no trade-fee split, creator share 0. */
export function pumpTermsOf(t: LaunchTermsJson): LaunchTermsJson {
  return {
    tradeFeeBps: 0,
    backerFeeShareBps: 0,
    creatorFeeShareBps: 0,
    launchFeeBps: t.launchFeeBps,
    agentBuyBpsPerWindow: t.agentBuyBpsPerWindow,
    agentSellBpsPerWindow: t.agentSellBpsPerWindow,
    agentMaxImpactBps: t.agentMaxImpactBps,
    agentBandBps: t.agentBandBps,
    agentWindowSecs: t.agentWindowSecs,
    emaPeriodSecs: t.emaPeriodSecs,
    burnShareBps: t.burnShareBps,
  };
}

function decodeBondingCurveCreator(info: { data: Buffer } | null): PublicKey {
  if (!info) throw new Error("buyback mint has no pump.fun bonding curve");
  return decodeBondingCurve(info.data).creator;
}

/** SOL per whole token for a (lamports, base units) pair. */
function perToken(sol: BN, tokens: BN): number {
  return tokens.isZero() ? 0 : Number(sol.toString()) / 1e9 / (Number(tokens.toString()) / 1e6);
}

/** JSON-safe launch snapshot (u64/u128 as decimal strings) shared by indexer, agent and web. */
export interface LaunchJson {
  address: string;
  mint: string;
  creator: string;
  index: number;
  status: LaunchStatus;
  createdAt: number;
  launchedAt: number;
  /** Economic terms frozen at creation — use these (not platform params) for quotes. */
  terms: LaunchTermsJson;
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
  /** SOL cost basis of the tokens currently in the vault (average-cost method). */
  vaultCostSol: string;
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
  agentTokensSold: string;
  /** SOL from agent sells still available for buy-backs. */
  buybackSol: string;
  volumeSol: string;
  tradeCount: number;
  venue: LaunchVenue;
  /** Second PDA seed: the mint (Holdfast) or the one-time create key (pump). */
  createKey: string;
  pump: {
    /** pump.fun bonding curve; the default pubkey until `launch_pump`. */
    bondingCurve: string;
    /** PumpSwap pool once `graduate_pump` recorded it; the default pubkey before. */
    pool: string;
    graduated: boolean;
  };
  /** SOL waiting for `buyback_burn`. */
  buybackPoolSol: string;
  creatorFeesCollected: string;
  burnedSol: string;
  burnedTokens: string;
  lastBuybackTs: number;
  /** Token metadata of pump launches (empty on Holdfast launches, whose mint carries it). */
  name: string;
  symbol: string;
  uri: string;
  /** Derived: SOL per whole token (Holdfast curve; 0 on pump launches, whose venue prices them). */
  priceSol: number;
  /** Derived: EMA in SOL per whole token. */
  emaSol: number;
  /** Derived: fully diluted market cap in SOL (Holdfast curve; 0 on pump launches). */
  marketCapSol: number;
  /** Derived: vault average cost in SOL per whole token (bundle entry if the vault is empty). */
  vaultAvgCostSol: number;
  /** Derived: average agent sell price in SOL per whole token, null before the first sell. */
  agentAvgSellSol: number | null;
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
    terms: { ...l.terms },
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
    vaultCostSol: s(l.vaultCostSol),
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
    agentTokensSold: s(l.agentTokensSold),
    buybackSol: s(l.buybackSol),
    volumeSol: s(l.volumeSol),
    tradeCount: n(l.tradeCount),
    venue: venueOf(l),
    createKey: l.createKey.toBase58(),
    pump: {
      bondingCurve: l.pump.bondingCurve.toBase58(),
      pool: l.pump.pool.toBase58(),
      graduated: l.pump.graduated,
    },
    buybackPoolSol: s(l.buybackPoolSol),
    creatorFeesCollected: s(l.creatorFeesCollected),
    burnedSol: s(l.burnedSol),
    burnedTokens: s(l.burnedTokens),
    lastBuybackTs: n(l.lastBuybackTs),
    name: l.name,
    symbol: l.symbol,
    uri: l.uri,
    priceSol: "pump" in l.venue ? 0 : spotPrice(curve),
    emaSol: q64ToSolPerToken(big(l.emaPrice)),
    marketCapSol: "pump" in l.venue ? 0 : marketCapSol(curve),
    vaultAvgCostSol: perToken(
      l.vaultTokens.isZero() ? l.bundleSol : l.vaultCostSol,
      l.vaultTokens.isZero() ? l.bundleTokens : l.vaultTokens,
    ),
    agentAvgSellSol: l.agentTokensSold.isZero() ? null : perToken(l.agentSolReceived, l.agentTokensSold),
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

  /** By the launch PDA's second seed: the mint (Holdfast) or the create key (pump), see `seedKeyOf`. */
  async fetchLaunch(seedKey: PublicKey): Promise<LaunchAccount | null> {
    return this.program.account.launch.fetchNullable(launchPda(seedKey, this.programId));
  }

  async fetchAllLaunches(): Promise<{ publicKey: PublicKey; account: LaunchAccount }[]> {
    return this.program.account.launch.all();
  }

  async fetchBacker(seedKey: PublicKey, owner: PublicKey): Promise<BackerAccount | null> {
    const launch = launchPda(seedKey, this.programId);
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

  /**
   * Whether `wind_down` / `wind_down_pump` would pass right now, from one consistent snapshot of the
   * launch, its mint supply and the venue/vault token balances (the program's outside-holder rule:
   * `supply == venue + vault`, the venue being the Holdfast curve, the pump.fun bonding curve or
   * the PumpSwap pool). null = eligible.
   */
  async windDownBlocker(
    l: Pick<LaunchJson, "address" | "mint" | "venue" | "pump">,
    nowSec = Math.floor(Date.now() / 1000),
  ): Promise<WindDownBlocker | null> {
    const launch = new PublicKey(l.address);
    const mint = new PublicKey(l.mint);
    const pump = l.venue === "pump";
    const tokenProgram = pump ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
    let venueTokens: PublicKey;
    if (!pump) venueTokens = curvePda(launch, this.programId);
    else if (l.pump.graduated) venueTokens = poolBaseAta(new PublicKey(l.pump.pool), mint);
    else venueTokens = splAta(bondingCurvePda(mint), mint);
    const vaultTokens = pump ? splAta(pumpAuthorityPda(launch, this.programId), mint) : vaultPda(launch, this.programId);
    const [launchInfo, mintInfo, venueInfo, vaultInfo] = await this.connection.getMultipleAccountsInfo(
      [launch, mint, venueTokens, vaultTokens],
      "confirmed",
    );
    if (!launchInfo || !mintInfo || !venueInfo || !vaultInfo) return "notLive";
    const fresh = launchToJson(launch, this.program.coder.accounts.decode<LaunchAccount>("launch", launchInfo.data));
    const timing = windDownTimingBlocker(fresh, nowSec);
    if (timing) return timing;
    const supply = unpackMint(mint, mintInfo, tokenProgram).supply;
    const held =
      unpackAccount(venueTokens, venueInfo, tokenProgram).amount + unpackAccount(vaultTokens, vaultInfo, tokenProgram).amount;
    return supply === held ? null : "outsideHolders";
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
        programData: PublicKey.findProgramAddressSync(
          [this.programId.toBuffer()],
          BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        )[0],
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

  async setFeeRecipientIx(admin: PublicKey, feeRecipient: PublicKey) {
    return this.program.methods
      .setFeeRecipient(feeRecipient)
      .accountsStrict({ admin, platform: platformPda(this.programId) })
      .instruction();
  }

  async setAgentAuthorityIx(admin: PublicKey, agentAuthority: PublicKey) {
    return this.program.methods
      .setAgentAuthority(agentAuthority)
      .accountsStrict({ admin, platform: platformPda(this.programId) })
      .instruction();
  }

  /** Step 1 of the two-step admin handoff: the current admin nominates `newAdmin`. */
  async proposeAdminIx(admin: PublicKey, newAdmin: PublicKey) {
    return this.program.methods
      .proposeAdmin(newAdmin)
      .accountsStrict({ admin, platform: platformPda(this.programId) })
      .instruction();
  }

  /** Step 2: signed by the pending admin (e.g. a multisig vault) to take over. */
  async acceptAdminIx(newAdmin: PublicKey) {
    return this.program.methods
      .acceptAdmin()
      .accountsStrict({ newAdmin, platform: platformPda(this.programId) })
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
    terms: ReviewedTerms;
  }) {
    const t = p.terms;
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
        expectedTerms: {
          tradeFeeBps: t.tradeFeeBps,
          backerFeeShareBps: t.backerFeeShareBps,
          creatorFeeShareBps: t.creatorFeeShareBps,
          launchFeeBps: t.launchFeeBps,
          agentBuyBpsPerWindow: t.agentBuyBpsPerWindow,
          agentSellBpsPerWindow: t.agentSellBpsPerWindow,
          agentMaxImpactBps: t.agentMaxImpactBps,
          agentBandBps: t.agentBandBps,
          agentWindowSecs: t.agentWindowSecs,
          emaPeriodSecs: t.emaPeriodSecs,
          burnShareBps: t.burnShareBps,
        },
        expectedVirtualSol: new BN(t.virtualSolReserves.toString()),
        maxCreateFeeLamports: new BN(t.createFeeLamports.toString()),
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

  // ---------------- pump.fun launches ----------------

  /**
   * Opens a raise for a pump.fun token. `createKey` is a fresh keypair that signs once and seeds the
   * launch PDA (`launchPda(createKey)`); the mint is created at `launchPumpIx`. The frozen terms are
   * `pumpTermsOf(platformParams)`: no trade-fee split, creator share 0.
   */
  async createLaunchPumpIx(p: {
    creator: PublicKey;
    createKey: PublicKey;
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
    terms: ReviewedTerms;
  }) {
    const t = pumpTermsOf(p.terms);
    return this.program.methods
      .createLaunchPump({
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
        expectedTerms: t,
        maxCreateFeeLamports: new BN(p.terms.createFeeLamports.toString()),
      })
      .accountsStrict({
        creator: p.creator,
        platform: platformPda(this.programId),
        feeRecipient: p.feeRecipient,
        createKey: p.createKey,
        launch: launchPda(p.createKey, this.programId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Creates the token on pump.fun and buys the bundle. `mint` is an ephemeral keypair the sender
   * generates and signs with (pump.fun needs the mint to sign; it never has authority afterwards).
   * Needs ~350k CU.
   */
  async launchPumpIx(p: { cranker: PublicKey; launch: PublicKey; mint: PublicKey }) {
    const { feeRecipient, buybackFeeRecipient } = await fetchPumpConfig(this.connection);
    const authority = pumpAuthorityPda(p.launch, this.programId);
    const curve = bondingCurvePda(p.mint);
    return this.program.methods
      .launchPump()
      .accountsStrict({
        cranker: p.cranker,
        launch: p.launch,
        pumpAuthority: authority,
        mint: p.mint,
        mintAuthority: pumpMintAuthorityPda(),
        bondingCurve: curve,
        associatedBondingCurve: splAta(curve, p.mint),
        global: pumpGlobalPda(),
        mplTokenMetadata: MPL_TOKEN_METADATA_ID,
        metadata: metadataPda(p.mint),
        eventAuthority: pumpEventAuthorityPda(),
        pumpProgram: PUMP_PROGRAM_ID,
        vaultTokens: splAta(authority, p.mint),
        feeRecipient,
        creatorVault: creatorVaultPda(p.launch),
        globalVolumeAccumulator: pumpGlobalVolumeAccumulatorPda(),
        userVolumeAccumulator: pumpUserVolumeAccumulatorPda(authority),
        feeConfig: feeConfigPda(PUMP_PROGRAM_ID),
        feeProgram: PUMP_FEE_PROGRAM_ID,
        bondingCurveV2: bondingCurveV2Pda(p.mint),
        buybackFeeRecipient,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
  }

  /** Permissionless: records the PumpSwap pool once the curve completed and pump.fun migrated it. */
  async graduatePumpIx(l: PumpLaunchRef) {
    return this.program.methods
      .graduatePump()
      .accountsStrict({
        launch: l.address,
        bondingCurve: bondingCurvePda(l.mint),
        pool: poolPda(l.mint),
      })
      .instruction();
  }

  /** Venue accounts of a pump launch's trade, for its current venue. */
  private async venueAccounts(l: PumpLaunchRef) {
    const cfg = await fetchPumpConfig(this.connection);
    return l.graduated
      ? poolVenueAccounts({ mint: l.mint, coinCreator: l.address, launch: l.address, config: cfg, programId: this.programId })
      : curveVenueAccounts({ mint: l.mint, creator: l.address, launch: l.address, config: cfg, programId: this.programId });
  }

  private pumpAgentAccounts(agent: PublicKey, l: PumpLaunchRef) {
    const authority = pumpAuthorityPda(l.address, this.programId);
    return {
      agent,
      platform: platformPda(this.programId),
      launch: l.address,
      mint: l.mint,
      pumpAuthority: authority,
      vaultTokens: splAta(authority, l.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  async agentBuyPumpIx(agent: PublicKey, l: PumpLaunchRef, solIn: bigint, minTokensOut: bigint) {
    return this.program.methods
      .agentBuyPump(bn(solIn), bn(minTokensOut))
      .accountsStrict(this.pumpAgentAccounts(agent, l))
      .remainingAccounts(await this.venueAccounts(l))
      .instruction();
  }

  async agentSellPumpIx(agent: PublicKey, l: PumpLaunchRef, tokensIn: bigint, minSolOut: bigint) {
    return this.program.methods
      .agentSellPump(bn(tokensIn), bn(minSolOut))
      .accountsStrict(this.pumpAgentAccounts(agent, l))
      .remainingAccounts(await this.venueAccounts(l))
      .instruction();
  }

  /**
   * Permissionless: sweeps pump.fun (and PumpSwap once graduated) creator fees into the launch.
   * Never samples the EMA (only agent trades do on pump launches).
   */
  async collectPumpFeesIx(cranker: PublicKey, l: PumpLaunchRef) {
    return this.program.methods
      .collectPumpFees()
      .accountsStrict({
        cranker,
        launch: l.address,
        creatorVault: creatorVaultPda(l.address),
        pumpEventAuthority: pumpEventAuthorityPda(),
        pumpProgram: PUMP_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(l.graduated ? collectPoolAccounts(l.address) : [])
      .instruction();
  }

  /**
   * Agent-authority crank (`cranker` must be `platform.agentAuthority`): buys the platform's buyback
   * mint with up to `maxSol` of the launch's buyback pool on the mint's current venue
   * (`buybackGraduated` = its pump.fun curve is complete) and burns it. `minTokensOut` is the
   * caller's floor, priced off-chain from a reference the transaction itself cannot move; the
   * program also enforces 97% of its own fee-free quote.
   */
  async buybackBurnIx(p: {
    cranker: PublicKey;
    launch: PublicKey;
    buybackMint: PublicKey;
    buybackGraduated: boolean;
    maxSol: bigint;
    minTokensOut: bigint;
  }) {
    const cfg = await fetchPumpConfig(this.connection);
    const authority = pumpAuthorityPda(p.launch, this.programId);
    const creator = decodeBondingCurveCreator(await this.connection.getAccountInfo(bondingCurvePda(p.buybackMint), "confirmed"));
    const remaining = p.buybackGraduated
      ? poolVenueAccounts({ mint: p.buybackMint, coinCreator: creator, launch: p.launch, config: cfg, programId: this.programId })
      : curveVenueAccounts({ mint: p.buybackMint, creator, launch: p.launch, config: cfg, programId: this.programId });
    return this.program.methods
      .buybackBurn(bn(p.maxSol), bn(p.minTokensOut))
      .accountsStrict({
        cranker: p.cranker,
        platform: platformPda(this.programId),
        launch: p.launch,
        pumpAuthority: authority,
        buybackMint: p.buybackMint,
        burnTokens: splAta(authority, p.buybackMint),
        buybackCurve: bondingCurvePda(p.buybackMint),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remaining)
      .instruction();
  }

  /** Permissionless: `wind_down` of a pump launch (sells the vault into the venue, SOL to backers). */
  async windDownPumpIx(cranker: PublicKey, l: PumpLaunchRef) {
    const authority = pumpAuthorityPda(l.address, this.programId);
    return this.program.methods
      .windDownPump()
      .accountsStrict({
        cranker,
        launch: l.address,
        mint: l.mint,
        pumpAuthority: authority,
        vaultTokens: splAta(authority, l.mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(await this.venueAccounts(l))
      .instruction();
  }

  /** Admin only, once after the pump upgrade: grows the platform account to the current layout. */
  async migratePlatformIx(admin: PublicKey) {
    return this.program.methods
      .migratePlatform()
      .accountsStrict({ admin, platform: platformPda(this.programId), systemProgram: SystemProgram.programId })
      .instruction();
  }

  /** Admin only, once per pre-pump launch after the upgrade: grows it to the current layout. */
  async migrateLaunchIx(admin: PublicKey, launch: PublicKey) {
    return this.program.methods
      .migrateLaunch()
      .accountsStrict({ admin, platform: platformPda(this.programId), launch, systemProgram: SystemProgram.programId })
      .instruction();
  }

  /** `seedKey` = `seedKeyOf(launch)` here and in the other shared (both-venue) builders below. */
  async depositIx(owner: PublicKey, seedKey: PublicKey, amount: bigint, proof: number[][] = []) {
    const launch = launchPda(seedKey, this.programId);
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

  async cancelLaunchIx(creator: PublicKey, seedKey: PublicKey) {
    return this.program.methods
      .cancelLaunch()
      .accountsStrict({ creator, launch: launchPda(seedKey, this.programId) })
      .instruction();
  }

  async refundIx(owner: PublicKey, seedKey: PublicKey) {
    const launch = launchPda(seedKey, this.programId);
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

  async claimBackerFeesIx(owner: PublicKey, seedKey: PublicKey) {
    const launch = launchPda(seedKey, this.programId);
    return this.program.methods
      .claimBackerFees()
      .accountsStrict({ owner, launch, backer: backerPda(launch, owner, this.programId) })
      .instruction();
  }

  async claimCreatorFeesIx(creator: PublicKey, seedKey: PublicKey) {
    return this.program.methods
      .claimCreatorFees()
      .accountsStrict({ creator, launch: launchPda(seedKey, this.programId) })
      .instruction();
  }

  async sweepPlatformFeesIx(seedKey: PublicKey, feeRecipient: PublicKey) {
    return this.program.methods
      .sweepPlatformFees()
      .accountsStrict({
        platform: platformPda(this.programId),
        launch: launchPda(seedKey, this.programId),
        feeRecipient,
      })
      .instruction();
  }

  /** Permissionless: ends a dead launch (see `windDownBlocker` for the rules). */
  async windDownIx(cranker: PublicKey, mint: PublicKey) {
    const launch = launchPda(mint, this.programId);
    return this.program.methods
      .windDown()
      .accountsStrict({
        cranker,
        launch,
        mint,
        curveTokens: curvePda(launch, this.programId),
        vaultTokens: vaultPda(launch, this.programId),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Platform admin only: sends `sol` lamports of vault SOL to the platform fee recipient and `tokens`
   * base units of vault tokens to `recipientTokens`, a token account of `mint` owned by the fee
   * recipient under the launch's token program (Token-2022 on Holdfast launches: `tokenAta(feeRecipient,
   * mint)`; SPL Token on pump launches: `splAta(feeRecipient, mint)`), which must exist.
   */
  async adminWithdrawVaultIx(
    admin: PublicKey,
    l: Pick<LaunchJson, "address" | "mint" | "venue">,
    sol: bigint,
    tokens: bigint,
    recipientTokens: PublicKey,
  ) {
    const platform = await this.fetchPlatform();
    if (!platform) throw new Error("Platform is not initialized");
    const launch = new PublicKey(l.address);
    const mint = new PublicKey(l.mint);
    const pump = l.venue === "pump";
    const authority = pump ? pumpAuthorityPda(launch, this.programId) : launch;
    return this.program.methods
      .adminWithdrawVault(bn(sol), bn(tokens))
      .accountsStrict({
        admin,
        platform: platformPda(this.programId),
        launch,
        mint,
        vaultTokens: pump ? splAta(authority, mint) : vaultPda(launch, this.programId),
        feeRecipient: platform.feeRecipient,
        recipientTokens,
        tokenAuthority: authority,
        tokenProgram: pump ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }
}

/**
 * `describeError` text of `SameSlotTrade`: a public trade and a vault-agent trade collided in one slot
 * (anti-sandwich rule). Transient — the same transaction succeeds a slot later.
 * (The JSON IDL spells error names in PascalCase, its generated type in camelCase.)
 */
export const SAME_SLOT_TRADE_MESSAGE = IDL.errors.find((e) => e.name.toLowerCase() === "sameslottrade")!.msg;

/** Human-readable message for program errors thrown by Anchor/web3 during send/simulate. */
export function describeError(err: unknown): string {
  const anyErr = err as { error?: { errorMessage?: string }; logs?: string[]; message?: string };
  if (anyErr?.error?.errorMessage) return anyErr.error.errorMessage;
  const logs: string[] = anyErr?.logs ?? [];
  const msg = String(anyErr?.message ?? err);
  const all = [msg, ...logs].join("\n");
  const m = all.match(/Error Message: ([^.\n]+)/);
  if (m) return m[1]!;
  // Log form ("custom program error: 0x1783") or TransactionError JSON ({"Custom":6019}).
  const hex = all.match(/custom program error: 0x([0-9a-f]+)/i);
  const dec = all.match(/"Custom":\s*(\d+)/);
  const n = hex ? parseInt(hex[1]!, 16) : dec ? Number(dec[1]) : null;
  if (n !== null) {
    const e = IDL.errors.find((x) => x.code === n);
    if (e) return e.msg;
  }
  if (/User rejected/i.test(msg)) return "Transaction rejected in wallet";
  if (/insufficient (funds|lamports)|AccountNotFound|InsufficientFundsForFee/i.test(all)) {
    return "Insufficient SOL balance";
  }
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}
