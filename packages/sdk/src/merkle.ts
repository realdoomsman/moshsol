import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";

/** Sorted-pair sha256 merkle tree matching `math::verify_merkle` on-chain. */

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compare(a, b) <= 0 ? [a, b] : [b, a];
  const buf = new Uint8Array(64);
  buf.set(lo, 0);
  buf.set(hi, 32);
  return sha256(buf);
}

export function whitelistLeaf(owner: PublicKey): Uint8Array {
  return sha256(owner.toBytes());
}

export interface Whitelist {
  root: number[];
  /** Returns the proof for `owner`, or null if not on the list. */
  proof(owner: PublicKey): number[][] | null;
  members: string[];
}

export function buildWhitelist(owners: PublicKey[]): Whitelist {
  const unique = [...new Map(owners.map((o) => [o.toBase58(), o])).values()];
  if (unique.length === 0) throw new Error("whitelist is empty");
  const leaves = unique.map(whitelistLeaf);
  const proofs: Uint8Array[][] = unique.map(() => []);
  const positions = unique.map((_, i) => i);
  let level = leaves;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    }
    positions.forEach((pos, leafIdx) => {
      const sib = pos ^ 1;
      if (sib < level.length) proofs[leafIdx]!.push(level[sib]!);
      positions[leafIdx] = pos >> 1;
    });
    level = next;
  }
  const index = new Map(unique.map((o, i) => [o.toBase58(), i]));
  return {
    root: Array.from(level[0]!),
    members: unique.map((o) => o.toBase58()),
    proof(owner) {
      const i = index.get(owner.toBase58());
      return i === undefined ? null : proofs[i]!.map((p) => Array.from(p));
    },
  };
}

export const OPEN_WHITELIST_ROOT: number[] = new Array(32).fill(0);
