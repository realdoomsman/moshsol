import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PROGRAM_ID, SEEDS, TOKEN_2022_PROGRAM_ID } from "./constants";

const enc = (s: string) => Buffer.from(s, "utf8");

export function platformPda(programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc(SEEDS.platform)], programId)[0];
}

export function launchPda(mint: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc(SEEDS.launch), mint.toBuffer()], programId)[0];
}

export function curvePda(launch: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc(SEEDS.curve), launch.toBuffer()], programId)[0];
}

export function vaultPda(launch: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc(SEEDS.vault), launch.toBuffer()], programId)[0];
}

export function backerPda(launch: PublicKey, owner: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc(SEEDS.backer), launch.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

/** Token-2022 associated token account for a launch mint. */
export function tokenAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
}
