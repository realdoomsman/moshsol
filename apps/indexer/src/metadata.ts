import { lookup } from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { MetaUpdate } from "./db";
import { cleanImageUrl, cleanSocial, cleanText, isRecord, parsePubkeyList, ValidationError } from "./sanitize";

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

/** URI that is not fetchable at all (wrong scheme, private host); not worth retrying. */
export class UnfetchableUriError extends Error {}

const PRIVATE = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  PRIVATE.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(addr, prefix, "ipv6");
}

function isPrivateIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return PRIVATE.check(mapped[1]!, "ipv4");
  return PRIVATE.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
}

/** Rejects hosts that resolve to loopback/private/link-local ranges (SSRF guard). */
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.length === 0 || addrs.some(isPrivateIp)) {
    throw new UnfetchableUriError(`metadata host ${url.hostname} is not publicly routable`);
  }
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error(`metadata larger than ${MAX_BYTES} bytes`);
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`metadata larger than ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchRemoteJson(uri: string): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new UnfetchableUriError(`invalid metadata URI`);
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new UnfetchableUriError(`unsupported metadata URI scheme ${url.protocol}`);
    }
    await assertPublicHost(url);
    const res = await fetch(url, { signal, redirect: "manual", headers: { accept: "application/json" } });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error("too many metadata redirects");
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`metadata fetch returned HTTP ${res.status}`);
    }
    return JSON.parse(await readCapped(res));
  }
}

/** Metaplex-style JSON → sanitized display fields. Invalid optional fields are dropped, not fatal. */
export function parseMetadata(json: unknown): MetaUpdate {
  if (!isRecord(json)) throw new Error("metadata is not a JSON object");
  const lenient = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ValidationError) return null;
      throw err;
    }
  };
  const ext = isRecord(json.extensions) ? json.extensions : {};
  const social = (key: "twitter" | "telegram" | "website") => lenient(() => cleanSocial(ext[key] ?? json[key], key));
  return {
    status: "ok",
    name: lenient(() => cleanText(json.name, "name", 32, { bytes: true })),
    symbol: lenient(() => cleanText(json.symbol, "symbol", 10, { bytes: true })),
    description: lenient(() => cleanText(json.description, "description", 1000, { multiline: true })),
    image: cleanImageUrl(json.image),
    twitter: social("twitter"),
    telegram: social("telegram"),
    website: social("website"),
    whitelist: json.whitelist === undefined ? null : lenient(() => parsePubkeyList(json.whitelist, "whitelist")),
  };
}

/**
 * Loads a launch's metadata JSON. URIs under our own `PUBLIC_URL/files/meta/` are read straight
 * from disk; anything else must be a public http(s) URL (5s timeout, 256 KB cap).
 */
export async function loadMetadata(uri: string, publicUrl: string, filesDir: string): Promise<MetaUpdate> {
  const ownPrefix = `${publicUrl}/files/meta/`;
  if (uri.startsWith(ownPrefix)) {
    const id = uri.slice(ownPrefix.length);
    if (!/^[A-Za-z0-9_-]+\.json$/.test(id)) throw new UnfetchableUriError("invalid local metadata id");
    const raw = await fs.readFile(path.join(filesDir, "meta", id), "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new UnfetchableUriError(`local metadata ${id} not found`);
      throw err;
    });
    return parseMetadata(JSON.parse(raw));
  }
  return parseMetadata(await fetchRemoteJson(uri));
}
