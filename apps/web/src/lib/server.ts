import { launchPda, PROGRAM_ID } from "@holdfast/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { cache } from "react";
import { ApiError, api } from "./api";
import { RPC_URL } from "./env";
import type { LaunchSummary } from "./types";

export type ServerLaunch =
  | { state: "found"; launch: LaunchSummary }
  | { state: "missing" }
  | { state: "unreachable" };

/** Launch id (mint or address) → PublicKey, or null for anything that isn't a 32-byte base58 key. */
export function parseMint(id: string): PublicKey | null {
  try {
    return new PublicKey(id);
  } catch {
    return null;
  }
}

/**
 * Launches whose pages don't exist on this site (`BLOCKED_LAUNCHES`, server-only: launch addresses and/or mints,
 * comma-separated) — impersonators of the Holdfast brand. Their page, metadata and share image 404.
 */
const BLOCKED = new Set((process.env.BLOCKED_LAUNCHES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
/** Ids the indexer flagged as brand impersonators during this process (so the on-chain fallback 404s them too). */
const IMPERSONATORS = new Set<string>();

export function isBlockedLaunch(...ids: (string | null | undefined)[]): boolean {
  return ids.some((id) => !!id && (BLOCKED.has(id) || IMPERSONATORS.has(id)));
}

/**
 * Indexer snapshot of a launch for server rendering (metadata, 404s, OG image, the page's query
 * cache). Deduped per request, so `generateMetadata` and the page share one fetch.
 */
export const loadLaunch = cache(async (id: string): Promise<ServerLaunch> => {
  if (isBlockedLaunch(id)) return { state: "missing" };
  try {
    const launch = await api.launch(id);
    // A raising pump launch has no mint yet (the default pubkey): never block by it.
    if (launch.impersonator) for (const k of [id, launch.address, launch.mint]) if (k !== PublicKey.default.toBase58()) IMPERSONATORS.add(k);
    return isBlockedLaunch(launch.address, launch.mint) ? { state: "missing" } : { state: "found", launch };
  } catch (e) {
    return e instanceof ApiError && e.status === 404 ? { state: "missing" } : { state: "unreachable" };
  }
});

/**
 * Whether the launch account exists on-chain (null when the RPC is unreachable). Lets a launch
 * that confirmed a moment ago render while the indexer catches up, instead of a 404. `id` is a
 * launch address (pump launches, the PDA itself) or a mint (Holdfast launches, the PDA's seed).
 * Blocked launches never count as existing.
 */
export const launchOnChain = cache(async (id: string): Promise<boolean | null> => {
  if (isBlockedLaunch(id)) return false;
  const key = parseMint(id);
  if (!key) return false;
  try {
    const infos = await new Connection(RPC_URL, "confirmed").getMultipleAccountsInfo([key, launchPda(key)]);
    return infos.some((info) => info !== null && info.owner.equals(PROGRAM_ID));
  } catch {
    return null;
  }
});
