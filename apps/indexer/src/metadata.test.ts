import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { UnfetchableUriError, loadMetadata } from "./metadata";

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
