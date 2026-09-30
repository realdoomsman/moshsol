import type { FastifyInstance } from "fastify";

const WINDOW_MS = 60_000;

/** Fixed one-minute request windows per key (client IP, wallet, …). */
export class Limiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(readonly perMin: number) {}

  /** Counts `n` requests; null while within budget, else the seconds until the window resets. */
  hit(ip: string, now: number, n = 1): { wait: number; first: boolean } | null {
    let w = this.windows.get(ip);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + WINDOW_MS };
      this.windows.set(ip, w);
    }
    w.count += n;
    if (w.count <= this.perMin) return null;
    return { wait: Math.ceil((w.resetAt - now) / 1000), first: w.count - n <= this.perMin };
  }

  sweep(now: number): void {
    for (const [ip, w] of this.windows) if (w.resetAt <= now) this.windows.delete(ip);
  }
}

/** Drops expired windows once a minute until the server closes. */
export function sweepLimiters(app: FastifyInstance, limiters: Limiter[]): void {
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const limiter of limiters) limiter.sweep(now);
  }, WINDOW_MS);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));
}

/**
 * Per-IP limits: a generous budget across every route (0 disables) and a tight one for the uploads
 * (`POST /api/upload`, `POST /api/upload/image`: write files to disk). Over-budget requests get 429 + `Retry-After`.
 * The RPC proxy (`/rpc`, `/rpc-ws`) is exempt here: it counts every JSON-RPC call against its own limit.
 */
export function registerRateLimits(app: FastifyInstance, opts: { perMin: number; uploadPerMin: number }): void {
  const all = opts.perMin > 0 ? new Limiter(opts.perMin) : null;
  const upload = opts.uploadPerMin > 0 ? new Limiter(opts.uploadPerMin) : null;
  if (!all && !upload) return;
  sweepLimiters(app, [all, upload].filter((l) => l !== null));

  app.addHook("onRequest", async (req, reply) => {
    const route = req.routeOptions.url;
    if (route === "/rpc" || route === "/rpc-ws") return;
    const now = Date.now();
    const isUpload = req.method === "POST" && route?.startsWith("/api/upload") === true;
    for (const limiter of isUpload ? [all, upload] : [all]) {
      if (!limiter) continue;
      const over = limiter.hit(req.ip, now);
      if (!over) continue;
      if (over.first) req.log.warn({ ip: req.ip, url: req.url, perMin: limiter.perMin }, "rate limit hit");
      return reply
        .code(429)
        .header("Retry-After", String(over.wait))
        .send({ error: `rate limit exceeded (${limiter.perMin} requests/min); retry in ${over.wait}s` });
    }
  });
}
