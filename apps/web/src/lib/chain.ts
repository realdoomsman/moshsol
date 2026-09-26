"use client";

import { MoshClient, TOKEN_2022_PROGRAM_ID, tokenAta } from "@moshsol/sdk";
import { getMint } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

/** Read-only program client (instruction builders need no wallet). */
export function useMoshClient(): MoshClient {
  const { connection } = useConnection();
  return useMemo(() => new MoshClient(connection), [connection]);
}

/** Lamport balance kept live through an account subscription. */
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

/** Token-2022 ATA balance in base units (0 when the account does not exist yet). */
export function useTokenBalance(mint: string, owner: PublicKey | null) {
  const { connection } = useConnection();
  const address = owner?.toBase58() ?? null;
  return useQuery({
    queryKey: ["token-balance", mint, address],
    enabled: !!address,
    queryFn: async () => {
      const ata = tokenAta(new PublicKey(address!), new PublicKey(mint));
      const info = await connection.getAccountInfo(ata, "confirmed");
      if (!info) return 0n;
      const bal = await connection.getTokenAccountBalance(ata, "confirmed");
      return BigInt(bal.value.amount);
    },
  });
}

export interface BackerState {
  deposited: bigint;
  feesClaimed: bigint;
}

export function useBackerAccount(mint: string, owner: PublicKey | null) {
  const client = useMoshClient();
  const address = owner?.toBase58() ?? null;
  return useQuery({
    queryKey: ["backer", mint, address],
    enabled: !!address,
    queryFn: async (): Promise<BackerState | null> => {
      const b = await client.fetchBacker(new PublicKey(mint), new PublicKey(address!));
      return b ? { deposited: BigInt(b.deposited.toString()), feesClaimed: BigInt(b.feesClaimed.toString()) } : null;
    },
  });
}

/** Raw on-chain whitelist root (hex) — used to verify indexer-served member lists. */
export function useChainWhitelistRoot(mint: string, enabled: boolean) {
  const client = useMoshClient();
  return useQuery({
    queryKey: ["launch-account", mint, "whitelist"],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const l = await client.fetchLaunch(new PublicKey(mint));
      return l ? Buffer.from(l.whitelistRoot as number[]).toString("hex") : null;
    },
  });
}

export interface MintFacts {
  supply: bigint;
  decimals: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export function useMintFacts(mint: string) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["mint-facts", mint],
    staleTime: 60_000,
    queryFn: async (): Promise<MintFacts> => {
      const m = await getMint(connection, new PublicKey(mint), "confirmed", TOKEN_2022_PROGRAM_ID);
      return {
        supply: m.supply,
        decimals: m.decimals,
        mintAuthority: m.mintAuthority?.toBase58() ?? null,
        freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
      };
    },
  });
}

/** Token balance of a program-owned token account (curve/vault PDAs on the verify card). */
export function useTokenAccountAmount(mint: string, address: string) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["launch-account", mint, "token-amount", address],
    queryFn: async () => {
      const bal = await connection.getTokenAccountBalance(new PublicKey(address), "confirmed");
      return BigInt(bal.value.amount);
    },
  });
}
