import type { LaunchJson, LaunchVenue } from "@holdfast/sdk";

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
  /** `marketCapSol` / `priceSol` / `volume24hSol` × the SOL/USD price (`/api/stats` → `solUsd`); null until a price was fetched. */
  marketCapUsd: number | null;
  priceUsd: number | null;
  change24h: number | null;
  volume24hSol: number;
  volume24hUsd: number | null;
  /** SOL traded in the last hour (agent trades included). */
  volume1hSol: number;
  /** Trades in the last hour (agent trades included). */
  trades1h: number;
  /** Distinct non-agent wallets that bought / sold in the last 24h. */
  buyers24h: number;
  sellers24h: number;
  lastTradeAt: number | null;
  holders: number;
  /** Largest holder's % of total supply, curve and vault excluded; null until holders were first loaded. */
  topHolderPct: number | null;
  /** Visible comments. */
  comments: number;
  /** The creator's profile name, if set. */
  creatorName: string | null;
  /** SOL paid to backers out of the vault agent's realized profit (sum of `VaultProfitShared`). */
  profitSharedSol: number;
  /** Vault SOL / tokens (base units) the platform admin withdrew with `admin_withdraw_vault` (sum of `VaultWithdrawn`). */
  vaultWithdrawnSol: number;
  vaultWithdrawnTokens: string;
  /** The permissionless wind-down (`WoundDown` event); null while not wound down (or its event wasn't indexed). */
  woundDown: { timestamp: number; solToBackers: number; tokensReturned: string; signature: string } | null;
  /** Pump launches: the `PumpGraduated` event (`graduate_pump` recorded the PumpSwap pool); null before. */
  graduation: { timestamp: number; signature: string; pool: string } | null;
  /** Pump launches: permissionless crank history from the indexed `CreatorFeesCollected` / `BuybackBurned` events. */
  cranks: { creatorFeeCollections: number; buybacks: number; lastCollectedAt: number | null; lastBuybackAt: number | null };
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

export const ACTIVITY_TYPES = [
  "trade",
  "deposit",
  "launch_created",
  "launched",
  "refund",
  "cancelled",
  "backer_claim",
  "creator_claim",
  "profit_shared",
  "wound_down",
  "vault_withdrawn",
  "creator_fees_collected",
  "buyback_burned",
  "graduated",
  "migrated",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  signature: string;
  timestamp: number;
  /** Launch address (the stable key: a pump launch's `mint` is the default pubkey while raising). */
  launch: string;
  venue: LaunchVenue;
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  actor: string;
  isAgent?: boolean;
  isBuy?: boolean;
  solAmount?: string;
  tokenAmount?: string;
  /** `graduated`: the PumpSwap pool; `buyback_burned`: the mint bought and burned. */
  ref?: string;
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
  /** The venue's own token account (Holdfast curve PDA, pump.fun bonding curve or PumpSwap pool) or the vault. */
  label: "curve" | "pool" | "vault" | null;
}

export interface CommentRow {
  id: number;
  /** Launch address. */
  launch: string;
  mint: string;
  /** Author wallet. */
  wallet: string;
  /** Author profile name / avatar URL, if set. */
  name: string | null;
  avatar: string | null;
  body: string;
  /** Id of the comment this replies to (same launch); it may have been removed by a moderator since. */
  replyTo: number | null;
  replyCount: number;
  createdAt: number;
  isCreator: boolean;
  /** Deposited into the launch's raise. */
  isBacker: boolean;
  /** Holds the token now (holder snapshot, else net curve buys > sells). Best effort. */
  holdsTokens: boolean;
}

export type WsMessage =
  | { type: "event"; event: ActivityEvent }
  | { type: "launch"; launch: LaunchSummary }
  | { type: "comment"; launch: string; comment: CommentRow }
  | { type: "comment_deleted"; launch: string; id: number }
  /** The chain was reset (new genesis) and the index was rebuilt: clients should drop cached data and refetch. */
  | { type: "reset"; genesisHash: string };
