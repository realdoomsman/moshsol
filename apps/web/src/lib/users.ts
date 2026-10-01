import { queryOptions } from "@tanstack/react-query";
import type { LaunchStatus, LaunchVenue } from "@holdfast/sdk";
import { request } from "./api";
import { INDEXER_URL } from "./env";
import { signedMessage, type SignMessage } from "./signed";
import type { ActivityEvent, LaunchSummary } from "./types";

/** Social + discovery endpoints of the indexer (API.md "Users", "Discovery"). */

export interface UserStats {
  launchesCreated: number;
  launchesByStatus: Record<LaunchStatus, number>;
  raisedSol: number;
  backedLaunches: number;
  depositedSol: number;
  refundedSol: number;
  backerFeesEarnedSol: number;
  backerFeesClaimedSol: number;
  backerFeesClaimableSol: number;
  creatorFeesEarnedSol: number;
  creatorFeesClaimedSol: number;
  creatorFeesUnclaimedSol: number;
  trades: number;
  buys: number;
  sells: number;
  volumeSol: number;
  buyVolumeSol: number;
  sellVolumeSol: number;
  launchesTraded: number;
  comments: number;
  /** Earliest indexed event of the wallet; `null` if never seen. */
  firstSeen: number | null;
}

export interface UserLaunch {
  mint: string;
  address: string;
  venue: LaunchVenue;
  name: string;
  symbol: string;
  image: string | null;
  status: LaunchStatus;
  createdAt: number;
  raised: string;
  raisedSol: number;
  raiseMin: string;
  raiseMax: string;
  backerCount: number;
  priceSol: number;
  marketCapSol: number;
  marketCapUsd: number | null;
  volume24hSol: number;
  creatorFeesEarnedSol: number;
}

export interface UserBacked {
  mint: string;
  address: string;
  venue: LaunchVenue;
  name: string;
  symbol: string;
  image: string | null;
  status: LaunchStatus;
  depositedSol: number;
  shareBps: number;
  feesEarnedSol: number;
  feesClaimableSol: number;
  firstDepositAt: number;
}

/** `GET /api/users/:wallet` — any valid wallet (zeros when unseen); profile fields `null` when unset. */
export interface UserProfile {
  wallet: string;
  name: string | null;
  bio: string | null;
  avatar: string | null;
  profileUpdatedAt: number | null;
  stats: UserStats;
  /** Newest first. */
  launches: UserLaunch[];
  /** Sorted by fees earned. */
  backed: UserBacked[];
}

/** Fields of a profile write; omitted fields are cleared. */
export interface ProfileInput {
  name?: string;
  bio?: string;
  avatar?: string;
}

/** Server rules for `PUT /api/users/:wallet` (API.md). */
export const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]{2,24}$/;
export const PROFILE_BIO_MAX = 160;

export type LeaderboardKind = "backers" | "creators" | "traders" | "launches";
export type LeaderboardWindow = "24h" | "7d" | "all";

interface WalletEntry {
  rank: number;
  wallet: string;
  name: string | null;
  avatar: string | null;
}

export interface BackerEntry extends WalletEntry {
  feesEarnedSol: number;
  depositedSol: number;
  launchesBacked: number;
}

export interface CreatorEntry extends WalletEntry {
  score: number;
  volumeSol: number;
  raisedSol: number;
  creatorFeesSol: number;
  launches: number;
  liveLaunches: number;
}

export interface TraderEntry extends WalletEntry {
  volumeSol: number;
  trades: number;
  buys: number;
  sells: number;
  buyVolumeSol: number;
  sellVolumeSol: number;
  netSol: number;
  launchesTraded: number;
  lastTradeAt: number | null;
}

export interface LaunchEntry {
  rank: number;
  mint: string;
  address: string;
  venue: LaunchVenue;
  name: string;
  symbol: string;
  image: string | null;
  creator: string;
  creatorName: string | null;
  volumeSol: number;
  trades: number;
  traders: number;
  priceSol: number;
  marketCapSol: number;
  marketCapUsd: number | null;
  mcapChangePct: number | null;
  holders: number;
}

export interface LeaderboardEntries {
  backers: BackerEntry;
  creators: CreatorEntry;
  traders: TraderEntry;
  launches: LaunchEntry;
}

export interface Leaderboard<K extends LeaderboardKind = LeaderboardKind> {
  kind: K;
  window: LeaderboardWindow;
  metric: string;
  updatedAt: number;
  entries: LeaderboardEntries[K][];
}

/** `GET /api/trending`: the live launch with the most SOL volume in the last hour, and the top 10. */
export interface Trending {
  updatedAt: number;
  king: { launch: LaunchSummary; kingSince: number } | null;
  top: LaunchSummary[];
}

export const LEADERBOARD_LIMIT = 100;

export const usersApi = {
  user: (wallet: string) => request<UserProfile>(INDEXER_URL, `/api/users/${wallet}`),
  /** Newest first; `before` = unix seconds (exclusive). */
  activity: (wallet: string, p: { limit: number; before?: number }) => {
    const qs = new URLSearchParams({ limit: String(p.limit) });
    if (p.before !== undefined) qs.set("before", String(p.before));
    return request<{ events: ActivityEvent[]; nextBefore: number | null }>(INDEXER_URL, `/api/users/${wallet}/activity?${qs}`);
  },
  leaderboard: <K extends LeaderboardKind>(kind: K, window: LeaderboardWindow) =>
    request<Leaderboard<K>>(INDEXER_URL, `/api/leaderboard?kind=${kind}&window=${window}&limit=${LEADERBOARD_LIMIT}`),
  trending: () => request<Trending>(INDEXER_URL, "/api/trending"),
  /** Uploads an image (PNG, JPEG, GIF, WebP or SVG, ≤ 4 MB) → its indexer URL, e.g. a profile avatar. */
  uploadImage: (image: File) => {
    const form = new FormData();
    form.set("image", image);
    return request<{ image: string }>(INDEXER_URL, "/api/upload/image", { method: "POST", body: form });
  },
  /** Signed profile write (free: a message signature, not a transaction). */
  saveProfile: async (wallet: string, input: ProfileInput, signMessage: SignMessage) => {
    const profile = JSON.stringify(input);
    const { message, signature } = await signedMessage("profile", wallet, profile, signMessage);
    return request<{ wallet: string; name: string | null; bio: string | null; avatar: string | null; updatedAt: number }>(
      INDEXER_URL,
      `/api/users/${wallet}`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature, profile }) },
    );
  },
};

export const userQuery = (wallet: string) =>
  queryOptions({ queryKey: ["user", wallet], queryFn: () => usersApi.user(wallet), staleTime: 15_000 });

export const USER_ACTIVITY_PAGE = 50;

export const userActivityQuery = (wallet: string) =>
  queryOptions({
    queryKey: ["user-activity", wallet],
    queryFn: () => usersApi.activity(wallet, { limit: USER_ACTIVITY_PAGE }),
  });

export const leaderboardQuery = <K extends LeaderboardKind>(kind: K, window: LeaderboardWindow) =>
  queryOptions({ queryKey: ["leaderboard", kind, window], queryFn: () => usersApi.leaderboard(kind, window), staleTime: 30_000 });

export const trendingQuery = () => queryOptions({ queryKey: ["trending"], queryFn: usersApi.trending });
