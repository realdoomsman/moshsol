import fs from "node:fs";
import path from "node:path";
import { backerClaimable, lamportsToSol, type LaunchJson } from "@holdfast/sdk";
import type { FastifyInstance, FastifyReply } from "fastify";
import { SIGNATURE_MAX_SKEW_SECS, safeEqual, sha256Hex, verifySignedMessage } from "./auth";
import type { CommentDbRow, LaunchDbRow, Store } from "./db";
import type { Holders } from "./holders";
import type { Hub } from "./hub";
import { Limiter } from "./ratelimit";
import { NotFoundError, intQuery, pubkeyParam, requireLaunch, type Query } from "./routes";
import { HttpError, ValidationError, cleanText, isRecord } from "./sanitize";
import { summariesOf } from "./summaries";
import { activityFromRow } from "./sync";
import type { CommentRow } from "./types";

export interface SocialDeps {
  store: Store;
  hub: Hub;
  holders: Holders;
  filesDir: string;
  publicUrl: string;
  adminToken: string | null;
  /** Comments per wallet per minute (0 = off). */
  commentLimitPerMin: number;
  /** Signed writes per IP per minute (0 = off). */
  socialIpLimitPerMin: number;
}

const COMMENT_MAX_CHARS = 500;
/** Same wallet posting the same text on the same launch again within this window is rejected. */
const DUPLICATE_WINDOW_SECS = 600;
const PROFILE_LIMIT_PER_MIN = 10;
const NAME_RE = /^[A-Za-z0-9_.-]{2,24}$/;
const BIO_MAX_CHARS = 160;
const IMG_FILE_RE = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|gif|webp|svg)$/;
const WRITE_BODY_LIMIT = 16 * 1024;

type Body = Record<string, unknown>;

function stringField(body: Body, key: string, max: number): string {
  const v = body[key];
  if (typeof v !== "string" || v.length === 0) throw new ValidationError(`${key} is required (string)`);
  if (v.length > max) throw new ValidationError(`${key} is too long`);
  return v;
}

function positiveInt(raw: unknown, label: string): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) throw new ValidationError(`${label} must be a positive integer`);
  return n;
}

function tooMany(reply: FastifyReply, over: { wait: number }, what: string): FastifyReply {
  return reply
    .code(429)
    .header("Retry-After", String(over.wait))
    .send({ error: `${what}; retry in ${over.wait}s` });
}

