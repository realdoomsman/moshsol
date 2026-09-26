import { LIMITS, solToLamports } from "@moshsol/sdk";
import { PublicKey } from "@solana/web3.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./image-drop";

/** Program hard cap on `raise_max` (programs/moshsol/src/constants.rs `MAX_RAISE_LAMPORTS`; not exported by the SDK). */
export const MAX_RAISE_LAMPORTS = 100_000n * 1_000_000_000n;
export const MAX_DESCRIPTION = 500;

export const DURATION_PRESETS = [
  { id: "10m", label: "10m", secs: 600 },
  { id: "1h", label: "1h", secs: 3_600 },
  { id: "6h", label: "6h", secs: 21_600 },
  { id: "24h", label: "24h", secs: 86_400 },
  { id: "3d", label: "3d", secs: 259_200 },
] as const;

export type DurationChoice = (typeof DURATION_PRESETS)[number]["id"] | "custom";
export type DurationUnit = "m" | "h" | "d";
const UNIT_SECS: Record<DurationUnit, number> = { m: 60, h: 3_600, d: 86_400 };

export interface CreateDraft {
  name: string;
  symbol: string;
  description: string;
  image: File | null;
  twitter: string;
  telegram: string;
  website: string;
  raiseMin: string;
  raiseMax: string;
  perWallet: string;
  duration: DurationChoice;
  customValue: string;
  customUnit: DurationUnit;
  bundlePct: number;
  reservePct: number;
  whitelistOn: boolean;
  whitelistText: string;
}

export type DraftField =
  | "name"
  | "symbol"
  | "description"
  | "image"
  | "twitter"
  | "telegram"
  | "website"
  | "raiseMin"
  | "raiseMax"
  | "perWallet"
  | "duration"
  | "bundlePct"
  | "reservePct"
  | "whitelist";

export interface ParsedDraft {
  name: string;
  symbol: string;
  description: string;
  image: File;
  twitter?: string;
  telegram?: string;
  website?: string;
  raiseMin: bigint;
  raiseMax: bigint;
  maxPerWallet: bigint;
  durationSecs: number;
  bundleSupplyBps: number;
  reserveBps: number;
  whitelist: PublicKey[] | null;
}

