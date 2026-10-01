import fs from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { ArweaveStore } from "./arweave";
import { registerDiscoveryRoutes } from "./discovery";
import type { Holders } from "./holders";
import type { Hub } from "./hub";
import { registerRateLimits } from "./ratelimit";
import { NotFoundError, registerRoutes, type RouteDeps } from "./routes";
import { HttpError, ValidationError } from "./sanitize";
import { registerSocialRoutes } from "./social";
import { MAX_IMAGE_BYTES, registerUpload } from "./upload";

export interface ServerOptions {
  filesDir: string;
  publicUrl: string;
  rateLimitPerMin: number;
  uploadLimitPerMin: number;
  /** X-Forwarded-For trust: `true` = every hop, a string = comma-separated trusted proxy addresses/CIDRs/keywords. */
  trustProxy: boolean | string;
}

const statusOf = (err: unknown): number => {
  if (err instanceof ValidationError) return 400;
  if (err instanceof NotFoundError) return 404;
  const code = typeof err === "object" && err !== null && "statusCode" in err ? err.statusCode : undefined;
  return typeof code === "number" && code >= 400 && code < 600 ? code : 500;
};

/** Fastify instance with plugins, error handling and `/files` static serving (no API routes yet). */
export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  for (const dir of ["img", "meta"]) fs.mkdirSync(path.join(opts.filesDir, dir), { recursive: true });

  const app = Fastify({
    // One compact JSON line per event: ISO time, no pid/hostname.
    logger: {
      level: process.env.LOG_LEVEL || "info",
      base: null,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: opts.trustProxy,
  });

  app.setErrorHandler((err, req, reply) => {
    const status = statusOf(err);
    // HttpError is thrown on purpose (e.g. 503 "moderation disabled"): its message is safe to show at any status.
    const intended = err instanceof HttpError;
    if (status >= 500 && !intended) req.log.error({ err, url: req.url }, "request failed");
    const message = intended || (status < 500 && err instanceof Error) ? err.message : "internal server error";
    void reply.status(status).send({ error: message });
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: "not found" });
  });

  await app.register(cors, { origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] });
  // After CORS so 429s still carry Access-Control-Allow-Origin and browsers can read them.
  registerRateLimits(app, { perMin: opts.rateLimitPerMin, uploadPerMin: opts.uploadLimitPerMin });
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 12, fieldSize: 3 * 1024 * 1024 },
  });
  // Clients only ever send small JSON frames (`/rpc-ws` subscriptions); ws would otherwise buffer up to 100 MiB.
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(fastifyStatic, {
    root: opts.filesDir,
    prefix: "/files/",
    index: false,
    list: false,
    dotfiles: "deny",
    decorateReply: false,
    maxAge: "365d",
    immutable: true,
    setHeaders(reply, filePath) {
      reply.header("X-Content-Type-Options", "nosniff");
      if (filePath.endsWith(".svg")) {
        reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      }
    },
  });
  return app;
}

/** Registers `/ws`, the JSON API (chain data, social, discovery) and the upload endpoints. */
export function registerApi(
  app: FastifyInstance,
  deps: RouteDeps & { hub: Hub; holders: Holders },
  opts: Pick<ServerOptions, "filesDir" | "publicUrl"> & {
    adminToken: string | null;
    commentLimitPerMin: number;
    socialIpLimitPerMin: number;
    /** Upload backend when STORAGE=arweave; null keeps uploads under FILES_DIR. */
    arweave: ArweaveStore | null;
  },
): void {
  app.get("/ws", { websocket: true }, (socket) => deps.hub.add(socket));
  registerRoutes(app, deps);
  registerSocialRoutes(app, { ...opts, store: deps.store, hub: deps.hub, holders: deps.holders, price: deps.price });
  registerDiscoveryRoutes(app, { store: deps.store, price: deps.price });
  registerUpload(app, opts);
}
