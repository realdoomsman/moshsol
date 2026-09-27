import { PROGRAM_ID } from "@holdfast/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "@/lib/env";

/**
 * On-chain facts for the proof tiles (§4.2 §6), read straight from the cluster on the server: the
 * program's upgrade authority (from its ProgramData account) and an example mint's authorities.
 * Cached for five minutes; a slow or failing RPC leaves the fact `unknown` (the tile says so).
 */

export type Fact<T> = { state: "known"; value: T } | { state: "unknown" };

export interface ChainFacts {
  programData: Fact<string>;
  /** null = no upgrade authority (immutable). */
  upgradeAuthority: Fact<string | null>;
  mint: Fact<{ address: string; mintAuthority: string | null; freezeAuthority: string | null; supply: string }> | null;
}

const TTL_MS = 5 * 60_000;
const DEADLINE_MS = 2_000;
const cache = new Map<string, { at: number; facts: Promise<ChainFacts> }>();

function withDeadline<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("rpc deadline")), DEADLINE_MS))]);
}

async function load(exampleMint: string | null): Promise<ChainFacts> {
  const conn = new Connection(RPC_URL, "confirmed");
  const program = withDeadline(conn.getParsedAccountInfo(PROGRAM_ID)).catch(() => null);
  const mint = exampleMint ? withDeadline(conn.getParsedAccountInfo(new PublicKey(exampleMint))).catch(() => null) : null;

  let programData: Fact<string> = { state: "unknown" };
  let upgradeAuthority: Fact<string | null> = { state: "unknown" };
  const programInfo = await program;
  const pd = (programInfo?.value?.data as { parsed?: { info?: { programData?: string } } } | undefined)?.parsed?.info?.programData;
  if (pd) {
    programData = { state: "known", value: pd };
    // ProgramData layout: u32 tag, u64 slot, Option<Pubkey> authority (1 + 32 bytes).
    const raw = await withDeadline(conn.getAccountInfo(new PublicKey(pd), { dataSlice: { offset: 0, length: 45 } })).catch(() => null);
    if (raw && raw.data.length >= 13) {
      upgradeAuthority = {
        state: "known",
        value: raw.data[12] === 1 ? new PublicKey(raw.data.subarray(13, 45)).toBase58() : null,
      };
    }
  }

  let mintFact: ChainFacts["mint"] = null;
  if (exampleMint) {
    const info = await mint;
    const parsed = (info?.value?.data as { parsed?: { info?: { mintAuthority: string | null; freezeAuthority: string | null; supply: string } } } | undefined)
      ?.parsed?.info;
    mintFact = parsed
      ? {
          state: "known",
          value: { address: exampleMint, mintAuthority: parsed.mintAuthority, freezeAuthority: parsed.freezeAuthority, supply: parsed.supply },
        }
      : { state: "unknown" };
  }
  return { programData, upgradeAuthority, mint: mintFact };
}

export function loadChainFacts(exampleMint: string | null): Promise<ChainFacts> {
  const key = exampleMint ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.facts;
  const facts = load(exampleMint);
  cache.set(key, { at: Date.now(), facts });
  // Don't pin a result that learned nothing: the next request retries.
  void facts.then((f) => {
    if (f.upgradeAuthority.state === "unknown") cache.delete(key);
  });
  return facts;
}
