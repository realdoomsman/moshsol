"use client";

import { previewBundle, previewPumpBundle, type BundlePreview } from "@holdfast/sdk";
import { ACCOUNT_SIZE, ExtensionType, getMintLen } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { INDEXER_URL } from "@/lib/env";
// Static on /create: the rent preview needs the launch account size from the IDL on first render.
import { moshClient } from "@/lib/program";
import type { PlatformInfo } from "@/lib/types";
import { previewLamports, utf8Len, type CreateDraft } from "./validate";

/**
 * Transaction fee headroom on top of rent + create fee: base fees for the creator and mint signatures
 * (2 × 5,000 lamports) plus the priority fee at the floor for create_launch's ~100k compute limit.
 */
export const TX_FEE_LAMPORTS = 20_000n;

export interface BundleRange {
  lo: bigint;
  hi: bigint;
  atMin: BundlePreview;
  atMax: BundlePreview;
  /** At the max raise the bundle is capped by `bundlePct`; the rest of the SOL stays in the vault. */
  cappedAtMax: boolean;
}

/**
 * The `launch` / `launch_pump` instruction's bundle buy at the minimum and maximum raise
 * (`previewBundle` / `previewPumpBundle` mirror the program math exactly; new launches are pump.fun
 * tokens unless the platform still allows the Holdfast curve). Null until min/max parse and
 * platform params are loaded.
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
  const run = (raised: bigint) => {
    const terms = { raised, launchFeeBps: params.launchFeeBps, reserveBps: Math.round(d.reservePct * 100), bundleSupplyBps };
    return params.holdfastCurveEnabled ? previewBundle({ ...terms, virtualSol: BigInt(params.virtualSolReserves) }) : previewPumpBundle(terms);
  };
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
 * What creating costs the creator: the platform create fee, rent for the launch account and (Holdfast
 * curve launches only; a pump launch creates its token at launch, paid from the raise) the mint
 * (with on-mint metadata) and the curve/vault token accounts, plus a network-fee allowance. Rent is
 * `(len + 128) * 3480 * 2` lamports on every cluster, so it's computed locally rather than spending
 * public-RPC quota on getMinimumBalanceForRentExemption.
 */
export function useCreateCost(name: string, symbol: string, params: PlatformInfo["params"] | undefined): CreateCost {
  const { connection } = useConnection();
  const launchSize = moshClient(connection).program.account.launch.size;
  const nameLen = Math.max(utf8Len(name.trim()), 1);
  const symbolLen = Math.max(utf8Len(symbol.trim()), 1);
  const rent = useMemo(() => {
    // The metadata URI is only known after upload; the indexer issues `${INDEXER_URL}/files/meta/<id>.json`.
    const uriLen = `${INDEXER_URL}/files/meta/`.length + 40;
    const metadataLen = 4 + 32 + 32 + 4 * 4 + nameLen + symbolLen + uriLen;
    const sizes = params?.holdfastCurveEnabled
      ? [launchSize, getMintLen([ExtensionType.MetadataPointer]) + metadataLen, ACCOUNT_SIZE, ACCOUNT_SIZE]
      : [launchSize];
    return sizes.reduce((sum, len) => sum + BigInt((len + 128) * 3480 * 2), 0n);
  }, [launchSize, nameLen, symbolLen, params?.holdfastCurveEnabled]);
  const createFee = params ? BigInt(params.createFeeLamports) : null;
  return { createFee, rent, network: TX_FEE_LAMPORTS, total: createFee !== null ? rent + createFee + TX_FEE_LAMPORTS : null };
}
