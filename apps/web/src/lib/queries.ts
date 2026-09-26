"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, api, type LaunchFilter, type LaunchSort, type Timeframe } from "./api";
import { useFallbackInterval } from "./live";

export function usePlatform() {
  return useQuery({ queryKey: ["platform"], queryFn: api.platform, staleTime: 60_000 });
}

export function useStats() {
  const interval = useFallbackInterval(10_000);
  return useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: interval });
}

export function useLaunches(p: { status: LaunchFilter; sort: LaunchSort; q?: string }) {
  const interval = useFallbackInterval(8_000);
  return useQuery({
    queryKey: ["launches", p.status, p.sort, p.q ?? ""],
    queryFn: () => api.launches({ ...p, limit: 200 }),
    refetchInterval: interval,
    placeholderData: (prev) => prev,
  });
}

/** Launch summary. Retries 404s briefly: a launch created seconds ago may not be indexed yet. */
export function useLaunch(mint: string) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    queryKey: ["launch", mint],
    queryFn: () => api.launch(mint),
    refetchInterval: (q) => (q.state.error instanceof ApiError && q.state.error.status === 404 ? 1_500 : interval),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });
}

export function useTrades(mint: string, limit = 100, enabled = true) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    queryKey: ["trades", mint, limit],
    queryFn: () => api.trades(mint, limit),
    refetchInterval: interval,
    enabled,
  });
}

export function useCandles(mint: string, tf: Timeframe, enabled = true) {
  const interval = useFallbackInterval(5_000);
  return useQuery({
    queryKey: ["candles", mint, tf],
    queryFn: () => api.candles(mint, tf),
    refetchInterval: interval,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useBackers(mint: string) {
  const interval = useFallbackInterval(8_000);
  return useQuery({ queryKey: ["backers", mint], queryFn: () => api.backers(mint), refetchInterval: interval });
}

export function useDeposits(mint: string) {
  const interval = useFallbackInterval(8_000);
  return useQuery({ queryKey: ["deposits", mint], queryFn: () => api.deposits(mint), refetchInterval: interval });
}

export function useHolders(mint: string, enabled = true) {
  const interval = useFallbackInterval(10_000);
  return useQuery({
    queryKey: ["holders", mint],
    queryFn: () => api.holders(mint),
    refetchInterval: interval,
    enabled,
  });
}

export function usePortfolio(wallet: string | null) {
  const interval = useFallbackInterval(8_000);
  return useQuery({
    queryKey: ["portfolio", wallet],
    queryFn: () => api.portfolio(wallet!),
    enabled: !!wallet,
    refetchInterval: interval,
  });
}

export function useActivity() {
  const interval = useFallbackInterval(5_000);
  return useQuery({ queryKey: ["activity"], queryFn: () => api.activity(40), refetchInterval: interval });
}

export function useAgents() {
  const interval = useFallbackInterval(8_000);
  return useQuery({ queryKey: ["agents"], queryFn: api.agents, refetchInterval: interval });
}

export function useAgentStatus() {
  return useQuery({
    queryKey: ["agent-status"],
    queryFn: api.agentStatus,
    refetchInterval: 4_000,
    retry: false,
  });
}
