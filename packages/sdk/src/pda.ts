import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PROGRAM_ID, SEEDS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants";

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

/**
 * Idempotent create of `owner`'s associated token account for a launch mint under its venue's token
 * program (Token-2022 on Holdfast launches, SPL Token on pump launches), rent paid by `payer`.
 */
export function createLaunchAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey, venue: "holdfast" | "pump"): TransactionInstruction {
  const program = venue === "pump" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const ata = getAssociatedTokenAddressSync(mint, owner, true, program);
  return createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, program);
}
