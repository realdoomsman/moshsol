import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  backerClaimable,
  lamportsToSol,
  platformPda,
  tokensToUi,
  type LaunchJson,
  type MoshClient,
} from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import { DEFAULT_PUBKEY, type LaunchDbRow, type SnapshotLaunchDbRow, type Store, type TradeDbRow } from "./db";
import { parsePubkey, ValidationError } from "./sanitize";
import { allSummaries, summaryOf } from "./summaries";
import { activityFromRow, holderTarget, type ChainSync } from "./sync";
import { ACTIVITY_TYPES, type Candle, type LaunchSummary, type TradeRow } from "./types";

export class NotFoundError extends Error {}

export interface RouteDeps {
  store: Store;
  client: MoshClient;
  sync: ChainSync;
}

export type Query = Record<string, string | undefined>;

const STATUSES = ["raising", "live", "refunding", "woundDown", "all"] as const;
const SORTS = ["new", "trending", "volume", "mcap", "raised"] as const;
const TIMEFRAMES = [60, 300, 900, 3600, 86400] as const;
/** Look-back windows (seconds; 0 = all time) shared by trader stats and leaderboards. */
export const WINDOW_SECS = { "24h": 86_400, "7d": 604_800, all: 0 } as const;
export const WINDOWS = Object.keys(WINDOW_SECS) as (keyof typeof WINDOW_SECS)[];

