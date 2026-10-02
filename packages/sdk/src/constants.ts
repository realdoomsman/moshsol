import { PublicKey } from "@solana/web3.js";
import type { Moshsol } from "./idl/moshsol";

/**
 * The program address, typed as the IDL's literal address so a re-synced IDL (`pnpm sync-idl`) for
 * another deployment fails the typecheck until this is updated. A literal, not `idl.address`, so the
 * constant doesn't pull the whole IDL JSON into every bundle that shows the address.
 */
const PROGRAM_ADDRESS: Moshsol["address"] = "EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ";

export const PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);
export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export const SEEDS = {
  platform: "platform",
  launch: "launch",
  curve: "curve",
  vault: "vault",
  backer: "backer",
  pumpAuthority: "pump-authority",
} as const;

export const TOKEN_DECIMALS = 6;
export const TOKEN_UNIT = 1_000_000n;
export const TOTAL_SUPPLY = 1_000_000_000n * TOKEN_UNIT;
export const LAMPORTS_PER_SOL_BIG = 1_000_000_000n;
export const BPS = 10_000n;
export const ACC_PRECISION = 1_000_000_000_000_000_000n;
export const Q64 = 1n << 64n;

// Mirrors of the on-chain hard limits (programs/moshsol/src/constants.rs).
export const LIMITS = {
  maxNameLen: 32,
  maxSymbolLen: 10,
  maxUriLen: 200,
  minRaiseDurationSecs: 60,
  maxRaiseDurationSecs: 14 * 86_400,
  minBundleSupplyBps: 100,
  /** `MAX_BUNDLE_SUPPLY_BPS`: no platform may let a bundle buy more than 75% of supply. */
  maxBundleSupplyBps: 7_500,
  maxReserveBps: 8_000,
  maxProofLen: 24,
  maxRaiseLamports: 100_000n * 1_000_000_000n,
  maxBurnShareBps: 5_000,
  maxCreatorFeeVaultBps: 9_000,
  minPayoutMultBps: 10_000,
  maxPayoutShareBps: 5_000,
  minPayoutIntervalSecs: 3_600,
  maxDeadHoldersBps: 2_000,
  minMinVaultSol: 50_000_000n,
} as const;

/** Default payback terms (programs/moshsol/src/constants.rs); what `migrate_*` backfills. */
export const PAYBACK_DEFAULTS = {
  burnShareBps: 1_500,
  creatorFeeVaultBps: 7_500,
  payoutMultBps: 50_000,
  payoutShareBps: 1_500,
  payoutIntervalSecs: 14_400,
  deadHoldersBps: 500,
  minVaultSol: 100_000_000n,
} as const;

/** `buyback_burn` guards (programs/moshsol/src/constants.rs). */
export const BUYBACK = {
  minLamports: 1_000_000n,
  maxVenueBps: 500,
  minIntervalSecs: 60,
  minFillBps: 9_700,
} as const;

/**
 * The venue's taker fee on both pump.fun (protocol 95 + creator 30 bps) and PumpSwap (lp 2 +
 * protocol 93 + creator 30 bps), from their fee configs (`tests/program/fixtures/*_fee_config.json`).
 * What `quoteBuy` / `quoteSell` take as `tradeFeeBps` for a pump launch's venue.
 */
export const PUMP_VENUE_FEE_BPS = 125;

/** `wind_down` opens once a launch has been live this long… */
export const WIND_DOWN_MIN_AGE_SECS = 3 * 86_400;
/** …and saw no vault trade for this long (plus at most `terms.deadHoldersBps` of supply outside the venue and vault). */
export const WIND_DOWN_IDLE_SECS = 86_400;
