import type { FastifyInstance } from "fastify";
import { TtlCache } from "./cache";
import { fetchRemoteJson, loadMetadata, parseMetadata, probeStatus, UnfetchableUriError } from "./metadata";
import { Limiter, sweepLimiters } from "./ratelimit";
import { ValidationError } from "./sanitize";

/** `GET /api/meta-ready` requests per minute per client IP (one launch panel polls every 5 s). */
const META_READY_LIMIT_PER_MIN = 30;
/** Concurrent and back-to-back pollers of one URI share a check for this long. */
const CHECK_TTL_MS = 4_000;
/** URIs remembered as ready (Arweave data never goes away once served); oldest dropped first. */
const READY_MAX = 2_000;
const MAX_URI_LEN = 500;

export interface MetaReady {
  /** The metadata JSON and its image (when it names one) both answered 200 from the public network. */
  ready: boolean;
  uri: string;
  image: string | null;
}

/**
 * `GET /api/meta-ready?uri=`: whether a launch's metadata is publicly served yet (the metadata JSON parses and its
 * `image` answers 200), checked from this server through the SSRF-vetted fetcher and never from the local upload
 * cache: pump.fun reads the URI once when `launch_pump` creates the token, and Arweave gateways lag fresh uploads.
 * URIs under our own `PUBLIC_URL/files/meta/` are served from disk and ready at once.
 */
export function registerMetaReady(app: FastifyInstance, opts: { publicUrl: string; filesDir: string }): void {
  const limiter = new Limiter(META_READY_LIMIT_PER_MIN);
  sweepLimiters(app, [limiter]);
  const checks = new TtlCache<MetaReady>(CHECK_TTL_MS);
  const ready = new Map<string, MetaReady>();
  const ownPrefix = `${opts.publicUrl}/files/meta/`;

  const check = async (uri: string): Promise<MetaReady> => {
    if (uri.startsWith(ownPrefix)) {
      const meta = await loadMetadata(uri, opts.publicUrl, opts.filesDir).catch(() => null);
      return { ready: meta !== null, uri, image: meta?.image ?? null };
    }
    let image: string | null;
    try {
      image = parseMetadata(await fetchRemoteJson(uri)).image;
    } catch (err) {
      if (err instanceof UnfetchableUriError) throw new ValidationError(err.message);
      return { ready: false, uri, image: null };
    }
    if (image === null) return { ready: true, uri, image };
    const status = await probeStatus(image).catch(() => 0);
    return { ready: status === 200, uri, image };
  };

  app.get<{ Querystring: { uri?: string } }>("/api/meta-ready", async (req, reply) => {
    const over = limiter.hit(req.ip, Date.now());
    if (over) {
      if (over.first) req.log.warn({ ip: req.ip, perMin: META_READY_LIMIT_PER_MIN }, "meta-ready rate limit hit");
      return reply
        .code(429)
        .header("Retry-After", String(over.wait))
        .send({ error: `rate limit exceeded (${META_READY_LIMIT_PER_MIN} meta-ready requests/min); retry in ${over.wait}s` });
    }
    const uri = req.query.uri;
    if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_URI_LEN) {
      throw new ValidationError(`uri must be 1-${MAX_URI_LEN} characters`);
    }
    void reply.header("cache-control", "no-store");
    const known = ready.get(uri);
    if (known) return known;
    const result = await checks.get(uri, () => check(uri));
    if (result.ready) {
      if (ready.size >= READY_MAX) ready.delete(ready.keys().next().value!);
      ready.set(uri, result);
    }
    return result;
  });
}
