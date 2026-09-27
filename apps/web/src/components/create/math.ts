"use client";

import { previewBundle, type BundlePreview } from "@holdfast/sdk";
import { ACCOUNT_SIZE, ExtensionType, getMintLen } from "@solana/spl-token";
import { useMemo } from "react";
import { useMoshClient } from "@/lib/chain";
import { INDEXER_URL } from "@/lib/env";
import type { PlatformInfo } from "@/lib/types";
import { previewLamports, utf8Len, type CreateDraft } from "./validate";

/** Transaction fee headroom on top of rent + create fee. */
export const TX_FEE_LAMPORTS = 10_000n;

export interface BundleRange {
  lo: bigint;
  hi: bigint;
  atMin: BundlePreview;
  atMax: BundlePreview;
  /** At the max raise the bundle is capped by `bundlePct`; the rest of the SOL stays in the vault. */
  cappedAtMax: boolean;
}

/**
 * The `launch` instruction's bundle buy at the minimum and maximum raise (`previewBundle` mirrors
 * the program math exactly). Null until min/max parse and platform params are loaded.
 */
export function bundleRange(
  params: PlatformInfo["params"] | undefined,
  d: Pick<CreateDraft, "raiseMin" | "raiseMax" | "bundlePct" | "reservePct">,
): BundleRange | null {
  if (!params) return null;
  const lo = previewLamports(d.raiseMin);
  const hi = previewLamports(d.raiseMax);
  if (lo === null || hi === null || hi < lo) return null;
  const bundleSupplyBps = Math.round(d.bundlePct * 100);
  const run = (raised: bigint) =>
    previewBundle({
      raised,
      virtualSol: BigInt(params.virtualSolReserves),
      launchFeeBps: params.launchFeeBps,
      reserveBps: Math.round(d.reservePct * 100),
      bundleSupplyBps,
    });
  const atMax = run(hi);
  return { lo, hi, atMin: run(lo), atMax, cappedAtMax: Math.round(atMax.supplyPct * 100) >= bundleSupplyBps };
}

export interface CreateCost {
  createFee: bigint | null;
  rent: bigint;
  network: bigint;
  total: bigint | null;
}

/**
 * What creating costs the creator: the platform create fee, rent for the launch account, the mint
 * (with on-mint metadata) and the curve/vault token accounts, plus a network-fee allowance. Rent is
 * `(len + 128) * 3480 * 2` lamports on every cluster, so it's computed locally rather than spending
 * public-RPC quota on getMinimumBalanceForRentExemption.
 */
export function useCreateCost(name: string, symbol: string, params: PlatformInfo["params"] | undefined): CreateCost {
  const client = useMoshClient();
  const nameLen = Math.max(utf8Len(name.trim()), 1);
  const symbolLen = Math.max(utf8Len(symbol.trim()), 1);
  const rent = useMemo(() => {
    // The metadata URI is only known after upload; the indexer issues `${INDEXER_URL}/files/meta/<id>.json`.
    const uriLen = `${INDEXER_URL}/files/meta/`.length + 40;
    const metadataLen = 4 + 32 + 32 + 4 * 4 + nameLen + symbolLen + uriLen;
    const sizes = [
      client.program.account.launch.size,
      getMintLen([ExtensionType.MetadataPointer]) + metadataLen,
      ACCOUNT_SIZE,
      ACCOUNT_SIZE,
    ];
    return sizes.reduce((sum, len) => sum + BigInt((len + 128) * 3480 * 2), 0n);
  }, [client, nameLen, symbolLen]);
  const createFee = params ? BigInt(params.createFeeLamports) : null;
  return { createFee, rent, network: TX_FEE_LAMPORTS, total: createFee !== null ? rent + createFee + TX_FEE_LAMPORTS : null };
}
