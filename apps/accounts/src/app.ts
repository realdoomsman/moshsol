import cookie from "@fastify/cookie";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { keyedHash, randomToken, type WalletCipher } from "./crypto";
import { FLOW_TTL_SECS, type SessionUser, type Store } from "./db";
import { authorizationUrl, exchangeCode, newFlow, verifyIdToken, type OidcClient, type OidcProvider } from "./oidc";
import { PolicyError, checkTransaction, signChecked } from "./policy";
import { Limiter } from "./ratelimit";

/** Sessions last a week from sign-in (no sliding renewal). */
export const SESSION_TTL_SECS = 7 * 86_400;
/** A key export needs a Google sign-in completed less than this many seconds ago, and spends it. */
export const EXPORT_REAUTH_SECS = 600;
/** Most transactions one `POST /api/wallet/sign` signs (wallet-adapter `signAllTransactions`). */
const MAX_SIGN_BATCH = 10;
const PRUNE_MS = 10 * 60_000;
const RETURN_MAX_LENGTH = 512;

/** Thrown on purpose: status + a message that is safe to show. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AppOptions {
  siteOrigin: string;
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: Buffer;
  rateLimitPerMin: number;
  signLimitPerMin: number;
  trustProxy: boolean | string;
}

export interface AppDeps {
  store: Store;
  cipher: WalletCipher;
  provider: OidcProvider;
  /** Wall clock in ms; tests move it. */
  now?: () => number;
  logger?: boolean;
}

/**
 * The accounts API. The browser reaches it only through the web app's origin (Next.js proxies
 * `/api/auth/*` and `/api/wallet/*`), so cookies are first-party:
 *
 * - `GET  /api/auth/google?return=<path>[&reauth=1]` → Google (authorization code + PKCE, state + nonce)
 * - `GET  /api/auth/google/callback` → verifies the ID token, creates the user + wallet on first sign-in,
 *   starts a session, redirects to `return` (`?auth_error=cancelled|expired|failed` on failure)
 * - `GET  /api/auth/me` → `{ email, address }` or 401
 * - `POST /api/auth/logout`
 * - `POST /api/wallet/sign` `{ transactions: base64[] }` → `{ transactions: base64[] }` (signing policy: policy.ts)
 * - `POST /api/wallet/export` → `{ secretKey }` (base58) or 403 `reauth_required`
 *
 * POSTs must carry `x-holdfast: 1` and come from the site's origin.
 */