export function registerSocialRoutes(app: FastifyInstance, deps: SocialDeps): void {
  const { store, hub, holders } = deps;
  const ipLimiter = deps.socialIpLimitPerMin > 0 ? new Limiter(deps.socialIpLimitPerMin) : null;
  const commentLimiter = deps.commentLimitPerMin > 0 ? new Limiter(deps.commentLimitPerMin) : null;
  const profileLimiter = new Limiter(PROFILE_LIMIT_PER_MIN);
  const sweeper = setInterval(() => {
    const now = Date.now();
    ipLimiter?.sweep(now);
    commentLimiter?.sweep(now);
    profileLimiter.sweep(now);
  }, 60_000);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));

  const imgPrefix = `${deps.publicUrl}/files/img/`;

  /** Wire rows for comments of one launch; author badges are computed once per author. */
  const commentRows = (launch: LaunchDbRow, rows: CommentDbRow[]): CommentRow[] => {
    const held = holders.cached(launch.mint);
    const badges = new Map<string, { isBacker: boolean; holdsTokens: boolean }>();
    return rows.map((c) => {
      let b = badges.get(c.wallet);
      if (!b) {
        const holder = held?.holders.find((h) => h.label === null && h.owner === c.wallet);
        b = {
          isBacker: store.isBacker(c.wallet, launch.address),
          // Holder snapshot when one is cached (exact balances), else net curve buys (transfers unseen).
          holdsTokens: held ? holder !== undefined : store.netTokens(c.wallet, launch.address) > 0,
        };
        badges.set(c.wallet, b);
      }
      return {
        id: c.id,
        mint: c.mint,
        wallet: c.wallet,
        name: c.author_name,
        avatar: c.author_avatar,
        body: c.body,
        replyTo: c.reply_to,
        replyCount: c.reply_count,
        createdAt: c.created_at,
        isCreator: c.wallet === launch.creator,
        ...b,
      };
    });
  };

  /** Consumes a signed message (replay protection): 409 when it was used before. */
  const claimMessage = (wallet: string, message: string, ts: number, nowSecs: number) => {
    const fresh = store.claimSignedMessage(sha256Hex(`${wallet}\n${message}`), ts, nowSecs - 2 * SIGNATURE_MAX_SKEW_SECS);
    if (!fresh) throw new HttpError(409, "this signed message was already used; sign a new one");
  };

  // ---------------- comments ----------------

  app.get<{ Params: { mint: string }; Querystring: Query }>("/api/launches/:mint/comments", async (req) => {
    const launch = requireLaunch(store, req.params.mint);
    const limit = intQuery(req.query, "limit", 50, 200);
    const before = intQuery(req.query, "before", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const replyTo = req.query.replyTo ? positiveInt(req.query.replyTo, "replyTo") : null;
    const rows = store.comments(launch.mint, before, limit, replyTo);
    return {
      comments: commentRows(launch, rows),
      total: store.commentTotal(launch.mint),
      nextBefore: rows.length === limit && limit > 0 ? rows[rows.length - 1].id : null,
    };
  });

  app.get<{ Params: { id: string } }>("/api/comments/:id", async (req) => {
    const c = store.comment(positiveInt(req.params.id, "id"));
    if (!c || c.deleted_at !== null) throw new NotFoundError("comment not found");
    const launch = store.launchByMint(c.mint);
    if (!launch) throw new NotFoundError("comment not found");
    return { comment: commentRows(launch, [c])[0] };
  });

  app.post<{ Params: { mint: string } }>(
    "/api/launches/:mint/comments",
    { bodyLimit: WRITE_BODY_LIMIT },
    async (req, reply) => {
      const now = Date.now();
      const ipOver = ipLimiter?.hit(req.ip, now);
      if (ipOver) return tooMany(reply, ipOver, `too many signed writes from this IP (${deps.socialIpLimitPerMin}/min)`);
      if (!isRecord(req.body)) throw new ValidationError("expected a JSON object");
      const body = req.body;
      const wallet = pubkeyParam(stringField(body, "wallet", 64), "wallet").toBase58();
      const message = stringField(body, "message", 512);
      const signature = stringField(body, "signature", 128);
      const rawText = stringField(body, "body", 4 * COMMENT_MAX_CHARS);
      const replyTo = body.replyTo === undefined || body.replyTo === null ? null : positiveInt(body.replyTo, "replyTo");
      const launch = requireLaunch(store, req.params.mint);
      const text = cleanText(rawText, "body", COMMENT_MAX_CHARS, { multiline: true });
      if (!text) throw new ValidationError("body must not be empty");

      const nowSecs = Math.floor(now / 1000);
      const ts = verifySignedMessage(
        { wallet, message, signature },
        { kind: "comment", subject: launch.mint, payload: rawText },
        nowSecs,
      );
      claimMessage(wallet, message, ts, nowSecs);
      const walletOver = commentLimiter?.hit(wallet, now);
      if (walletOver) {
        return tooMany(reply, walletOver, `too many comments from this wallet (${deps.commentLimitPerMin}/min)`);
      }
      if (replyTo !== null) {
        const parent = store.comment(replyTo);
        if (!parent || parent.mint !== launch.mint || parent.deleted_at !== null) {
          throw new ValidationError("replyTo must be a visible comment on this launch");
        }
      }
      if (store.hasRecentDuplicate(wallet, launch.mint, text, nowSecs - DUPLICATE_WINDOW_SECS)) {
        throw new HttpError(409, "you already posted this comment here recently");
      }

      const id = store.insertComment({
        mint: launch.mint,
        wallet,
        body: text,
        reply_to: replyTo,
        created_at: nowSecs,
        signature,
        message,
      });
      const comment = commentRows(launch, [store.comment(id)!])[0];
      hub.broadcast({ type: "comment", mint: launch.mint, comment });
      req.log.info({ id, mint: launch.mint, wallet, replyTo }, "comment posted");
      return reply.code(201).send({ comment });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/comments/:id", async (req) => {
    if (!deps.adminToken) throw new HttpError(503, "moderation is disabled (ADMIN_TOKEN is not set)");
    const token = req.headers["x-admin-token"];
    if (typeof token !== "string" || !safeEqual(token, deps.adminToken)) throw new HttpError(401, "invalid admin token");
    const id = positiveInt(req.params.id, "id");
    const c = store.comment(id);
    if (!c) throw new NotFoundError("comment not found");
    const nowSecs = Math.floor(Date.now() / 1000);
    const deleted = store.softDeleteComment(id, nowSecs);
    if (deleted) {
      hub.broadcast({ type: "comment_deleted", mint: c.mint, id });
      req.log.warn({ id, mint: c.mint, wallet: c.wallet }, "comment removed by moderator");
    }
    return { ok: true, id, mint: c.mint, deletedAt: deleted ? nowSecs : c.deleted_at, alreadyDeleted: !deleted };
  });

  // ---------------- profiles ----------------

  const validAvatar = (url: string): boolean => {
    if (url.startsWith(imgPrefix)) {
      const file = url.slice(imgPrefix.length);
      return IMG_FILE_RE.test(file) && fs.existsSync(path.join(deps.filesDir, "img", file));
    }
    // Arweave uploads (STORAGE=arweave) are recorded in the DB; launch images may come from any host.
    return store.isUploadedImage(url) || store.isLaunchImage(url);
  };

  app.put<{ Params: { wallet: string } }>("/api/users/:wallet", { bodyLimit: WRITE_BODY_LIMIT }, async (req, reply) => {
    const now = Date.now();
    const ipOver = ipLimiter?.hit(req.ip, now);
    if (ipOver) return tooMany(reply, ipOver, `too many signed writes from this IP (${deps.socialIpLimitPerMin}/min)`);
    const wallet = pubkeyParam(req.params.wallet, "wallet").toBase58();
    if (!isRecord(req.body)) throw new ValidationError("expected a JSON object");
    const message = stringField(req.body, "message", 512);
    const signature = stringField(req.body, "signature", 128);
    const profileJson = stringField(req.body, "profile", 2048);
    const nowSecs = Math.floor(now / 1000);
    const ts = verifySignedMessage(
      { wallet, message, signature },
      { kind: "profile", subject: wallet, payload: profileJson },
      nowSecs,
    );
    claimMessage(wallet, message, ts, nowSecs);
    const over = profileLimiter.hit(wallet, now);
    if (over) return tooMany(reply, over, `too many profile updates (${PROFILE_LIMIT_PER_MIN}/min)`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(profileJson);
    } catch {
      throw new ValidationError("profile must be a JSON object string");
    }
    if (!isRecord(parsed)) throw new ValidationError("profile must be a JSON object string");
    const unknown = Object.keys(parsed).filter((k) => k !== "name" && k !== "bio" && k !== "avatar");
    if (unknown.length > 0) throw new ValidationError(`unknown profile field(s): ${unknown.join(", ")}`);

    let name: string | null = null;
    if (parsed.name !== undefined && parsed.name !== null && parsed.name !== "") {
      if (typeof parsed.name !== "string" || !NAME_RE.test(parsed.name)) {
        throw new ValidationError("name must be 2-24 characters of A-Z a-z 0-9 _ . -");
      }
      name = parsed.name;
      const owner = store.profileOwnerByName(name.toLowerCase());
      if (owner !== null && owner !== wallet) throw new HttpError(409, "name is already taken");
    }
    const bio = cleanText(parsed.bio, "bio", BIO_MAX_CHARS);
    let avatar: string | null = null;
    if (parsed.avatar !== undefined && parsed.avatar !== null && parsed.avatar !== "") {
      if (typeof parsed.avatar !== "string" || parsed.avatar.length > 500 || !validAvatar(parsed.avatar)) {
        throw new ValidationError(
          "avatar must be an image uploaded to this indexer (POST /api/upload/image) or an existing launch image URL",
        );
      }
      avatar = parsed.avatar;
    }
    try {
      store.upsertProfile({ wallet, name, bio, avatar, now: nowSecs });
    } catch (err) {
      // Lost a race for the same name between the check and the write.
      if (/UNIQUE constraint failed: profiles\.name_lower/.test(String((err as Error).message))) {
        throw new HttpError(409, "name is already taken");
      }
      throw err;
    }
    req.log.info({ wallet, name }, "profile updated");
    const p = store.profile(wallet)!;
    return { wallet, name: p.name, bio: p.bio, avatar: p.avatar, createdAt: p.created_at, updatedAt: p.updated_at };
  });

  app.get<{ Params: { wallet: string } }>("/api/users/:wallet", async (req) => {
    const wallet = pubkeyParam(req.params.wallet, "wallet").toBase58();
    const profile = store.profile(wallet);

    const created = summariesOf(store, store.walletLaunches(wallet));
    let raised = 0n;
    let creatorClaimed = 0n;
    let creatorUnclaimed = 0n;
    for (const l of created) {
      if (l.status !== "refunding") raised += BigInt(l.raised);
      creatorClaimed += BigInt(l.creatorFeesClaimed);
      creatorUnclaimed += BigInt(l.creatorFeesUnclaimed);
    }

    const claimedByLaunch = new Map<string, bigint>();
    let refunded = 0n;
    for (const t of store.walletEventTotals(wallet)) {
      if (t.type === "backer_claim") claimedByLaunch.set(t.launch, BigInt(t.amount));
      if (t.type === "refund") refunded += BigInt(t.amount);
    }
    let deposited = 0n;
    let backerClaimed = 0n;
    let backerClaimableTotal = 0n;
    const backed = [];
    for (const d of store.walletDeposits(wallet)) {
      const row = store.launch(d.launch);
      if (!row?.snapshot) continue;
      const snap = JSON.parse(row.snapshot) as LaunchJson;
      const dep = BigInt(d.amount);
      const claimed = claimedByLaunch.get(d.launch) ?? 0n;
      // Refunded deposits (failed/cancelled raise) never earned anything; launched ones (live or wound down) keep claiming.
      const claimable = snap.status === "refunding" ? 0n : backerClaimable(dep, BigInt(snap.accFeePerShare), claimed);
      deposited += dep;
      backerClaimed += claimed;
      backerClaimableTotal += claimable;
      backed.push({
        mint: row.mint,
        name: row.meta_name ?? row.onchain_name,
        symbol: row.meta_symbol ?? row.onchain_symbol,
        image: row.image,
        status: snap.status,
        depositedSol: lamportsToSol(dep),
        shareBps: BigInt(snap.raised) > 0n ? Number((dep * 10_000n) / BigInt(snap.raised)) : 0,
        feesEarnedSol: lamportsToSol(claimed + claimable),
        feesClaimableSol: lamportsToSol(claimable),
        firstDepositAt: d.first_ts,
      });
    }
    backed.sort((a, b) => b.feesEarnedSol - a.feesEarnedSol || b.depositedSol - a.depositedSol);

    const t = store.walletTrades(wallet);
    return {
      wallet,
      name: profile?.name ?? null,
      bio: profile?.bio ?? null,
      avatar: profile?.avatar ?? null,
      profileUpdatedAt: profile?.updated_at ?? null,
      stats: {
        launchesCreated: created.length,
        launchesByStatus: {
          raising: created.filter((l) => l.status === "raising").length,
          live: created.filter((l) => l.status === "live").length,
          refunding: created.filter((l) => l.status === "refunding").length,
          woundDown: created.filter((l) => l.status === "woundDown").length,
        },
        raisedSol: lamportsToSol(raised),
        backedLaunches: backed.length,
        depositedSol: lamportsToSol(deposited),
        refundedSol: lamportsToSol(refunded),
        backerFeesEarnedSol: lamportsToSol(backerClaimed + backerClaimableTotal),
        backerFeesClaimedSol: lamportsToSol(backerClaimed),
        backerFeesClaimableSol: lamportsToSol(backerClaimableTotal),
        creatorFeesEarnedSol: lamportsToSol(creatorClaimed + creatorUnclaimed),
        creatorFeesClaimedSol: lamportsToSol(creatorClaimed),
        creatorFeesUnclaimedSol: lamportsToSol(creatorUnclaimed),
        trades: t.trades,
        buys: t.buys,
        sells: t.trades - t.buys,
        volumeSol: t.volume,
        buyVolumeSol: t.buy_sol,
        sellVolumeSol: t.sell_sol,
        launchesTraded: t.launches,
        comments: store.walletCommentCount(wallet),
        firstSeen: store.walletFirstSeen(wallet),
      },
      launches: created.map((l) => ({
        mint: l.mint,
        name: l.name,
        symbol: l.symbol,
        image: l.image,
        status: l.status,
        createdAt: l.createdAt,
        raised: l.raised,
        raisedSol: lamportsToSol(l.raised),
        raiseMin: l.raiseMin,
        raiseMax: l.raiseMax,
        backerCount: l.backerCount,
        priceSol: l.priceSol,
        marketCapSol: l.marketCapSol,
        volume24hSol: l.volume24hSol,
        creatorFeesEarnedSol: lamportsToSol(BigInt(l.creatorFeesClaimed) + BigInt(l.creatorFeesUnclaimed)),
      })),
      backed,
    };
  });

  app.get<{ Params: { wallet: string }; Querystring: Query }>("/api/users/:wallet/activity", async (req) => {
    const wallet = pubkeyParam(req.params.wallet, "wallet").toBase58();
    const limit = intQuery(req.query, "limit", 50, 200);
    const before = intQuery(req.query, "before", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const rows = store.walletActivity(wallet, before, limit);
    return {
      events: rows.map(activityFromRow),
      nextBefore: rows.length === limit && limit > 0 ? rows[rows.length - 1].timestamp : null,
    };
  });
}
