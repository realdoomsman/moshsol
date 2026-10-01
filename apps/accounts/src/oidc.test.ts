import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { IdTokenError, verifyIdToken } from "./oidc";

const ISSUER = "https://accounts.google.com";
const CLIENT_ID = "holdfast-test.apps.googleusercontent.com";
const NONCE = "n-0S6_WzA2Mj";
const NOW = new Date("2026-09-30T12:00:00Z");
const nowSecs = Math.floor(NOW.getTime() / 1000);

const signing = await generateKeyPair("RS256", { extractable: true });
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
const verifyOpts = { jwks, issuers: [ISSUER, "accounts.google.com"], clientId: CLIENT_ID, nonce: NONCE, now: NOW };

async function idToken(
  over: { iss?: string; aud?: string; exp?: number; nonce?: string; key?: CryptoKey } = {},
): Promise<string> {
  return new SignJWT({ email: "backer@example.com", nonce: over.nonce ?? NONCE })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(over.iss ?? ISSUER)
    .setAudience(over.aud ?? CLIENT_ID)
    .setSubject("110169484474386276334")
    .setIssuedAt(nowSecs - 10)
    .setExpirationTime(over.exp ?? nowSecs + 3_600)
    .sign(over.key ?? signing.privateKey);
}

async function rejected(token: Promise<string>, reason: RegExp): Promise<void> {
  await assert.rejects(verifyIdToken(await token, verifyOpts), (err: unknown) => err instanceof IdTokenError && reason.test(err.message));
}

test("accepts a Google-shaped ID token for this client and round trip", async () => {
  assert.deepEqual(await verifyIdToken(await idToken(), verifyOpts), { sub: "110169484474386276334", email: "backer@example.com" });
});

test("rejects a token issued for another client", async () => {
  await rejected(idToken({ aud: "someone-else.apps.googleusercontent.com" }), /aud/);
});

test("rejects a token from another issuer", async () => {
  await rejected(idToken({ iss: "https://accounts.example.com" }), /iss/);
});

test("rejects an expired token", async () => {
  await rejected(idToken({ exp: nowSecs - 120 }), /exp/);
});

test("rejects a token minted for another sign-in (nonce)", async () => {
  await rejected(idToken({ nonce: "replayed" }), /nonce mismatch/);
});

test("rejects a token not signed by the provider's keys", async () => {
  const forger = await generateKeyPair("RS256");
  await rejected(idToken({ key: forger.privateKey }), /signature/);
});
