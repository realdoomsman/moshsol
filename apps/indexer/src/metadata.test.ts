import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { UnfetchableUriError, loadMetadata, parseMetadata } from "./metadata";

const PUBLIC_URL = "https://indexer.example";
const FILES_DIR = "/nonexistent";

/** Loopback HTTP server that counts requests; no request may ever reach it from the metadata fetcher. */
async function trap(): Promise<{ port: number; hits: () => number; close: () => void }> {
  let n = 0;
  const server = http.createServer((_req, res) => {
    n++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ name: "leak" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return { port, hits: () => n, close: () => void server.close() };
}

test("a metadata URI on a private IP literal is unfetchable and never connected to", async (t) => {
  const srv = await trap();
  t.after(srv.close);
  await assert.rejects(loadMetadata(`http://127.0.0.1:${srv.port}/meta.json`, PUBLIC_URL, FILES_DIR), UnfetchableUriError);
  assert.equal(srv.hits(), 0);
});

test("a hostname resolving to a private address is rejected at connect time (pinned lookup), not after a separate check", async (t) => {
  const srv = await trap();
  t.after(srv.close);
  // `localhost` resolves (127.0.0.1 / ::1) inside the socket's lookup, which is where the vetting now happens.
  await assert.rejects(loadMetadata(`http://localhost:${srv.port}/meta.json`, PUBLIC_URL, FILES_DIR), UnfetchableUriError);
  assert.equal(srv.hits(), 0);
});

test("non-http schemes are unfetchable", async () => {
  await assert.rejects(loadMetadata("ftp://example.com/meta.json", PUBLIC_URL, FILES_DIR), UnfetchableUriError);
});

test("hostile metadata links are dropped: non-http schemes anywhere, X/Telegram links off their platform", () => {
  const m = parseMetadata({
    name: "Evil\u202eToken",
    symbol: "EVL",
    image: "javascript:alert(1)",
    extensions: {
      twitter: "https://x.com.evil.example/login",
      telegram: "javascript:alert(document.cookie)",
      website: "data:text/html,<script>alert(1)</script>",
    },
  });
  assert.equal(m.name, "EvilToken");
  assert.equal(m.image, null);
  assert.equal(m.twitter, null);
  assert.equal(m.telegram, null);
  assert.equal(m.website, null);
});

test("X/Telegram handles and on-platform links are kept; the website may be any http(s) URL", () => {
  const m = parseMetadata({
    name: "Fine",
    symbol: "OK",
    twitter: "https://twitter.com/holdfast",
    telegram: "@holdfast_chat",
    website: "https://example.org/about",
  });
  assert.equal(m.twitter, "https://twitter.com/holdfast");
  assert.equal(m.telegram, "@holdfast_chat");
  assert.equal(m.website, "https://example.org/about");
  assert.equal(parseMetadata({ twitter: "https://evil.example/x.com" }).twitter, null);
  assert.equal(parseMetadata({ telegram: "https://t.me.evil.example/chat" }).telegram, null);
});
