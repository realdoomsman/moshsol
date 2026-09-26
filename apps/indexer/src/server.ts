import fs from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Hub } from "./hub";
import { registerRateLimits } from "./ratelimit";
import { NotFoundError, registerRoutes, type RouteDeps } from "./routes";
import { ValidationError } from "./sanitize";
import { MAX_IMAGE_BYTES, registerUpload } from "./upload";

export interface ServerOptions {
  filesDir: string;
  publicUrl: string;
  rateLimitPerMin: number;
  uploadLimitPerMin: number;
  trustProxy: boolean;
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
    if (status >= 500) req.log.error({ err, url: req.url }, "request failed");
    const message = status >= 500 || !(err instanceof Error) ? "internal server error" : err.message;
    void reply.status(status).send({ error: message });
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: "not found" });
  });

  await app.register(cors, { origin: "*", methods: ["GET", "POST", "OPTIONS"] });
  // After CORS so 429s still carry Access-Control-Allow-Origin and browsers can read them.
  registerRateLimits(app, { perMin: opts.rateLimitPerMin, uploadPerMin: opts.uploadLimitPerMin });
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 12, fieldSize: 3 * 1024 * 1024 },
  });
  await app.register(websocket);
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

/** Registers `/ws`, the JSON API and the upload endpoint. */
export function registerApi(
  app: FastifyInstance,
  deps: RouteDeps & { hub: Hub },
  opts: Pick<ServerOptions, "filesDir" | "publicUrl">,
): void {
  app.get("/ws", { websocket: true }, (socket) => deps.hub.add(socket));
  registerRoutes(app, deps);
  registerUpload(app, opts);
}
