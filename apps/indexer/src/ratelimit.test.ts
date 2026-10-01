import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { INTERNAL_HEADER, registerRateLimits } from "./ratelimit";

const TOKEN = "internal-test-token";

test("the internal token skips the general per-IP budget; a wrong, missing or empty one does not, and uploads still count", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerRateLimits(app, { perMin: 2, uploadPerMin: 1, internalToken: TOKEN });
  app.get("/api/x", async () => ({ ok: true }));
  app.post("/api/upload", async () => ({ ok: true }));
  await app.ready();
  const get = (headers: Record<string, string> = {}) => app.inject({ method: "GET", url: "/api/x", headers });

  // Internal requests never touch the shared budget, however many there are.
  for (let i = 0; i < 5; i++) assert.equal((await get({ [INTERNAL_HEADER]: TOKEN })).statusCode, 200);
  assert.equal((await get()).statusCode, 200);
  assert.equal((await get({ [INTERNAL_HEADER]: "wrong-token" })).statusCode, 200);
  // Budget (2) spent by the anonymous and the wrong-token request: neither was exempt.
  assert.equal((await get()).statusCode, 429);
  assert.equal((await get({ [INTERNAL_HEADER]: `${TOKEN}x` })).statusCode, 429);
  assert.equal((await get({ [INTERNAL_HEADER]: "" })).statusCode, 429);
  assert.equal((await get({ [INTERNAL_HEADER]: TOKEN })).statusCode, 200);

  // The upload budget (1/min) applies to internal requests too.
  const upload = () => app.inject({ method: "POST", url: "/api/upload", headers: { [INTERNAL_HEADER]: TOKEN } });
  assert.equal((await upload()).statusCode, 200);
  assert.equal((await upload()).statusCode, 429);
});

test("without a configured token nobody is exempt, not even a request sending an empty header", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerRateLimits(app, { perMin: 1, uploadPerMin: 0, internalToken: null });
  app.get("/api/x", async () => ({ ok: true }));
  await app.ready();
  assert.equal((await app.inject({ method: "GET", url: "/api/x", headers: { [INTERNAL_HEADER]: "" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/x", headers: { [INTERNAL_HEADER]: "" } })).statusCode, 429);
});
