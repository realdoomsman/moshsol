import { ACC_PRECISION, BPS, lamportsToSol, type LaunchJson } from "@holdfast/sdk";
import type { FastifyInstance } from "fastify";
import type { LaunchDbRow, Store } from "./db";
import type { HiddenLaunches } from "./hidden";
import type { SolPrice } from "./price";
import { WINDOW_SECS, WINDOWS, intQuery, oneOf, type Query } from "./routes";
import { ValidationError } from "./sanitize";
import type { LaunchSummaries } from "./summaries";
import type { LaunchSummary } from "./types";

const KINDS = ["backers", "creators", "traders", "launches"] as const;
type Kind = (typeof KINDS)[number];
type Window = keyof typeof WINDOW_SECS;

const LEADERBOARD_TTL_MS = 30_000;
/** Rows kept per cached board; `limit` slices this. */
const LEADERBOARD_MAX = 100;
const SEARCH_MAX = 8;
const TRENDING_TOP = 10;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** The field each board is ranked by (descending). */
const METRIC: Record<Kind, string> = {
  backers: "feesEarnedSol",
  creators: "score",
  traders: "volumeSol",
  launches: "volumeSol",
};

type Entry = Record<string, unknown> & { rank: number };

interface LaunchInfo {
  row: LaunchDbRow;
  snap: LaunchJson;
}

function launchInfos(store: Store): Map<string, LaunchInfo> {
  return new Map(store.launches().map((row) => [row.address, { row, snap: JSON.parse(row.snapshot) as LaunchJson }]));
}

/** Share of `fees` lamports going to one side of the split (`bps` of 10 000). */
const feeShare = (fees: number, bps: number) => (BigInt(fees) * BigInt(bps)) / BPS;

function backersBoard(store: Store, window: Window, since: number): Entry[] {
  const launches = launchInfos(store);
  const windowAgg = window === "all" ? null : store.launchWindowAggregates(since);
  const by = new Map<string, { earned: bigint; deposited: bigint; launches: number }>();
  for (const d of store.depositsByBacker()) {
    const l = launches.get(d.launch);
    if (!l || l.snap.status === "refunding") continue;
    const dep = BigInt(d.amount);
    const raised = BigInt(l.snap.raised);
    let earned = 0n;
    // Launched (live or wound down): the accumulator holds the creator-fee share, backer payouts and any wind-down payout.
    if (l.snap.status !== "raising" && raised > 0n) {
      earned =
        windowAgg === null
          ? // Everything the deposit was ever entitled to (claimed + claimable), exactly as the program computes it.
            (dep * BigInt(l.snap.accFeePerShare)) / ACC_PRECISION
          : // Pro-rata backer share of the trade fees paid inside the window.
            (feeShare(windowAgg.get(d.launch)?.fees ?? 0, l.snap.terms.backerFeeShareBps) * dep) / raised;
    }
    const acc = by.get(d.backer) ?? { earned: 0n, deposited: 0n, launches: 0 };
    acc.earned += earned;
    acc.deposited += dep;
    acc.launches += 1;
    by.set(d.backer, acc);
  }
  return [...by]
    .filter(([, v]) => v.earned > 0n)
    .sort(([, a], [, b]) =>
      b.earned !== a.earned ? (b.earned > a.earned ? 1 : -1) : b.deposited > a.deposited ? 1 : b.deposited < a.deposited ? -1 : 0,
    )
    .slice(0, LEADERBOARD_MAX)
    .map(([wallet, v], i) => ({
      rank: i + 1,
      wallet,
      feesEarnedSol: lamportsToSol(v.earned),
      depositedSol: lamportsToSol(v.deposited),
      launchesBacked: v.launches,
    }));
}