export async function buildApp(opts: AppOptions, deps: AppDeps): Promise<FastifyInstance> {
  const { store, cipher, provider } = deps;
  const nowMs = deps.now ?? Date.now;
  const nowSecs = () => Math.floor(nowMs() / 1000);
  const secure = new URL(opts.siteOrigin).protocol === "https:";
  // `__Host-` pins the cookie to this exact origin (Secure, Path=/, no Domain); browsers refuse it on http.
  const sessionCookie = secure ? "__Host-hf_session" : "hf_session";
  const flowCookie = secure ? "__Host-hf_oauth" : "hf_oauth";
  const cookieBase = { path: "/", httpOnly: true, secure, sameSite: "lax" } as const;
  const client: OidcClient = {
    clientId: opts.googleClientId,
    clientSecret: opts.googleClientSecret,
    redirectUri: `${opts.siteOrigin}/api/auth/google/callback`,
  };
  const sessionHash = (id: string) => keyedHash(opts.sessionSecret, "session", id);
  const stateHash = (state: string) => keyedHash(opts.sessionSecret, "oauth-state", state);

  const app = Fastify({
    logger: deps.logger === false ? false : { level: process.env.LOG_LEVEL || "info", base: null, timestamp: () => `,"time":"${new Date().toISOString()}"` },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: opts.trustProxy,
    bodyLimit: 64 * 1024,
  });
  await app.register(cookie);

  app.setErrorHandler((err: unknown, req, reply) => {
    const code = err instanceof Error && "statusCode" in err ? err.statusCode : undefined;
    const status = typeof code === "number" && code >= 400 && code < 600 ? code : 500;
    const intended = err instanceof HttpError;
    if (status >= 500 && !intended) req.log.error({ err, url: req.url }, "request failed");
    const message = err instanceof Error ? err.message : String(err);
    void reply.status(status).send({ error: intended || status < 500 ? message : "internal server error" });
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: "not found" });
  });

  const ipLimiter = opts.rateLimitPerMin > 0 ? new Limiter(opts.rateLimitPerMin) : null;
  const signUserLimiter = opts.signLimitPerMin > 0 ? new Limiter(opts.signLimitPerMin) : null;
  const signIpLimiter = opts.signLimitPerMin > 0 ? new Limiter(opts.signLimitPerMin) : null;
  const pruner = setInterval(() => {
    const now = nowMs();
    for (const limiter of [ipLimiter, signUserLimiter, signIpLimiter]) limiter?.sweep(now);
    store.prune(nowSecs());
  }, PRUNE_MS);
  pruner.unref();
  app.addHook("onClose", async () => clearInterval(pruner));

  /** Counts `n` requests for `key`; over budget → 429 with Retry-After. */
  const charge = (reply: FastifyReply, limiter: Limiter | null, key: string, n = 1) => {
    const wait = limiter?.hit(key, nowMs(), n);
    if (!limiter || !wait) return;
    void reply.header("retry-after", String(wait));
    throw new HttpError(429, `rate limit exceeded (${limiter.perMin} requests/min); retry in ${wait}s`);
  };

  app.addHook("onRequest", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    if (req.url === "/health") return;
    charge(reply, ipLimiter, req.ip);
    // CSRF: state-changing calls need a header a cross-site form/navigation can't send (a cross-origin
    // fetch with it needs a CORS preflight, which this API never grants) and the site's own Origin.
    if (req.method === "GET" || req.method === "HEAD") return;
    const fetchSite = req.headers["sec-fetch-site"];
    if (req.headers["x-holdfast"] !== "1" || req.headers.origin !== opts.siteOrigin || (fetchSite !== undefined && fetchSite !== "same-origin")) {
      throw new HttpError(403, "cross-site request refused");
    }
  });

  /** Signing and exports also count per user and per IP (`n` = transactions in the request). */
  const chargeSigning = (reply: FastifyReply, userId: number, ip: string, n: number) => {
    charge(reply, signUserLimiter, `u:${userId}`, n);
    charge(reply, signIpLimiter, ip, n);
  };

  const currentSession = (req: FastifyRequest): { idHash: string; user: SessionUser } => {
    const id = req.cookies[sessionCookie];
    const idHash = id ? sessionHash(id) : null;
    const user = idHash ? store.sessionUser(idHash, nowSecs()) : undefined;
    if (!idHash || !user) throw new HttpError(401, "not signed in");
    return { idHash, user };
  };

  /** Site-relative path to land on after sign-in; anything else (absolute, protocol-relative, overlong) → `/`. */
  const safeReturn = (raw: unknown): string => {
    if (typeof raw !== "string" || !/^\/(?![/\\])/.test(raw) || raw.length > RETURN_MAX_LENGTH) return "/";
    const url = new URL(raw, opts.siteOrigin);
    return url.origin === opts.siteOrigin ? `${url.pathname}${url.search}` : "/";
  };

  const backToSite = (reply: FastifyReply, returnTo: string, error?: "cancelled" | "expired" | "failed") => {
    const url = new URL(returnTo, opts.siteOrigin);
    if (error) url.searchParams.set("auth_error", error);
    return reply.redirect(url.toString());
  };

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Querystring: { return?: string; reauth?: string } }>("/api/auth/google", async (req, reply) => {
    const flow = newFlow();
    store.insertFlow(stateHash(flow.state), { verifier: flow.verifier, nonce: flow.nonce, return_to: safeReturn(req.query.return) }, nowSecs());
    void reply.setCookie(flowCookie, flow.state, { ...cookieBase, maxAge: FLOW_TTL_SECS });
    return reply.redirect(authorizationUrl(provider, client, flow, req.query.reauth === "1"));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/google/callback", async (req, reply) => {
    const { code, state, error } = req.query;
    const cookieState = req.cookies[flowCookie];
    void reply.clearCookie(flowCookie, cookieBase);
    // The state must match this browser's cookie (login CSRF) and a stored, unexpired round trip.
    const flow = typeof state === "string" && state === cookieState ? store.takeFlow(stateHash(state)) : undefined;
    if (!flow || flow.created_at <= nowSecs() - FLOW_TTL_SECS) return backToSite(reply, "/", "expired");
    if (typeof error === "string") return backToSite(reply, flow.return_to, error === "access_denied" ? "cancelled" : "failed");
    if (typeof code !== "string" || code === "") return backToSite(reply, flow.return_to, "failed");

    let identity;
    try {
      const idToken = await exchangeCode(provider, client, code, flow.verifier);
      identity = await verifyIdToken(idToken, {
        jwks: provider.jwks,
        issuers: provider.issuers,
        clientId: client.clientId,
        nonce: flow.nonce,
        now: new Date(nowMs()),
      });
    } catch (err) {
      req.log.warn({ reason: err instanceof Error ? err.message : String(err) }, "google sign-in failed");
      return backToSite(reply, flow.return_to, "failed");
    }

    const now = nowSecs();
    const { userId, created } = store.tx(() => {
      const existing = store.userBySub(identity.sub);
      if (existing) {
        store.touchUser(existing.id, identity.email, now);
        return { userId: existing.id, created: false };
      }
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();
      const secret = cipher.seal(keypair.secretKey, address);
      return { userId: store.insertUser({ sub: identity.sub, email: identity.email, address, secret, keyId: cipher.keyId }, now), created: true };
    });
    store.audit(userId, created ? "signup" : "login", null, req.ip, now);

    // A new session id on every sign-in; the one this browser had (if any) ends.
    const previous = req.cookies[sessionCookie];
    if (previous) store.deleteSession(sessionHash(previous));
    const sessionId = randomToken();
    store.createSession(sessionHash(sessionId), userId, now, now + SESSION_TTL_SECS);
    void reply.setCookie(sessionCookie, sessionId, { ...cookieBase, maxAge: SESSION_TTL_SECS });
    return backToSite(reply, flow.return_to);
  });

  app.get("/api/auth/me", async (req) => {
    const { user } = currentSession(req);
    return { email: user.email, address: user.address };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const id = req.cookies[sessionCookie];
    if (id) {
      const idHash = sessionHash(id);
      const user = store.sessionUser(idHash, nowSecs());
      store.deleteSession(idHash);
      if (user) store.audit(user.id, "logout", null, req.ip, nowSecs());
    }
    void reply.clearCookie(sessionCookie, cookieBase);
    return { ok: true };
  });

  app.post<{ Body: { transactions?: unknown } | null }>("/api/wallet/sign", async (req, reply) => {
    const { user } = currentSession(req);
    const list = req.body?.transactions;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SIGN_BATCH || !list.every((t): t is string => typeof t === "string")) {
      throw new HttpError(400, `transactions must be an array of 1–${MAX_SIGN_BATCH} base64 strings`);
    }
    chargeSigning(reply, user.id, req.ip, list.length);
    const now = nowSecs();
    const owner = new PublicKey(user.address);
    const checked = list.map((b64, i) => {
      const raw = Buffer.from(b64, "base64");
      try {
        return { raw, signable: checkTransaction(raw, owner) };
      } catch (err) {
        if (!(err instanceof PolicyError)) throw err;
        const reason = list.length > 1 ? `transaction ${i + 1}: ${err.message}` : err.message;
        store.audit(user.id, "sign_rejected", reason, req.ip, now);
        throw new HttpError(400, reason);
      }
    });
    const secret = cipher.open(user.secret, user.key_id, user.address);
    try {
      const signed = checked.map(({ raw, signable }) => Buffer.from(signChecked(raw, signable, secret)).toString("base64"));
      store.tx(() => {
        for (const { signable } of checked) store.audit(user.id, "sign", signable.messageHash, req.ip, now);
      });
      return { transactions: signed };
    } finally {
      secret.fill(0);
    }
  });

  app.post("/api/wallet/export", async (req, reply) => {
    const { idHash, user } = currentSession(req);
    chargeSigning(reply, user.id, req.ip, 1);
    const now = nowSecs();
    if (user.auth_at === null || now - user.auth_at >= EXPORT_REAUTH_SECS) throw new HttpError(403, "reauth_required");
    store.spendAuth(idHash);
    const secret = cipher.open(user.secret, user.key_id, user.address);
    try {
      store.audit(user.id, "export", null, req.ip, now);
      return { secretKey: bs58.encode(secret) };
    } finally {
      secret.fill(0);
    }
  });

  return app;
}
