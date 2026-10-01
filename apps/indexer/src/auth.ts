import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { HttpError, ValidationError } from "./sanitize";

/** Signed messages are accepted when their timestamp is within this many seconds of the server clock. */
export const SIGNATURE_MAX_SKEW_SECS = 300;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58].map((c, i) => [c, i]));
// DER SubjectPublicKeyInfo header for a raw 32-byte Ed25519 key (RFC 8410).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Decodes base58 (Bitcoin alphabet); null on any invalid character. */
function base58Decode(s: string): Buffer | null {
  const bytes: number[] = [];
  for (const c of s) {
    let carry = BASE58_INDEX.get(c);
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

export interface SignedRequest {
  /** Signer (base58 public key). */
  wallet: string;
  /** The exact UTF-8 text the wallet signed. */
  message: string;
  /** Base58 Ed25519 signature of `message`. */
  signature: string;
}

/**
 * Verifies a `holdfast:<kind>:v1\n<subject>\n<sha256(payload) hex>\n<unix ts>` message signed by `wallet`
 * (e.g. Solana wallet-adapter `signMessage`). Returns the message timestamp.
 *
 * Throws 400 for a malformed message or one that doesn't match the request, 401 for a timestamp outside
 * ±SIGNATURE_MAX_SKEW_SECS or a bad signature.
 */
export function verifySignedMessage(
  req: SignedRequest,
  expected: { kind: "comment" | "profile"; subject: string; payload: string },
  nowSecs: number,
): number {
  const lines = req.message.split("\n");
  if (lines.length !== 4 || lines[0] !== `holdfast:${expected.kind}:v1`) {
    throw new ValidationError(`message must be "holdfast:${expected.kind}:v1\\n<${expected.kind === "comment" ? "launch" : "wallet"}>\\n<sha256 hex>\\n<unix seconds>"`);
  }
  const [, subject, hash, tsRaw] = lines;
  if (subject !== expected.subject) throw new ValidationError(`message is signed for ${subject}, not ${expected.subject}`);
  const want = Buffer.from(sha256Hex(expected.payload), "hex");
  const got = /^[0-9a-f]{64}$/.test(hash) ? Buffer.from(hash, "hex") : null;
  if (!got || !timingSafeEqual(got, want)) throw new ValidationError("message hash does not match the submitted content");
  if (!/^\d{1,12}$/.test(tsRaw)) throw new ValidationError("message timestamp must be unix seconds");
  const ts = Number(tsRaw);
  if (Math.abs(nowSecs - ts) > SIGNATURE_MAX_SKEW_SECS) {
    throw new HttpError(401, `message timestamp is outside ±${SIGNATURE_MAX_SKEW_SECS}s of server time (${nowSecs})`);
  }
  const sig = base58Decode(req.signature);
  if (!sig || sig.length !== 64) throw new ValidationError("signature must be a base58-encoded 64-byte Ed25519 signature");
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, new PublicKey(req.wallet).toBuffer()]),
    format: "der",
    type: "spki",
  });
  if (!verify(null, Buffer.from(req.message, "utf8"), key, sig)) throw new HttpError(401, "invalid signature");
  return ts;
}

/** Constant-time string comparison (admin token). */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