export function intQuery(q: Query, key: string, fallback: number, max: number): number {
  const raw = q[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${key} must be a non-negative integer`);
  return Math.min(n, max);
}

export function oneOf<T extends string | number>(
  allowed: readonly T[],
  raw: string | undefined,
  fallback: T,
  key: string,
): T {
  if (raw === undefined || raw === "") return fallback;
  const hit = allowed.find((a) => String(a) === raw);
  if (hit === undefined) throw new ValidationError(`${key} must be one of ${allowed.join(", ")}`);
  return hit;
}

export function pubkeyParam(raw: string, label: string): PublicKey {
  const pk = parsePubkey(raw);
  if (!pk) throw new ValidationError(`invalid ${label}`);
  return pk;
}

function tradeRow(t: TradeDbRow): TradeRow {
  return {
    signature: t.signature,
    slot: t.slot,
    timestamp: t.timestamp,
    trader: t.trader,
    isBuy: t.is_buy === 1,
    isAgent: t.is_agent === 1,
    solAmount: t.sol_amount,
    tokenAmount: t.token_amount,
    fee: t.fee,
    priceSol: t.price_sol,
    emaSol: t.ema_sol,
    vaultSol: t.vault_sol,
    vaultTokens: t.vault_tokens,
    realSol: t.real_sol,
    tokenReserve: t.token_reserve,
  };
}

const cmpBig = (a: string, b: string) => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x > y ? 1 : x < y ? -1 : 0;
};

function sortSummaries(list: LaunchSummary[], sort: (typeof SORTS)[number]): void {
  const recency = (s: LaunchSummary) => s.lastTradeAt ?? s.createdAt;
  switch (sort) {
    case "new":
      list.sort((a, b) => b.createdAt - a.createdAt || b.index - a.index);
      return;
    case "trending":
      list.sort(
        (a, b) =>
          b.volume1hSol + 0.25 * b.volume24hSol - (a.volume1hSol + 0.25 * a.volume24hSol) || recency(b) - recency(a),
      );
      return;
    case "volume":
      list.sort((a, b) => b.volume24hSol - a.volume24hSol || cmpBig(b.volumeSol, a.volumeSol));
      return;
    case "mcap":
      list.sort((a, b) => b.marketCapSol - a.marketCapSol);
      return;
    case "raised":
      list.sort((a, b) => cmpBig(b.raised, a.raised));
      return;
  }
}

/** OHLC buckets; each candle opens at the previous close so the series is continuous. */
function buildCandles(row: LaunchDbRow, points: { timestamp: number; price_sol: number; sol: number }[], tf: number) {
  const series =
    row.launch_price !== null && row.launch_ts !== null
      ? [{ timestamp: row.launch_ts, price_sol: row.launch_price, sol: row.bundle_sol ?? 0 }, ...points]
      : points;
  const out: Candle[] = [];
  for (const p of series) {
    const time = Math.floor(p.timestamp / tf) * tf;
    const cur = out[out.length - 1];
    if (cur && cur.time === time) {
      cur.high = Math.max(cur.high, p.price_sol);
      cur.low = Math.min(cur.low, p.price_sol);
      cur.close = p.price_sol;
      cur.volumeSol += p.sol;
      continue;
    }
    const open = cur ? cur.close : p.price_sol;
    out.push({
      time,
      open,
      high: Math.max(open, p.price_sol),
      low: Math.min(open, p.price_sol),
      close: p.price_sol,
      volumeSol: p.sol,
    });
  }
  return out;
}

/**
 * Launch row by address or mint (404 unless it has an on-chain snapshot). Pump launches have no mint until
 * they launch, so their address is the id that always works; the web links them by it.
 */
export function requireLaunch(store: Store, idRaw: string): SnapshotLaunchDbRow {
  const id = pubkeyParam(idRaw, "launch id");
  const row = store.launchById(id.toBase58());
  if (!row?.snapshot) throw new NotFoundError("launch not found");
  return row as SnapshotLaunchDbRow;
}

export function registerRoutes(app: FastifyInstance, { store, client, sync }: RouteDeps): void {
  const connection = client.connection;
  const launchRow = (idRaw: string) => requireLaunch(store, idRaw);

  app.get("/api/health", async (_req, reply) => {
    const h = await sync.health();
    return reply.code(h.ok ? 200 : 503).send({
      ok: h.ok,
      slot: h.slot,
      programId: client.programId.toBase58(),
      lastIndexedSlot: h.lastIndexedSlot,
      lagSlots: h.lagSlots,
      wsConnected: h.wsConnected,
      genesisHash: h.genesisHash,
      ...(h.error ? { error: h.error } : {}),
    });
  });

  app.get("/api/platform", async () => {
    const p = sync.platform ?? (await client.fetchPlatform());
    if (!p) throw new NotFoundError("platform not initialized");
    const pr = p.params;
    return {
      address: platformPda(client.programId).toBase58(),
      admin: p.admin.toBase58(),
      feeRecipient: p.feeRecipient.toBase58(),
      agentAuthority: p.agentAuthority.toBase58(),
      launchCount: Number(p.launchCount.toString()),
      params: {
        tradeFeeBps: pr.tradeFeeBps,
        backerFeeShareBps: pr.backerFeeShareBps,
        creatorFeeShareBps: pr.creatorFeeShareBps,
        launchFeeBps: pr.launchFeeBps,
        createFeeLamports: pr.createFeeLamports.toString(),
        virtualSolReserves: pr.virtualSolReserves.toString(),
        maxBundleSupplyBps: pr.maxBundleSupplyBps,
        minRaiseLamports: pr.minRaiseLamports.toString(),
        agentBuyBpsPerWindow: pr.agentBuyBpsPerWindow,
        agentSellBpsPerWindow: pr.agentSellBpsPerWindow,
        agentMaxImpactBps: pr.agentMaxImpactBps,
        agentBandBps: pr.agentBandBps,
        agentWindowSecs: pr.agentWindowSecs,
        emaPeriodSecs: pr.emaPeriodSecs,
        paused: pr.paused,
        agentsPaused: pr.agentsPaused,
        maxRaiseLamports: pr.maxRaiseLamports.toString(),
        maxWalletDepositLamports: pr.maxWalletDepositLamports.toString(),
        holdfastCurveEnabled: pr.holdfastCurveEnabled,
        burnShareBps: pr.burnShareBps,
        buybackMint: pr.buybackMint.toBase58(),
      },
    };
  });

  app.get<{ Querystring: Query }>("/api/launches", async (req) => {
    const q = req.query;
    const status = oneOf(STATUSES, q.status, "all", "status");
    const sort = oneOf(SORTS, q.sort, "new", "sort");
    const limit = intQuery(q, "limit", 50, 200);
    const offset = intQuery(q, "offset", 0, Number.MAX_SAFE_INTEGER);
    const text = (q.q ?? "").trim().toLowerCase();
    let list = allSummaries(store);
    if (status !== "all") list = list.filter((s) => s.status === status);
    if (text) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(text) ||
          s.symbol.toLowerCase().includes(text) ||
          s.mint.toLowerCase().includes(text) ||
          s.address.toLowerCase().includes(text),
      );
    }
    sortSummaries(list, sort);
    return { launches: list.slice(offset, offset + limit), total: list.length };
  });

  app.get<{ Params: { id: string } }>("/api/launches/:id", async (req) => summaryOf(store, launchRow(req.params.id)));

  app.get<{ Params: { id: string }; Querystring: Query }>("/api/launches/:id/trades", async (req) => {
    const row = launchRow(req.params.id);
    const limit = intQuery(req.query, "limit", 100, 500);
    const before = intQuery(req.query, "before", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const agentOnly = oneOf(["0", "1"] as const, req.query.agent, "0", "agent") === "1";
    const side = oneOf(["buy", "sell", "all"] as const, req.query.side, "all", "side");
    let minSol: number | null = null;
    if (req.query.minSol !== undefined && req.query.minSol !== "") {
      minSol = Number(req.query.minSol);
      if (!Number.isFinite(minSol) || minSol < 0) throw new ValidationError("minSol must be a non-negative number");
    }
    const trader = req.query.trader ? pubkeyParam(req.query.trader, "trader").toBase58() : null;
    const trades = store.trades(row.address, {
      beforeTs: before,
      limit,
      agentOnly,
      side: side === "all" ? null : side,
      minSol,
      trader,
    });
    return { trades: trades.map(tradeRow) };
  });

  app.get<{ Params: { id: string }; Querystring: Query }>("/api/launches/:id/traders", async (req) => {
    const row = launchRow(req.params.id);
    const window = oneOf(WINDOWS, req.query.window, "24h", "window");
    const limit = intQuery(req.query, "limit", 20, 100);
    const since = window === "all" ? 0 : Math.floor(Date.now() / 1000) - WINDOW_SECS[window];
    const stats = store.launchTraderStats(row.address, since, limit);
    const profiles = store.profilesOf(stats.map((s) => s.wallet));
    return {
      window,
      traders: stats.map((s) => ({
        wallet: s.wallet,
        name: profiles.get(s.wallet)?.name ?? null,
        avatar: profiles.get(s.wallet)?.avatar ?? null,
        trades: s.trades,
        buys: s.buys,
        sells: s.trades - s.buys,
        buySol: s.buy_sol,
        sellSol: s.sell_sol,
        volumeSol: s.volume,
        netSol: s.sell_sol - s.buy_sol,
        netTokens: String(s.net_tokens),
        lastTradeAt: s.last_ts,
      })),
    };
  });

  app.get<{ Params: { id: string }; Querystring: Query }>("/api/launches/:id/candles", async (req) => {
    const row = launchRow(req.params.id);
    const tf = oneOf(TIMEFRAMES, req.query.tf, 60, "tf");
    return { candles: buildCandles(row, store.candlePoints(row.address), tf) };
  });

  app.get<{ Params: { id: string } }>("/api/launches/:id/backers", async (req) => {
    const row = launchRow(req.params.id);
    const snap = JSON.parse(row.snapshot) as LaunchJson;
    const raised = BigInt(snap.raised);
    const acc = BigInt(snap.accFeePerShare);
    const accounts = await client.fetchBackersForLaunch(new PublicKey(row.address));
    const backers = accounts.map(({ account }) => {
      const deposited = BigInt(account.deposited.toString());
      const feesClaimed = BigInt(account.feesClaimed.toString());
      return {
        owner: account.owner.toBase58(),
        deposited: deposited.toString(),
        feesClaimed: feesClaimed.toString(),
        claimable: backerClaimable(deposited, acc, feesClaimed).toString(),
        shareBps: raised > 0n ? Number((deposited * 10_000n) / raised) : 0,
      };
    });
    backers.sort((a, b) => cmpBig(b.deposited, a.deposited));
    return { backers };
  });

  app.get<{ Params: { id: string }; Querystring: Query }>("/api/launches/:id/deposits", async (req) => {
    const row = launchRow(req.params.id);
    const limit = intQuery(req.query, "limit", 50, 500);
    const before = intQuery(req.query, "before", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    return {
      deposits: store.deposits(row.address, before, limit).map((d) => ({
        signature: d.signature,
        timestamp: d.timestamp,
        backer: d.backer,
        amount: d.amount,
        raised: d.raised,
      })),
    };
  });

  app.get<{ Params: { id: string }; Querystring: Query }>("/api/launches/:id/holders", async (req) => {
    const row = launchRow(req.params.id);
    const limit = intQuery(req.query, "limit", 20, 1000);
    // A pump launch has no token (and no holders) until it launches.
    if (row.mint === DEFAULT_PUBKEY) return { holders: [] };
    const set = await sync.updateHolders(holderTarget(row));
    return { holders: set.holders.slice(0, limit) };
  });

  app.get<{ Params: { id: string }; Querystring: Query }>("/api/launches/:id/activity", async (req) => {
    const row = launchRow(req.params.id);
    const limit = intQuery(req.query, "limit", 50, 500);
    const before = intQuery(req.query, "before", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const type = req.query.type ? oneOf(ACTIVITY_TYPES, req.query.type, "trade", "type") : null;
    return { events: store.launchActivity(row.address, type, before, limit).map(activityFromRow) };
  });

  app.get<{ Params: { wallet: string } }>("/api/portfolio/:wallet", async (req) => {
    const owner = pubkeyParam(req.params.wallet, "wallet");
    const wallet = owner.toBase58();
    // Holdfast launches are Token-2022 mints, pump launches SPL Token mints.
    const [backerAccounts, token2022Accounts, tokenAccounts] = await Promise.all([
      client.fetchBackersOf(owner),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
    ]);
    const all = allSummaries(store);
    const byAddress = new Map(all.map((s) => [s.address, s]));
    const byMint = new Map(all.filter((s) => s.mint !== DEFAULT_PUBKEY).map((s) => [s.mint, s]));
    const now = Math.floor(Date.now() / 1000);

    const backed = [];
    for (const { account } of backerAccounts) {
      const launch = byAddress.get(account.launch.toBase58());
      if (!launch) continue;
      const deposited = BigInt(account.deposited.toString());
      const feesClaimed = BigInt(account.feesClaimed.toString());
      const raised = BigInt(launch.raised);
      const share = (v: string) => (raised > 0n ? (BigInt(v) * deposited) / raised : 0n);
      const failedRaise = launch.status === "raising" && now >= launch.raiseDeadline && raised < BigInt(launch.raiseMin);
      backed.push({
        launch,
        deposited: deposited.toString(),
        feesClaimed: feesClaimed.toString(),
        claimable: backerClaimable(deposited, BigInt(launch.accFeePerShare), feesClaimed).toString(),
        shareBps: raised > 0n ? Number((deposited * 10_000n) / raised) : 0,
        vaultShareSol: lamportsToSol(share(launch.vaultSol)),
        vaultShareTokens: tokensToUi(share(launch.vaultTokens)),
        refundable: deposited > 0n && (launch.status === "refunding" || failedRaise),
      });
    }

    const created = [...byAddress.values()]
      .filter((l) => l.creator === wallet)
      .map((l) => ({
        launch: l,
        creatorFeesUnclaimed: l.creatorFeesUnclaimed,
        creatorFeesClaimed: l.creatorFeesClaimed,
      }));

    const balances = new Map<string, bigint>();
    for (const { account } of [...token2022Accounts.value, ...tokenAccounts.value]) {
      const info: unknown = account.data.parsed?.info;
      if (typeof info !== "object" || info === null || !("mint" in info) || !("tokenAmount" in info)) continue;
      const { mint, tokenAmount } = info;
      if (typeof mint !== "string" || typeof tokenAmount !== "object" || tokenAmount === null) continue;
      const amount = "amount" in tokenAmount && typeof tokenAmount.amount === "string" ? BigInt(tokenAmount.amount) : 0n;
      if (amount > 0n) balances.set(mint, (balances.get(mint) ?? 0n) + amount);
    }
    const holdings = [];
    for (const [mint, amount] of balances) {
      const launch = byMint.get(mint);
      if (!launch) continue;
      holdings.push({ launch, amount: amount.toString(), valueSol: tokensToUi(amount) * launch.priceSol });
    }
    holdings.sort((a, b) => b.valueSol - a.valueSol);
    return { backed, created, holdings };
  });

  app.get<{ Querystring: Query }>("/api/activity", async (req) => {
    const limit = intQuery(req.query, "limit", 50, 500);
    return { events: store.activity(limit).map(activityFromRow) };
  });

  app.get("/api/stats", async () => {
    const all = allSummaries(store);
    const sum = (f: (l: LaunchSummary) => number) => all.reduce((acc, l) => acc + f(l), 0);
    return {
      totalLaunches: all.length,
      liveLaunches: all.filter((l) => l.status === "live").length,
      raisingLaunches: all.filter((l) => l.status === "raising").length,
      woundDownLaunches: all.filter((l) => l.status === "woundDown").length,
      pumpLaunches: all.filter((l) => l.venue === "pump").length,
      totalRaisedSol: sum((l) => (l.status === "refunding" ? 0 : lamportsToSol(l.raised))),
      totalVolumeSol: sum((l) => lamportsToSol(l.volumeSol)),
      volume24hSol: store.volumeSince(Math.floor(Date.now() / 1000) - 86_400),
      backerFeesAccruedSol: sum((l) => lamportsToSol(l.backerFeesAccrued)),
      profitSharedSol: sum((l) => l.profitSharedSol),
      agentTrades: sum((l) => l.agentBuys + l.agentSells),
      vaultSol: sum((l) => lamportsToSol(l.vaultSol)),
      vaultTokensValueSol: sum((l) => tokensToUi(l.vaultTokens) * l.priceSol),
      vaultWithdrawnSol: sum((l) => l.vaultWithdrawnSol),
      buybackPoolSol: sum((l) => lamportsToSol(l.buybackPoolSol)),
      burnedSol: sum((l) => lamportsToSol(l.burnedSol)),
      creatorFeesCollectedSol: sum((l) => lamportsToSol(l.creatorFeesCollected)),
    };
  });

  app.get("/api/agents", async () => {
    const all = allSummaries(store);
    let spent = 0n;
    let received = 0n;
    for (const l of all) {
      spent += BigInt(l.agentSolSpent);
      received += BigInt(l.agentSolReceived);
    }
    const live = all.filter((l) => l.status === "live").sort((a, b) => cmpBig(b.vaultSol, a.vaultSol));
    return {
      totals: {
        buys: all.reduce((n, l) => n + l.agentBuys, 0),
        sells: all.reduce((n, l) => n + l.agentSells, 0),
        solSpent: spent.toString(),
        solReceived: received.toString(),
      },
      launches: live.map((l) => ({
        address: l.address,
        venue: l.venue,
        mint: l.mint,
        symbol: l.symbol,
        name: l.name,
        image: l.image,
        vaultSol: l.vaultSol,
        vaultTokens: l.vaultTokens,
        windowStart: l.windowStart,
        windowBuyCap: l.windowBuyCap,
        windowSolSpent: l.windowSolSpent,
        windowSellCap: l.windowSellCap,
        windowTokensSold: l.windowTokensSold,
        priceSol: l.priceSol,
        emaSol: l.emaSol,
        // Agent rules use the launch's frozen terms, never the (mutable) platform params.
        bandLowSol: l.emaSol * (1 - l.terms.agentBandBps / 10_000),
        bandHighSol: l.emaSol * (1 + l.terms.agentBandBps / 10_000),
        agentBuys: l.agentBuys,
        agentSells: l.agentSells,
      })),
      recent: store
        .agentTrades(50)
        .map((t) => ({ ...tradeRow(t), launch: t.launch, venue: t.venue, mint: t.mint, symbol: t.symbol })),
    };
  });
}
