import type { LaunchJson, LaunchStatus } from "@moshsol/sdk";

/** Shapes served by apps/indexer (see shared contract). Lamport/base-unit amounts are decimal strings. */

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

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSol: number;
}

export interface BackerRow {
  owner: string;
  deposited: string;
  feesClaimed: string;
  claimable: string;
  shareBps: number;
}

export interface DepositRow {
  signature: string;
  timestamp: number;
  backer: string;
  amount: string;
  raised: string;
}

export interface HolderRow {
  owner: string;
  amount: string;
  pct: number;
  label: "curve" | "vault" | null;
}

export interface PortfolioBacked {
  launch: LaunchSummary;
  deposited: string;
  feesClaimed: string;
  claimable: string;
  shareBps: number;
  vaultShareSol: number;
  vaultShareTokens: number;
  refundable: boolean;
}

export interface PortfolioCreated {
  launch: LaunchSummary;
  creatorFeesUnclaimed: string;
  creatorFeesClaimed: string;
}

export interface PortfolioHolding {
  launch: LaunchSummary;
  amount: string;
  valueSol: number;
}

export interface Portfolio {
  backed: PortfolioBacked[];
  created: PortfolioCreated[];
  holdings: PortfolioHolding[];
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
  id: string | number;
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

export interface PlatformStats {
  totalLaunches: number;
  liveLaunches: number;
  raisingLaunches: number;
  totalRaisedSol: number;
  totalVolumeSol: number;
  volume24hSol: number;
  backerFeesAccruedSol: number;
  agentTrades: number;
  lockedVaultSol: number;
  lockedVaultTokensValueSol: number;
}

export interface PlatformInfo {
  address: string;
  admin: string;
  feeRecipient: string;
  agentAuthority: string;
  launchCount: number;
  params: {
    tradeFeeBps: number;
    backerFeeShareBps: number;
    creatorFeeShareBps: number;
    launchFeeBps: number;
    createFeeLamports: string;
    virtualSolReserves: string;
    maxBundleSupplyBps: number;
    minRaiseLamports: string;
    agentBuyBpsPerWindow: number;
    agentSellBpsPerWindow: number;
    agentMaxImpactBps: number;
    agentBandBps: number;
    agentWindowSecs: number;
    emaPeriodSecs: number;
    paused: boolean;
    agentsPaused: boolean;
  };
}

export interface AgentLaunchRow {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  vaultSol: string;
  vaultTokens: string;
  windowStart: number;
  windowBuyCap: string;
  windowSolSpent: string;
  windowSellCap: string;
  windowTokensSold: string;
  priceSol: number;
  emaSol: number;
  bandLowSol: number;
  bandHighSol: number;
  agentBuys: number;
  agentSells: number;
}

export interface AgentsOverview {
  totals: { buys: number; sells: number; solSpent: string; solReceived: string };
  launches: AgentLaunchRow[];
  recent: (TradeRow & { mint: string; symbol: string })[];
}

export type AgentAction = "buy" | "sell" | "hold" | "skip";

export interface AgentDecision {
  mint: string;
  symbol?: string;
  /** unix seconds */
  at: number;
  action: AgentAction;
  reason: string;
  priceSol: number;
  emaSol: number;
  bandLowSol: number;
  bandHighSol: number;
  /** lamports for buys, token base units for sells */
  amount?: string;
  signature?: string;
  error?: string;
}

export interface AgentStatus {
  agent: string;
  dryRun: boolean;
  startedAt: number;
  lastTickAt: number | null;
  tick: number;
  decisions: AgentDecision[];
}

export type WsMessage =
  | { type: "event"; event: ActivityEvent }
  | { type: "launch"; launch: LaunchSummary }
  /** The indexer rebuilt its index after a chain reset; everything cached is stale. */
  | { type: "reset"; genesisHash: string };

export type { LaunchStatus };
