import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { randomToken } from "./crypto";

/** An OpenID Connect provider as the accounts service uses it (authorization code + PKCE, server side). */
export interface OidcProvider {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Accepted `iss` values. */
  issuers: string[];
  /** Signing keys for ID tokens. */
  jwks: JWTVerifyGetKey;
}

/** Google's endpoints (https://accounts.google.com/.well-known/openid-configuration). */
export function googleProvider(): OidcProvider {
  return {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    jwks: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
  };
}

/** Seconds of clock skew tolerated on `exp`/`iat`/`nbf`. */
const CLOCK_TOLERANCE_SECS = 30;
const TOKEN_TIMEOUT_MS = 10_000;

export class IdTokenError extends Error {}

export interface OidcClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** A fresh round trip: `state` (CSRF, bound to a cookie), `nonce` (ID-token replay) and the PKCE pair. */
export function newFlow(): { state: string; nonce: string; verifier: string; challenge: string } {
  const verifier = randomToken();
  return {
    state: randomToken(),
    nonce: randomToken(),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

/**
 * Authorization request URL. `reauth` asks Google for an interactive account choice: Google rejects
 * the OIDC `prompt=login` value (it only accepts none/consent/select_account), so a key export is
 * gated on the time of the completed round trip instead (see `EXPORT_REAUTH_SECS`).
 */
export function authorizationUrl(
  provider: OidcProvider,
  client: OidcClient,
  flow: { state: string; nonce: string; challenge: string },
  reauth: boolean,
): string {
  const url = new URL(provider.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: flow.challenge,
    code_challenge_method: "S256",
    ...(reauth ? { prompt: "select_account" } : {}),
  }).toString();
  return url.toString();
}

/** Exchanges an authorization code (with its PKCE verifier) for the ID token. */
export async function exchangeCode(provider: OidcProvider, client: OidcClient, code: string, verifier: string): Promise<string> {
  const res = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof body?.id_token !== "string") {
    throw new IdTokenError(`token endpoint answered ${res.status}${typeof body?.error === "string" ? ` (${body.error})` : ""}`);
  }
  return body.id_token;
}

export interface IdentityClaims {
  sub: string;
  email: string;
}

/**
 * Verifies an ID token: RS256 signature against the provider's keys, `iss`, `aud` (and `azp` when
 * there are several audiences), `exp`/`iat` within CLOCK_TOLERANCE_SECS of `now`, and the `nonce`
 * of this round trip.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { jwks: JWTVerifyGetKey; issuers: string[]; clientId: string; nonce: string; now: Date },
): Promise<IdentityClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, opts.jwks, {
      issuer: opts.issuers,
      audience: opts.clientId,
      algorithms: ["RS256"],
      currentDate: opts.now,
      clockTolerance: CLOCK_TOLERANCE_SECS,
      requiredClaims: ["sub", "iat", "exp"],
    }));
  } catch (err) {
    throw new IdTokenError(`ID token rejected: ${(err as Error).message}`);
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== opts.clientId) {
    throw new IdTokenError("ID token rejected: azp is not this client");
  }
  if (payload.nonce !== opts.nonce) throw new IdTokenError("ID token rejected: nonce mismatch");
  const { sub, email } = payload;
  if (typeof sub !== "string" || sub === "") throw new IdTokenError("ID token rejected: missing sub");
  if (typeof email !== "string" || email === "") throw new IdTokenError("ID token rejected: missing email");
  return { sub, email };
}
