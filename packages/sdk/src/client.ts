import { AnchorProvider, BN, BorshCoder, EventParser, Program, type Provider, type Wallet } from "@coral-xyz/anchor";
import { getTokenMetadata, TOKEN_PROGRAM_ID, unpackAccount, unpackMint } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, type TransactionInstruction } from "@solana/web3.js";
import { IDL, type BackerAccount, type LaunchAccount, type LaunchTermsAccount, type Moshsol, type MoshEvent, type PlatformAccount, type PlatformParams } from "./program";
import { AGENT_EXECUTOR_SLOTS, ASSOCIATED_TOKEN_PROGRAM_ID, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants";
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
import {
  launchToJson,
  windDownTimingBlocker,
  type LaunchJson,
  type PumpLaunchRef,
  type TermsLike,
  type WindDownBlocker,
} from "./launch";

/**
 * Platform params a creator reviewed: the on-chain `PlatformParams` (u64 as BN) or the indexer's
 * JSON (u64 as strings). `create_launch` fails with `TermsChanged` if the chain differs.
 */
export type ReviewedTerms = TermsLike & {
  virtualSolReserves: { toString(): string };
  createFeeLamports: { toString(): string };
};

/** The terms a pump launch freezes from platform params (`LaunchTerms::pump`): no trade-fee split, creator share 0. */
export function pumpTermsOf(t: TermsLike): LaunchTermsAccount {
  return { ...termsOf(t), tradeFeeBps: 0, backerFeeShareBps: 0, creatorFeeShareBps: 0 };
}

/** The platform's registered agent wallets (`agentExecutors` without the unset slots), in slot order. */
export function agentExecutorsOf(p: Pick<PlatformAccount, "agentExecutors">): PublicKey[] {
  return p.agentExecutors.filter((k) => !k.equals(PublicKey.default));
}

/** Exactly the `LaunchTerms` fields of a params/terms object (what `create_launch*` compare on chain). */
export function termsOf(t: TermsLike): LaunchTermsAccount {
  return {
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
    creatorFeeVaultBps: t.creatorFeeVaultBps,
    payoutMultBps: t.payoutMultBps,
    payoutShareBps: t.payoutShareBps,
    payoutIntervalSecs: t.payoutIntervalSecs,
    deadHoldersBps: t.deadHoldersBps,
    minVaultSol: new BN(t.minVaultSol.toString()),
  };
}

function decodeBondingCurveCreator(info: { data: Buffer } | null): PublicKey {
  if (!info) throw new Error("buyback mint has no pump.fun bonding curve");
  return decodeBondingCurve(info.data).creator;
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
   * launch, its mint supply and the venue/vault token balances (the program's dead-launch rule:
   * `supply − (venue + vault) ≤ terms.deadHoldersBps` of supply, the venue being the Holdfast curve,
   * the pump.fun bonding curve or the PumpSwap pool). null = eligible.
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
    const outside = supply - held;
    return outside <= (supply * BigInt(fresh.terms.deadHoldersBps)) / 10_000n ? null : "outsideHolders";
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

  /** Admin only: sets, rotates or (`PublicKey.default`) disables the dev key that may `devWithdrawVaultIx`. */
  async setDevAuthorityIx(admin: PublicKey, devAuthority: PublicKey) {
    return this.program.methods
      .setDevAuthority(devAuthority)
      .accountsStrict({ admin, platform: platformPda(this.programId) })
      .instruction();
  }

  /**
   * Admin only: sets the platform's agent wallets (at most 15; the rest of the slots stay unset).
   * Once any is set, every `agent_buy_pump` / `agent_sell_pump` must go through one (`executor`);
   * an empty list unsets them (the pump authority trades itself again).
   */
  async setAgentExecutorsIx(admin: PublicKey, executors: PublicKey[]) {
    if (executors.length > AGENT_EXECUTOR_SLOTS) throw new Error(`at most ${AGENT_EXECUTOR_SLOTS} agent wallets`);
    const seen = new Set<string>();
    for (const k of executors) {
      if (k.equals(PublicKey.default) || seen.has(k.toBase58())) throw new Error(`invalid or duplicate agent wallet ${k.toBase58()}`);
      seen.add(k.toBase58());
    }
    const slots = [...executors, ...Array<PublicKey>(AGENT_EXECUTOR_SLOTS - executors.length).fill(PublicKey.default)];
    return this.program.methods
      .setAgentExecutors(slots)
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
        expectedTerms: termsOf(t),
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

  /** Venue accounts of a pump launch's trade, for its current venue; `user` = the agent wallet when one trades. */
  private async venueAccounts(l: PumpLaunchRef, user?: PublicKey) {
    const cfg = await fetchPumpConfig(this.connection);
    return l.graduated
      ? poolVenueAccounts({ mint: l.mint, coinCreator: l.address, launch: l.address, user, config: cfg, programId: this.programId })
      : curveVenueAccounts({ mint: l.mint, creator: l.address, launch: l.address, user, config: cfg, programId: this.programId });
  }

  private pumpAgentAccounts(agent: PublicKey, l: PumpLaunchRef, executor: PublicKey | null) {
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
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      executor,
      executorTokens: executor ? splAta(executor, l.mint) : null,
    };
  }

  /**
   * Agent authority only. `executor` = one of `platform.agentExecutors` (required once any is set; it
   * must sign too): the agent wallet the trade goes through. `null` = the pump authority trades (only
   * while no agent wallet is set).
   */
  async agentBuyPumpIx(agent: PublicKey, l: PumpLaunchRef, solIn: bigint, minTokensOut: bigint, executor: PublicKey | null) {
    return this.program.methods
      .agentBuyPump(bn(solIn), bn(minTokensOut))
      .accountsStrict(this.pumpAgentAccounts(agent, l, executor))
      .remainingAccounts(await this.venueAccounts(l, executor ?? undefined))
      .instruction();
  }

  /** Agent authority only; `executor` as in `agentBuyPumpIx`. */
  async agentSellPumpIx(agent: PublicKey, l: PumpLaunchRef, tokensIn: bigint, minSolOut: bigint, executor: PublicKey | null) {
    return this.program.methods
      .agentSellPump(bn(tokensIn), bn(minSolOut))
      .accountsStrict(this.pumpAgentAccounts(agent, l, executor))
      .remainingAccounts(await this.venueAccounts(l, executor ?? undefined))
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

  /** Admin only, once after a layout upgrade: grows the platform account to the current layout. */
  async migratePlatformIx(admin: PublicKey) {
    return this.program.methods
      .migratePlatform()
      .accountsStrict({ admin, platform: platformPda(this.programId), systemProgram: SystemProgram.programId })
      .instruction();
  }

  /**
   * Admin only, once per pre-payback launch after the upgrade: grows it to the current layout.
   * `initialVaultSol` (bundle + reserve at launch, `bundleSol + vaultSol` of the `Launched` event) is
   * only used for launched pump launches; the program derives it for Holdfast launches (raise − launch
   * fee) and zeroes it for unlaunched ones.
   */
  async migrateLaunchIx(admin: PublicKey, launch: PublicKey, initialVaultSol: bigint) {
    return this.program.methods
      .migrateLaunch(bn(initialVaultSol))
      .accountsStrict({ admin, platform: platformPda(this.programId), launch, systemProgram: SystemProgram.programId })
      .instruction();
  }

  /**
   * Agent-authority crank: pays backers (principal once liquid vault SOL reaches the payback target,
   * then a dividend per interval) — see `payoutStatus` for when it would pass. `agent` defaults to
   * the platform's agent authority.
   */
  async payoutBackersIx(launch: PublicKey, agent?: PublicKey) {
    if (!agent) {
      const platform = await this.fetchPlatform();
      if (!platform) throw new Error("Platform is not initialized");
      agent = platform.agentAuthority;
    }
    return this.program.methods
      .payoutBackers()
      .accountsStrict({ agent, platform: platformPda(this.programId), launch })
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

  /**
   * The platform's dev key only (`platform.devAuthority`, signer and fee payer): sends `sol` lamports of
   * vault SOL to `dev` itself and `tokens` base units of vault tokens to `dev`'s ATA for the mint under
   * the launch's token program (`splAta(dev, mint)` on pump launches, `tokenAta(dev, mint)` on Holdfast
   * launches), which must exist: put a create-idempotent instruction for it in the same transaction.
   * Not blocked by `paused` / `agents_paused`; emits `VaultWithdrawnByDev`.
   */
  async devWithdrawVaultIx(dev: PublicKey, l: Pick<LaunchJson, "address" | "mint" | "venue">, sol: bigint, tokens: bigint) {
    const launch = new PublicKey(l.address);
    const mint = new PublicKey(l.mint);
    const pump = l.venue === "pump";
    const authority = pump ? pumpAuthorityPda(launch, this.programId) : launch;
    return this.program.methods
      .devWithdrawVault(bn(sol), bn(tokens))
      .accountsStrict({
        dev,
        platform: platformPda(this.programId),
        launch,
        mint,
        vaultTokens: pump ? splAta(authority, mint) : vaultPda(launch, this.programId),
        recipientTokens: pump ? splAta(dev, mint) : tokenAta(dev, mint),
        tokenAuthority: authority,
        tokenProgram: pump ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }
}

