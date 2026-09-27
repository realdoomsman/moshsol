"use client";

import { CLUSTER, CLUSTER_LABEL } from "@/lib/env";
import { useIndexerStatus } from "@/lib/status";
import { StatusDot } from "../ui/chip";
import { cn } from "../ui/cn";

/** Hero eyebrow (§4.2 §1): "● Live on Solana devnet", the dot coloured by indexer health. */
export function LiveEyebrow({ className }: { className?: string }) {
  const status = useIndexerStatus();
  return (
    <p className={cn("label inline-flex items-center gap-2 text-ink-3", className)}>
      <StatusDot tone={status.tone} />
      {CLUSTER === "mainnet-beta" ? "Live on Solana" : `Live on Solana ${CLUSTER_LABEL[CLUSTER].toLowerCase()}`}
    </p>
  );
}
