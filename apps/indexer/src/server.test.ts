import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "./server";

test("every response carries the security headers: API errors, rate-limited paths and uploaded files (SVGs sandboxed)", async (t) => {
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-server-"));
  t.after(() => fs.rmSync(filesDir, { recursive: true, force: true }));
  const app = await createServer({ filesDir, publicUrl: "http://indexer.test", rateLimitPerMin: 0, uploadLimitPerMin: 0, trustProxy: false });
  t.after(() => app.close());
  fs.writeFileSync(path.join(filesDir, "img", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(filesDir, "img", "b.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  app.get("/api/boom", async () => {
    throw new Error("secret detail");
  });
  await app.ready();

  for (const url of ["/api/missing", "/api/boom", "/files/img/a.png", "/files/img/b.svg"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.headers["x-content-type-options"], "nosniff", url);
    assert.equal(res.headers["x-frame-options"], "DENY", url);
    assert.equal(res.headers["referrer-policy"], "no-referrer", url);
    assert.equal(res.headers["strict-transport-security"], "max-age=31536000", url);
  }
  const svg = await app.inject({ method: "GET", url: "/files/img/b.svg" });
  assert.equal(svg.statusCode, 200);
  assert.match(String(svg.headers["content-security-policy"]), /default-src 'none'/);
});
