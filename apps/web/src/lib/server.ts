import { launchPda } from "@moshsol/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { cache } from "react";
import { ApiError, api } from "./api";
import { RPC_URL } from "./env";
import type { LaunchSummary } from "./types";

export type ServerLaunch =
  | { state: "found"; launch: LaunchSummary }
  | { state: "missing" }
  | { state: "unreachable" };

/** Mint string → PublicKey, or null for anything that isn't a 32-byte base58 key. */
export function parseMint(mint: string): PublicKey | null {
  try {
    return new PublicKey(mint);
  } catch {
    return null;
  }
}

/**
 * Indexer snapshot of a launch for server rendering (metadata, 404s, OG image, the page's query
 * cache). Deduped per request, so `generateMetadata` and the page share one fetch.
 */
export const loadLaunch = cache(async (mint: string): Promise<ServerLaunch> => {
  try {
    return { state: "found", launch: await api.launch(mint) };
  } catch (e) {
    return e instanceof ApiError && e.status === 404 ? { state: "missing" } : { state: "unreachable" };
  }
});

/**
 * Whether the launch account exists on-chain (null when the RPC is unreachable). Lets a launch
 * that confirmed a moment ago render while the indexer catches up, instead of a 404.
 */
export const launchOnChain = cache(async (mint: string): Promise<boolean | null> => {
  const key = parseMint(mint);
  if (!key) return false;
  try {
    const info = await new Connection(RPC_URL, "confirmed").getAccountInfo(launchPda(key));
    return info !== null;
  } catch {
    return null;
  }
});
