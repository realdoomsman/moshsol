import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { Narrator, loadNarratorConfig } from "../src/narrate";

type Seen = { path: string; model: string; auth: string | undefined };

/** A chat-completions endpoint that answers from a script of statuses and records what it was asked. */
async function fakeEndpoint(statuses: number[]): Promise<{ url: string; seen: Seen[]; close(): void }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { model: string };
      seen.push({ path: req.url ?? "", model: body.model, auth: req.headers.authorization });
      const status = statuses.shift() ?? 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: `  ${body.model} says hi.  ` } }] }) : "{}");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/openai`, seen, close: () => server.close() };
}

const NO_WAIT = { retryDelaysMs: [0, 0] };

test("loadNarratorConfig needs url, key and model; the fallback model is optional", () => {
  assert.equal(loadNarratorConfig({ AI_API_URL: "u", AI_API_KEY: "k" }), null);
  assert.deepEqual(loadNarratorConfig({ AI_API_URL: "u", AI_API_KEY: "k", AI_MODEL: "m" }), { url: "u", key: "k", model: "m" });
  assert.deepEqual(loadNarratorConfig({ AI_API_URL: "u ", AI_API_KEY: "k", AI_MODEL: "m", AI_MODEL_FALLBACK: "f" }), {
    url: "u",
    key: "k",
    model: "m",
    fallbackModel: "f",
  });
});

test("base URL and full completions URL hit the same path with the bearer key", async () => {
  const ep = await fakeEndpoint([]);
  const fromBase = new Narrator({ url: ep.url + "/", key: "sekret", model: "gemini" }, NO_WAIT);
  const fromFull = new Narrator({ url: ep.url + "/chat/completions", key: "sekret", model: "gemini" }, NO_WAIT);
  assert.equal(await fromBase.narrate("sys", "user"), "gemini says hi.");
  assert.equal(await fromFull.narrate("sys", "user"), "gemini says hi.");
  assert.deepEqual(ep.seen, [
    { path: "/openai/chat/completions", model: "gemini", auth: "Bearer sekret" },
    { path: "/openai/chat/completions", model: "gemini", auth: "Bearer sekret" },
  ]);
  ep.close();
});

test("429 and 503 are retried twice; a persistent 503 or 429 falls back to the fallback model", async () => {
  const ep = await fakeEndpoint([429, 503, 200, 503, 503, 503, 200, 429, 429, 429, 200]);
  const narrator = new Narrator({ url: ep.url, key: "k", model: "primary", fallbackModel: "backup" }, NO_WAIT);
  assert.equal(await narrator.narrate("sys", "user"), "primary says hi.");
  assert.equal(await narrator.narrate("sys", "user"), "backup says hi.");
  assert.equal(await narrator.narrate("sys", "user"), "backup says hi.");
  assert.deepEqual(
    ep.seen.map((s) => s.model),
    ["primary", "primary", "primary", "primary", "primary", "primary", "backup", "primary", "primary", "primary", "backup"],
  );
  ep.close();
});

test("any other error gives null without the fallback or extra retries; a persistent 429 without a fallback model gives null", async () => {
  const ep = await fakeEndpoint([500, 429, 429, 429]);
  const withFallback = new Narrator({ url: ep.url, key: "k", model: "primary", fallbackModel: "backup" }, NO_WAIT);
  assert.equal(await withFallback.narrate("sys", "user"), null);
  const noFallback = new Narrator({ url: ep.url, key: "k", model: "primary" }, NO_WAIT);
  assert.equal(await noFallback.narrate("sys", "user"), null);
  assert.equal(ep.seen.length, 4);
  assert.ok(ep.seen.every((s) => s.model === "primary"));
  ep.close();
});

test("a dead endpoint yields null instead of throwing", async () => {
  const narrator = new Narrator({ url: "http://127.0.0.1:1/openai", key: "k", model: "m" }, NO_WAIT);
  assert.equal(await narrator.narrate("sys", "user"), null);
});
