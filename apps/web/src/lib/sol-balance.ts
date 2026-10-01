"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Lamport balance kept live through an account subscription. Apart from `./chain` (SPL Token and
 * pump.fun decoders) because the wallet button in every page's header shows it.
 */
export function useSolBalance(owner: PublicKey | null) {
  const { connection } = useConnection();
  const qc = useQueryClient();
  const address = owner?.toBase58() ?? null;
  useEffect(() => {
    if (!address) return;
    const id = connection.onAccountChange(
      new PublicKey(address),
      (acc) => qc.setQueryData(["sol", address], BigInt(acc.lamports)),
      { commitment: "confirmed" },
    );
    return () => {
      void connection.removeAccountChangeListener(id);
    };
  }, [address, connection, qc]);
  return useQuery({
    queryKey: ["sol", address],
    enabled: !!address,
    queryFn: async () => BigInt(await connection.getBalance(new PublicKey(address!), "confirmed")),
    refetchInterval: 20_000,
  });
}
