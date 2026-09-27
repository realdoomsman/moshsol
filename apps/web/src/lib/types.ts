import type { LaunchJson, LaunchStatus } from "@holdfast/sdk";

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
  volume1hSol: number;
  /** Trades in the last hour (agent trades included). */
  trades1h: number;
  /** Distinct non-agent wallets that bought / sold in the last 24 h. */
  buyers24h: number;
  sellers24h: number;
  lastTradeAt: number | null;
  /** Wallets with a non-zero balance (curve and vault excluded). */
  holders: number;
  /** Largest holder's % of supply (curve and vault excluded); null until holders were first loaded. */
  topHolderPct: number | null;
  /** Visible comments. */
  comments: number;
  creatorName: string | null;
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

/** A thread comment (`/api/launches/:mint/comments`, WS `comment`); `body` is plain text. */
export interface Comment {
  id: number;
  mint: string;
  wallet: string;
  name: string | null;
  avatar: string | null;
  body: string;
  replyTo: number | null;
  replyCount: number;
  createdAt: number;
  isCreator: boolean;
  isBacker: boolean;
  holdsTokens: boolean;
}

export interface CommentsPage {
  comments: Comment[];
  total: number;
  nextBefore: number | null;
}

export type TraderWindow = "24h" | "7d" | "all";

/** `/api/launches/:mint/traders`: a non-agent trader's volume on one launch. */
export interface TraderStat {
  wallet: string;
  name: string | null;
  avatar: string | null;
  trades: number;
  buys: number;
  sells: number;
  buySol: number;
  sellSol: number;
  volumeSol: number;
  /** Sold − bought in SOL (cash flow, not PnL). */
  netSol: number;
  /** Bought − sold in token base units (may be negative). */
  netTokens: string;
  lastTradeAt: number;
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

/** `GET /api/health` (the same body comes back with a 503 while unhealthy). */
export interface IndexerHealth {
  ok: boolean;
  slot: number | null;
  programId: string;
  lastIndexedSlot: number | null;
  lagSlots: number | null;
  wsConnected: boolean;
  genesisHash: string | null;
  error?: string;
}

/** `GET /api/search?q=`: up to 8 launches and 8 wallets. */
export interface SearchLaunch {
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  status: LaunchStatus;
  priceSol: number;
  marketCapSol: number;
  raised: string;
  holders: number;
  creatorName: string | null;
}

export interface SearchUser {
  wallet: string;
  name: string | null;
  avatar: string | null;
}

export interface SearchResult {
  query: string;
  launches: SearchLaunch[];
  users: SearchUser[];
}

export type WsMessage =
  | { type: "event"; event: ActivityEvent }
  | { type: "launch"; launch: LaunchSummary }
  /** The indexer rebuilt its index after a chain reset; everything cached is stale. */
  | { type: "reset"; genesisHash: string }
  | { type: "comment"; mint: string; comment: Comment }
  | { type: "comment_deleted"; mint: string; id: number };

export type { LaunchStatus };
