import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createLocalJWKSet } from "jose";
import { EXPORT_REAUTH_SECS, SESSION_TTL_SECS, buildApp } from "./app";
import { WalletCipher, keyedHash, randomToken } from "./crypto";
import { Store } from "./db";

const SITE = "https://holdfast.test";
const sessionSecret = randomBytes(32);
const cipher = new WalletCipher(randomBytes(32));
const store = new Store(":memory:");
const clock = { ms: Date.UTC(2026, 8, 30, 12) };
const app = await buildApp(
  {
    siteOrigin: SITE,
    googleClientId: "holdfast-test.apps.googleusercontent.com",
    googleClientSecret: "test-secret",
    sessionSecret,
    rateLimitPerMin: 0,
    signLimitPerMin: 0,
    trustProxy: false,
  },
  {
    store,
    cipher,
    // Never reached by these tests: no request gets as far as Google.
    provider: { authorizationEndpoint: "https://idp.test/auth", tokenEndpoint: "https://idp.test/token", issuers: ["https://idp.test"], jwks: createLocalJWKSet({ keys: [] }) },
    now: () => clock.ms,
    logger: false,
  },
);
after(() => app.close());

const nowSecs = () => Math.floor(clock.ms / 1000);

/** A user whose session was created by a Google sign-in completing now. */
function signedIn(): { cookie: string; wallet: Keypair } {
  const wallet = Keypair.generate();
  const address = wallet.publicKey.toBase58();
  const sub = randomToken();
  const userId = store.insertUser({ sub, email: `${sub}@example.com`, address, secret: cipher.seal(wallet.secretKey, address), keyId: cipher.keyId }, nowSecs());
  const sessionId = randomToken();
  store.createSession(keyedHash(sessionSecret, "session", sessionId), userId, nowSecs(), nowSecs() + SESSION_TTL_SECS);
  return { cookie: `__Host-hf_session=${sessionId}`, wallet };
}

const exportKey = (cookie: string, headers: Record<string, string> = { "x-holdfast": "1", origin: SITE }) =>
  app.inject({ method: "POST", url: "/api/wallet/export", headers: { cookie, ...headers } });

test("export returns the wallet's key within 10 minutes of the Google sign-in, and only once", async () => {
  const { cookie, wallet } = signedIn();
  clock.ms += (EXPORT_REAUTH_SECS - 1) * 1000;
  const first = await exportKey(cookie);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(bs58.decode(first.json<{ secretKey: string }>().secretKey), wallet.secretKey);
  const second = await exportKey(cookie);
  assert.equal(second.statusCode, 403);
  assert.equal(second.json<{ error: string }>().error, "reauth_required");
});

test("export 10 minutes after the sign-in requires signing in again", async () => {
  const { cookie } = signedIn();
  clock.ms += EXPORT_REAUTH_SECS * 1000;
  const res = await exportKey(cookie);
  assert.equal(res.statusCode, 403);
  assert.equal(res.json<{ error: string }>().error, "reauth_required");
});

test("state-changing calls without the custom header or from another origin are refused before acting", async () => {
  const { cookie } = signedIn();
  const refused: Record<string, string>[] = [{ origin: SITE }, { "x-holdfast": "1", origin: "https://evil.test" }, { "x-holdfast": "1" }];
  for (const headers of refused) {
    const res = await exportKey(cookie, headers);
    assert.equal(res.statusCode, 403, JSON.stringify(headers));
    assert.equal(res.json<{ error: string }>().error, "cross-site request refused");
  }
  assert.equal((await exportKey(cookie)).statusCode, 200, "the refused calls did not spend the sign-in");
});

test("a Google callback whose state isn't this browser's round trip starts no session", async () => {
  const start = await app.inject({ method: "GET", url: "/api/auth/google?return=/launch/abc" });
  assert.equal(start.statusCode, 302);
  const flowCookie = start.cookies.find((c) => c.name === "__Host-hf_oauth");
  assert.ok(flowCookie);
  const state = new URL(start.headers.location!).searchParams.get("state");
  assert.equal(state, flowCookie.value);

  const forged = await app.inject({
    method: "GET",
    url: `/api/auth/google/callback?code=attacker-code&state=${randomToken()}`,
    headers: { cookie: `__Host-hf_oauth=${flowCookie.value}` },
  });
  assert.equal(forged.statusCode, 302);
  assert.equal(forged.headers.location, `${SITE}/?auth_error=expired`);
  assert.ok(!forged.cookies.some((c) => c.name === "__Host-hf_session" && c.value !== ""));
});

test("sign-in only ever returns to this site: off-site, protocol-relative and dot-segment returns land on /", async () => {
  /** Where the callback sends the browser for `return` (a cancelled consent still redirects to it). */
  const landing = async (ret: string) => {
    const start = await app.inject({ method: "GET", url: `/api/auth/google?return=${encodeURIComponent(ret)}` });
    const state = new URL(start.headers.location!).searchParams.get("state")!;
    const cb = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?error=access_denied&state=${state}`,
      headers: { cookie: `__Host-hf_oauth=${state}` },
    });
    return cb.headers.location;
  };
  for (const ret of ["https://evil.test/", "//evil.test/", "/\\evil.test", "/\t/evil.test", "/..//evil.test", "/.//evil.test", "/%2e%2e//evil.test", "javascript:alert(1)"]) {
    assert.equal(await landing(ret), `${SITE}/?auth_error=cancelled`, ret);
  }
  assert.equal(await landing("/launch/abc?tab=trades"), `${SITE}/launch/abc?tab=trades&auth_error=cancelled`);
});
