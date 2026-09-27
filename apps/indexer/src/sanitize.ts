import { PublicKey } from "@solana/web3.js";

/** Validation shared by the upload endpoint (strict) and metadata ingestion (lenient). */

export class ValidationError extends Error {}

/** Error with an explicit HTTP status (the server's error handler sends `{ error: message }`). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// C0/C1 control characters except tab/newline (kept for descriptions), plus bidi overrides.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const HANDLE = /^@?[A-Za-z0-9_.]{1,64}$/;

/**
 * Trims, strips control characters and enforces a limit. Name/symbol limits are UTF-8 bytes
 * (they mirror the on-chain `String::len` checks); descriptions count characters.
 */
export function cleanText(
  raw: unknown,
  label: string,
  max: number,
  opts: { multiline?: boolean; bytes?: boolean } = {},
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new ValidationError(`${label} must be a string`);
  let s = raw.replace(CONTROL, "");
  s = opts.multiline ? s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/[\t\n]+/g, " ");
  s = s.trim();
  if (s === "") return null;
  const len = opts.bytes ? Buffer.byteLength(s, "utf8") : [...s].length;
  if (len > max) throw new ValidationError(`${label} must be at most ${max} ${opts.bytes ? "bytes" : "characters"}`);
  return s;
}

function httpUrl(s: string): URL | null {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Social link: an http(s) URL or a bare/@ handle, at most 200 characters. */
export function cleanSocial(raw: unknown, label: string): string | null {
  const s = cleanText(raw, label, 200);
  if (s === null) return null;
  if (HANDLE.test(s)) return s;
  const u = httpUrl(s);
  if (!u) throw new ValidationError(`${label} must be an http(s) URL or a handle`);
  return u.toString();
}

/** Image reference from third-party metadata: http(s), or ipfs:// rewritten to a public gateway. */
export function cleanImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0 || s.length > 500) return null;
  if (s.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${s.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  return httpUrl(s)?.toString() ?? null;
}

/** Canonical base58 pubkey or null. */
export function parsePubkey(s: string): PublicKey | null {
  try {
    const pk = new PublicKey(s);
    return pk.toBase58() === s ? pk : null;
  } catch {
    return null;
  }
}

export const MAX_WHITELIST = 50_000;

/** Deduplicated list of canonical base58 pubkeys; throws on any invalid entry. */
export function parsePubkeyList(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw)) throw new ValidationError(`${label} must be a JSON array of base58 public keys`);
  if (raw.length === 0) throw new ValidationError(`${label} must not be empty`);
  if (raw.length > MAX_WHITELIST) throw new ValidationError(`${label} may contain at most ${MAX_WHITELIST} entries`);
  const out = new Set<string>();
  for (const [i, v] of raw.entries()) {
    const pk = typeof v === "string" ? parsePubkey(v.trim()) : null;
    if (!pk) throw new ValidationError(`${label}[${i}] is not a valid public key`);
    out.add(pk.toBase58());
  }
  return [...out];
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