function creatorsBoard(store: Store, window: Window, since: number): Entry[] {
  const windowAgg = store.launchWindowAggregates(since);
  const by = new Map<string, { volume: number; raised: bigint; fees: bigint; launches: number; live: number }>();
  for (const { row, snap } of launchInfos(store).values()) {
    const acc = by.get(row.creator) ?? { volume: 0, raised: 0n, fees: 0n, launches: 0, live: 0 };
    acc.launches += 1;
    if (snap.status === "live") acc.live += 1;
    if (snap.status === "live" || snap.status === "woundDown") {
      // A filled raise counts in the window its launch happened in.
      if (window === "all" || snap.launchedAt >= since) acc.raised += BigInt(snap.raised);
    }
    acc.volume += windowAgg.get(row.address)?.volume ?? 0;
    acc.fees +=
      window === "all"
        ? BigInt(snap.creatorFeesClaimed) + BigInt(snap.creatorFeesUnclaimed)
        : feeShare(windowAgg.get(row.address)?.fees ?? 0, snap.terms.creatorFeeShareBps);
    by.set(row.creator, acc);
  }
  return [...by]
    .map(([wallet, v]) => ({ wallet, v, score: v.volume + lamportsToSol(v.raised) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_MAX)
    .map(({ wallet, v, score }, i) => ({
      rank: i + 1,
      wallet,
      score,
      volumeSol: v.volume,
      raisedSol: lamportsToSol(v.raised),
      creatorFeesSol: lamportsToSol(v.fees),
      launches: v.launches,
      liveLaunches: v.live,
    }));
}

function tradersBoard(store: Store, since: number): Entry[] {
  return store.traderBoard(since, LEADERBOARD_MAX).map((t, i) => ({
    rank: i + 1,
    wallet: t.wallet,
    volumeSol: t.volume,
    trades: t.trades,
    buys: t.buys,
    sells: t.trades - t.buys,
    buyVolumeSol: t.buy_sol,
    sellVolumeSol: t.sell_sol,
    netSol: t.sell_sol - t.buy_sol,
    launchesTraded: t.launches,
    lastTradeAt: t.last_ts,
  }));
}

function launchesBoard(store: Store, price: SolPrice, hidden: HiddenLaunches, window: Window, since: number): Entry[] {
  const windowAgg = store.launchWindowAggregates(since);
  const out = [];
  const solUsd = price.current;
  for (const { row, snap } of launchInfos(store).values()) {
    const agg = windowAgg.get(row.address);
    if (snap.status !== "live" || !agg || agg.volume <= 0 || hidden.has(row)) continue;
    // Growth vs the price at the window start (last trade before it), else vs the launch price.
    const ref = (window === "all" ? null : store.priceAt(row.address, since)) ?? row.launch_price;
    out.push({
      address: row.address,
      venue: row.venue,
      mint: row.mint,
      name: row.meta_name ?? row.onchain_name,
      symbol: row.meta_symbol ?? row.onchain_symbol,
      image: row.image,
      creator: row.creator,
      creatorName: row.creator_name,
      volumeSol: agg.volume,
      trades: agg.trades,
      traders: agg.traders,
      priceSol: snap.priceSol,
      marketCapSol: snap.marketCapSol,
      marketCapUsd: solUsd ? snap.marketCapSol * solUsd.usd : null,
      mcapChangePct: ref !== null && ref > 0 ? ((snap.priceSol - ref) / ref) * 100 : null,
      holders: row.holders,
    });
  }
  return out
    .sort((a, b) => b.volumeSol - a.volumeSol || b.trades - a.trades)
    .slice(0, LEADERBOARD_MAX)
    .map((e, i) => ({ rank: i + 1, ...e }));
}

/** Top live launches by 1h volume, then 1h trades, then 24h volume. */
function rankTrending(list: readonly LaunchSummary[]): LaunchSummary[] {
  return list
    .filter((l) => l.status === "live")
    .sort(
      (a, b) =>
        b.volume1hSol - a.volume1hSol ||
        b.trades1h - a.trades1h ||
        b.volume24hSol - a.volume24hSol ||
        b.marketCapSol - a.marketCapSol,
    );
}

export function registerDiscoveryRoutes(
  app: FastifyInstance,
  { store, price, summaries }: { store: Store; price: SolPrice; summaries: LaunchSummaries },
): void {
  const boards = new Map<string, { at: number; entries: Entry[] }>();
  let king: { address: string; since: number } | null = null;

  app.get<{ Querystring: Query }>("/api/leaderboard", async (req) => {
    const kind = oneOf(KINDS, req.query.kind, "traders", "kind");
    const window = oneOf(WINDOWS, req.query.window, "24h", "window");
    const limit = intQuery(req.query, "limit", 25, LEADERBOARD_MAX);
    const key = `${kind}:${window}:${store.generation}`;
    const now = Date.now();
    let cached = boards.get(key);
    if (!cached || now - cached.at >= LEADERBOARD_TTL_MS) {
      const since = window === "all" ? 0 : Math.floor(now / 1000) - WINDOW_SECS[window];
      let entries: Entry[];
      switch (kind) {
        case "backers":
          entries = backersBoard(store, window, since);
          break;
        case "creators":
          entries = creatorsBoard(store, window, since);
          break;
        case "traders":
          entries = tradersBoard(store, since);
          break;
        case "launches":
          entries = launchesBoard(store, price, summaries.hidden, window, since);
          break;
      }
      if (kind !== "launches") {
        const profiles = store.profilesOf(entries.map((e) => e.wallet as string));
        for (const e of entries) {
          const p = profiles.get(e.wallet as string);
          e.name = p?.name ?? null;
          e.avatar = p?.avatar ?? null;
        }
      }
      for (const k of boards.keys()) if (!k.endsWith(`:${store.generation}`)) boards.delete(k);
      cached = { at: now, entries };
      boards.set(key, cached);
    }
    return {
      kind,
      window,
      metric: METRIC[kind],
      updatedAt: Math.floor(cached.at / 1000),
      entries: cached.entries.slice(0, limit),
    };
  });

  app.get<{ Querystring: Query }>("/api/search", async (req) => {
    const raw = (req.query.q ?? "").trim();
    if (raw.length === 0) throw new ValidationError("q is required");
    if (raw.length > 64) throw new ValidationError("q must be at most 64 characters");
    const text = raw.toLowerCase();
    // Address prefixes are case-sensitive base58; short ones would match almost anything.
    const addrPrefix = raw.length >= 3 && BASE58_RE.test(raw) ? raw : null;

    const solUsd = price.current;
    // Over-fetched by the hidden ids so dropping hidden matches still fills the page.
    const matches = store.searchLaunches(text, addrPrefix, SEARCH_MAX + summaries.hidden.size);
    const launches = matches
      .filter((row) => !summaries.hidden.has(row))
      .slice(0, SEARCH_MAX)
      .map((row) => {
        const snap = JSON.parse(row.snapshot) as LaunchJson;
        return {
          address: row.address,
          venue: row.venue,
          mint: row.mint,
          name: row.meta_name ?? row.onchain_name,
          symbol: row.meta_symbol ?? row.onchain_symbol,
          image: row.image,
          status: snap.status,
          priceSol: snap.priceSol,
          marketCapSol: snap.marketCapSol,
          marketCapUsd: solUsd ? snap.marketCapSol * solUsd.usd : null,
          raised: snap.raised,
          holders: row.holders,
          creatorName: row.creator_name,
        };
      });

    const users = new Map<string, { wallet: string; name: string | null; avatar: string | null }>();
    for (const p of store.searchProfiles(text, addrPrefix, SEARCH_MAX)) users.set(p.wallet, p);
    if (addrPrefix && users.size < SEARCH_MAX) {
      for (const w of store.searchWallets(addrPrefix, SEARCH_MAX)) {
        if (users.size >= SEARCH_MAX) break;
        if (!users.has(w.wallet)) users.set(w.wallet, w);
      }
    }
    return { query: raw, launches, users: [...users.values()] };
  });

  app.get("/api/trending", async () => {
    const ranked = rankTrending(summaries.listed());
    const top = ranked[0];
    const nowSecs = Math.floor(Date.now() / 1000);
    if (top && top.trades1h > 0) {
      if (king?.address !== top.address) king = { address: top.address, since: nowSecs };
    } else {
      king = null;
    }
    return {
      updatedAt: nowSecs,
      king: king && top ? { launch: top, kingSince: king.since } : null,
      top: ranked.slice(0, TRENDING_TOP),
    };
  });
}
