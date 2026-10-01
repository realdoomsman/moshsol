"use client";

import {
  curveOf,
  fetchVenueState,
  MoshClient,
  pumpRefOf,
  seedKeyOf,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  tokenAta,
  splAta,
  type CurveState,
  type LaunchJson,
} from "@holdfast/sdk";
import { getMint } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { launchId, type LaunchRef } from "./launch";

/** What the launch-scoped chain hooks need: the id their queries are keyed by, the PDA seed and the token program. */
type ChainLaunch = LaunchRef & Pick<LaunchJson, "createKey">;

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

/** The wallet's token balance in base units (0 when the account does not exist yet); Token-2022 ATA on Holdfast launches, SPL Token on pump launches. */
export function useTokenBalance(l: ChainLaunch, owner: PublicKey | null) {
  const { connection } = useConnection();
  const address = owner?.toBase58() ?? null;
  const id = launchId(l);
  return useQuery({
    queryKey: ["token-balance", id, address],
    enabled: !!address && l.mint !== PublicKey.default.toBase58(),
    queryFn: async () => {
      const mint = new PublicKey(l.mint);
      const ata = l.venue === "pump" ? splAta(new PublicKey(address!), mint) : tokenAta(new PublicKey(address!), mint);
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

export function useBackerAccount(l: ChainLaunch, owner: PublicKey | null) {
  const client = useMoshClient();
  const address = owner?.toBase58() ?? null;
  return useQuery({
    queryKey: ["backer", launchId(l), address],
    enabled: !!address,
    queryFn: async (): Promise<BackerState | null> => {
      const b = await client.fetchBacker(seedKeyOf(l), new PublicKey(address!));
      return b ? { deposited: BigInt(b.deposited.toString()), feesClaimed: BigInt(b.feesClaimed.toString()) } : null;
    },
  });
}

/** Raw on-chain whitelist root (hex) — used to verify indexer-served member lists. */
export function useChainWhitelistRoot(l: ChainLaunch, enabled: boolean) {
  const client = useMoshClient();
  return useQuery({
    queryKey: ["launch-account", launchId(l), "whitelist"],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const account = await client.fetchLaunch(seedKeyOf(l));
      return account ? Buffer.from(account.whitelistRoot as number[]).toString("hex") : null;
    },
  });
}

/**
 * Why `wind_down` / `wind_down_pump` would fail right now (null = it would succeed), read from
 * chain: status, age, idle time and real token balances. Token transfers between wallets aren't
 * program events, so it polls.
 */
export function useWindDownBlocker(l: Pick<LaunchJson, "address" | "mint" | "venue" | "pump">, enabled: boolean) {
  const client = useMoshClient();
  return useQuery({
    queryKey: ["wind-down", launchId(l)],
    enabled,
    refetchInterval: 30_000,
    queryFn: () => client.windDownBlocker(l),
  });
}

/**
 * The reserves the launch trades against, as a `CurveState` for the SDK quotes: the Holdfast curve
 * straight from the snapshot, or (pump launches) the bonding curve / PumpSwap pool read from chain
 * and polled, so quotes track the venue between the public trades the indexer books. `undefined`
 * while that read is in flight, `null` when the venue account doesn't exist (yet).
 */
export function useVenueCurve(
  l: Pick<LaunchJson, "address" | "mint" | "venue" | "pump" | "virtualSol" | "realSol" | "tokenReserve">,
): CurveState | null | undefined {
  const { connection } = useConnection();
  const pump = l.venue === "pump";
  const venue = useQuery({
    queryKey: ["venue-curve", launchId(l), l.pump.graduated],
    enabled: pump,
    refetchInterval: 15_000,
    queryFn: async () => (await fetchVenueState(connection, pumpRefOf(l)))?.curve ?? null,
  });
  const { virtualSol, realSol, tokenReserve } = l;
  const own = useMemo(() => curveOf({ virtualSol, realSol, tokenReserve }), [virtualSol, realSol, tokenReserve]);
  return pump ? venue.data : own;
}

export interface MintFacts {
  supply: bigint;
  decimals: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

/** Supply and authorities of a launch's mint (Token-2022 on Holdfast launches, SPL Token on pump launches); `enabled` false while a pump launch has no mint yet. */
export function useMintFacts(l: Pick<LaunchJson, "mint" | "venue">, enabled = true) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["mint-facts", l.mint],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<MintFacts> => {
      const m = await getMint(connection, new PublicKey(l.mint), "confirmed", l.venue === "pump" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID);
      return {
        supply: m.supply,
        decimals: m.decimals,
        mintAuthority: m.mintAuthority?.toBase58() ?? null,
        freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
      };
    },
  });
}

/** Token balance of a program-owned token account (curve/venue/vault accounts on the verify card); null = no account to read yet. */
export function useTokenAccountAmount(id: string, address: string | null) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["launch-account", id, "token-amount", address],
    enabled: address !== null,
    queryFn: async () => {
      const bal = await connection.getTokenAccountBalance(new PublicKey(address!), "confirmed");
      return BigInt(bal.value.amount);
    },
  });
}
