import type { LaunchJson } from "@moshsol/sdk";

/** Wire types of the indexer HTTP/WS API (see the shared contract). */

export interface LaunchSummary extends LaunchJson {
  name: string;
  symbol: string;
  uri: string;
  image: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  whitelist: string[] | null;
  change24h: number | null;
  volume24hSol: number;
  lastTradeAt: number | null;
  holders: number;
}

export interface TradeRow {
  signature: string;
  slot: number;
  timestamp: number;
  trader: string;
  isBuy: boolean;
  isAgent: boolean;
  solAmount: string;
  tokenAmount: string;
  fee: string;
  priceSol: number;
  emaSol: number;
  vaultSol: string;
  vaultTokens: string;
  realSol: string;
  tokenReserve: string;
}

export type ActivityType =
  | "trade"
  | "deposit"
  | "launch_created"
  | "launched"
  | "refund"
  | "cancelled"
  | "backer_claim"
  | "creator_claim";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  signature: string;
  timestamp: number;
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  actor: string;
  isAgent?: boolean;
  isBuy?: boolean;
  solAmount?: string;
  tokenAmount?: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSol: number;
}

export interface HolderRow {
  owner: string;
  amount: string;
  pct: number;
  label: "curve" | "vault" | null;
}

export type WsMessage = { type: "event"; event: ActivityEvent } | { type: "launch"; launch: LaunchSummary };
