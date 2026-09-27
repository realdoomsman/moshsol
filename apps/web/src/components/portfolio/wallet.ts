import { PublicKey } from "@solana/web3.js";

/** Canonical base58 wallet address, or null (shared by the lookup form and the server page). */
export function parseWallet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  try {
    return new PublicKey(v).toBase58() === v ? v : null;
  } catch {
    return null;
  }
}