export interface Validation {
  errors: Partial<Record<DraftField, string>>;
  parsed: ParsedDraft | null;
  /** 1-based line numbers in the whitelist textarea that are not valid addresses. */
  badWhitelistLines: number[];
  whitelist: PublicKey[];
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length;

function parseSol(v: string): bigint | null {
  if (!v.trim()) return null;
  try {
    return solToLamports(v);
  } catch {
    return null;
  }
}

function normalizeHandleUrl(raw: string, host: string, hostPattern: RegExp, handle: RegExp): string | null {
  const v = raw.trim();
  if (!v) return "";
  const bare = v.replace(/^@/, "");
  if (handle.test(bare)) return `https://${host}/${bare}`;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!hostPattern.test(url.hostname) || url.pathname.length < 2) return null;
    return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function durationSecsOf(d: Pick<CreateDraft, "duration" | "customValue" | "customUnit">): number | null {
  if (d.duration !== "custom") return DURATION_PRESETS.find((p) => p.id === d.duration)!.secs;
  const n = Number(d.customValue);
  if (!d.customValue.trim() || !isFinite(n) || n <= 0) return null;
  return Math.round(n * UNIT_SECS[d.customUnit]);
}

export function validateDraft(d: CreateDraft, p: { minRaiseLamports: bigint; maxBundleSupplyBps: number }): Validation {
  const errors: Validation["errors"] = {};
  const name = d.name.trim();
  const symbol = d.symbol.trim();

  if (!name) errors.name = "Name is required";
  else if (utf8Len(name) > LIMITS.maxNameLen) errors.name = `Max ${LIMITS.maxNameLen} bytes`;

  if (!symbol) errors.symbol = "Symbol is required";
  else if (utf8Len(symbol) > LIMITS.maxSymbolLen) errors.symbol = `Max ${LIMITS.maxSymbolLen} characters`;
  else if (!/^[A-Z0-9]+$/.test(symbol)) errors.symbol = "Letters and numbers only";

  if (d.description.length > MAX_DESCRIPTION) errors.description = `Max ${MAX_DESCRIPTION} characters`;

  if (!d.image) errors.image = "Add a token image";
  else if (!IMAGE_TYPES.includes(d.image.type)) errors.image = "Use PNG, JPG, GIF, WEBP or SVG";
  else if (d.image.size > MAX_IMAGE_BYTES) errors.image = "Image must be 4 MB or smaller";

  const twitter = normalizeHandleUrl(d.twitter, "x.com", /(^|\.)(x|twitter)\.com$/i, /^[A-Za-z0-9_]{1,15}$/);
  if (twitter === null) errors.twitter = "Enter an X handle or x.com link";
  const telegram = normalizeHandleUrl(d.telegram, "t.me", /(^|\.)(t\.me|telegram\.me)$/i, /^[A-Za-z0-9_]{4,32}$/);
  if (telegram === null) errors.telegram = "Enter a Telegram handle or t.me link";
  let website = "";
  if (d.website.trim()) {
    try {
      const url = new URL(/^https?:\/\//i.test(d.website.trim()) ? d.website.trim() : `https://${d.website.trim()}`);
      if (!url.hostname.includes(".")) throw new Error("host");
      website = url.toString();
    } catch {
      errors.website = "Enter a valid URL";
    }
  }

  const raiseMin = parseSol(d.raiseMin);
  const raiseMax = parseSol(d.raiseMax);
  const minSol = Number(p.minRaiseLamports) / 1e9;
  if (raiseMin === null) errors.raiseMin = "Enter a minimum";
  else if (raiseMin < p.minRaiseLamports) errors.raiseMin = `At least ${minSol} SOL`;
  if (raiseMax === null) errors.raiseMax = "Enter a maximum";
  else if (raiseMin !== null && raiseMax < raiseMin) errors.raiseMax = "Must be ≥ the minimum";
  else if (raiseMax > MAX_RAISE_LAMPORTS) errors.raiseMax = "At most 100,000 SOL";

  let maxPerWallet = 0n;
  if (d.perWallet.trim()) {
    const v = parseSol(d.perWallet);
    if (v === null) errors.perWallet = "Enter an amount or leave empty";
    else maxPerWallet = v;
  }

  const durationSecs = durationSecsOf(d);
  if (durationSecs === null) errors.duration = "Enter a duration";
  else if (durationSecs < LIMITS.minRaiseDurationSecs) errors.duration = "At least 1 minute";
  else if (durationSecs > LIMITS.maxRaiseDurationSecs) errors.duration = "At most 14 days";

  const bundleSupplyBps = Math.round(d.bundlePct * 100);
  if (bundleSupplyBps < LIMITS.minBundleSupplyBps || bundleSupplyBps > p.maxBundleSupplyBps) {
    errors.bundlePct = `Between ${LIMITS.minBundleSupplyBps / 100}% and ${p.maxBundleSupplyBps / 100}%`;
  }
  const reserveBps = Math.round(d.reservePct * 100);
  if (reserveBps < 0 || reserveBps > LIMITS.maxReserveBps) errors.reservePct = `At most ${LIMITS.maxReserveBps / 100}%`;

  const whitelist: PublicKey[] = [];
  const badWhitelistLines: number[] = [];
  if (d.whitelistOn) {
    d.whitelistText.split(/\r?\n/).forEach((line, i) => {
      const v = line.trim().replace(/,$/, "");
      if (!v) return;
      try {
        whitelist.push(new PublicKey(v));
      } catch {
        badWhitelistLines.push(i + 1);
      }
    });
    if (badWhitelistLines.length) {
      errors.whitelist = `Invalid address on line ${badWhitelistLines.slice(0, 5).join(", ")}${badWhitelistLines.length > 5 ? "…" : ""}`;
    } else if (whitelist.length === 0) {
      errors.whitelist = "Add at least one wallet or turn the whitelist off";
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    errors,
    badWhitelistLines,
    whitelist,
    parsed: ok
      ? {
          name,
          symbol,
          description: d.description.trim(),
          image: d.image!,
          twitter: twitter || undefined,
          telegram: telegram || undefined,
          website: website || undefined,
          raiseMin: raiseMin!,
          raiseMax: raiseMax!,
          maxPerWallet,
          durationSecs: durationSecs!,
          bundleSupplyBps,
          reserveBps,
          whitelist: d.whitelistOn ? whitelist : null,
        }
      : null,
  };
}
