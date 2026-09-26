import { PublicKey } from "@solana/web3.js";
import idl from "./idl/moshsol.json";

export const PROGRAM_ID = new PublicKey(idl.address);
export { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export const SEEDS = {
  platform: "platform",
  launch: "launch",
  curve: "curve",
  vault: "vault",
  backer: "backer",
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
  maxReserveBps: 8_000,
  maxProofLen: 24,
} as const;
