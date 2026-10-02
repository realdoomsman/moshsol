import { LIMITS, solToLamports } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, type TokenImage } from "./image";

/** A vault needs SOL from launch to buy back the first dips (launches with 0% start with only rounding dust). */
export const MIN_RESERVE_PCT = 20;

export const MAX_DESCRIPTION = 500;
/** `POST /api/upload` accepts at most this many whitelist entries. */
export const MAX_WHITELIST = 50_000;

export const DURATION_PRESETS = [
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
  image: TokenImage | null;
  twitter: string;
  telegram: string;
  raiseMin: string;
  raiseMax: string;
  perWallet: string;
  duration: DurationChoice;
  customValue: string;
  customUnit: DurationUnit;
  /** "none": the bundle buys as much as the raise can, up to the platform max; "custom": at most `bundlePct` of supply. */
  bundleCap: "none" | "custom";
  /** The creator's cap in % of supply, used when `bundleCap` is "custom". */
  bundlePct: number;
  reservePct: number;
  /** Who can deposit: anyone, a merkle whitelist, or only the creator ("fund it yourself"). */
  access: "open" | "whitelist" | "self";
  whitelistText: string;
}

export const INITIAL_DRAFT: CreateDraft = {
  name: "",
  symbol: "",
  description: "",
  image: null,
  twitter: "",
  telegram: "",
  raiseMin: "5",
  raiseMax: "20",
  perWallet: "",
  duration: "1h",
  customValue: "30",
  customUnit: "m",
  bundleCap: "none",
  bundlePct: 15,
  reservePct: 30,
  access: "open",
  whitelistText: "",
};

export type DraftField =
  | "name"
  | "symbol"
  | "description"
  | "image"
  | "twitter"
  | "telegram"
  | "raiseMin"
  | "raiseMax"
  | "perWallet"
  | "duration"
  | "bundlePct"
  | "reservePct"
  | "whitelist";

/** The wizard's steps and the fields each one validates before Continue. */
export const STEPS = [
  { id: "token", label: "Token", fields: ["image", "name", "symbol", "description", "twitter", "telegram"] },
  { id: "raise", label: "Raise", fields: ["raiseMin", "raiseMax", "perWallet", "duration"] },
  { id: "vault", label: "Vault & access", fields: ["bundlePct", "reservePct", "whitelist"] },
  { id: "review", label: "Review", fields: [] },
] as const satisfies readonly { id: string; label: string; fields: readonly DraftField[] }[];

export type StepIndex = 0 | 1 | 2 | 3;

export function stepOf(field: DraftField): StepIndex {
  return STEPS.findIndex((s) => (s.fields as readonly DraftField[]).includes(field)) as StepIndex;
}

export interface ParsedDraft {
  name: string;
  symbol: string;
  description: string;
  image: File;
  twitter?: string;
  telegram?: string;
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
  /** Valid, de-duplicated whitelist members in input order. */
  whitelist: PublicKey[];
  /** Valid lines that repeat an earlier address. */
  whitelistDuplicates: number;
}

export const utf8Len = (s: string) => new TextEncoder().encode(s).length;

function parseSol(v: string): bigint | null {
  if (!v.trim()) return null;
  try {
    return solToLamports(v);
  } catch {
    return null;
  }
}

/** SOL text → lamports for live previews (null when empty, zero or malformed). */
export function previewLamports(v: string): bigint | null {
  const l = parseSol(v);
  return l !== null && l > 0n ? l : null;
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
  if (d.duration !== "custom") return DURATION_PRESETS.find((p) => p.id === d.duration)?.secs ?? null;
  const n = Number(d.customValue);
  if (!d.customValue.trim() || !isFinite(n) || n <= 0) return null;
  return Math.round(n * UNIT_SECS[d.customUnit]);
}

/** "1 hour", "3 days", "30 min". */
export function fmtDuration(secs: number): string {
  if (secs >= 86_400) return `${+(secs / 86_400).toFixed(1)} day${secs === 86_400 ? "" : "s"}`;
  if (secs >= 3_600) return `${+(secs / 3_600).toFixed(1)} hour${secs === 3_600 ? "" : "s"}`;
  return `${Math.round(secs / 60)} min`;
}

/** Base58 public keys anywhere in pasted text or an uploaded CSV (header rows and other columns are ignored). */
export function extractAddresses(text: string): string[] {
  return text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? [];
}

export type CreatePrefill = Partial<Pick<CreateDraft, "raiseMin" | "raiseMax" | "bundleCap" | "bundlePct" | "reservePct">>;

/**
 * The bundle cap a draft submits, in bps of supply: the platform max without a cap, otherwise the
 * creator's cap clamped to that max (a draft saved under an earlier, higher max stays submittable).
 */
export function bundleBpsOf(d: Pick<CreateDraft, "bundleCap" | "bundlePct">, maxBundleSupplyBps: number): number {
  return d.bundleCap === "none" ? maxBundleSupplyBps : Math.min(Math.round(d.bundlePct * 100), maxBundleSupplyBps);
}

/**
 * `/create?min=0.5&max=5&bundle=10&reserve=30` (landing "For creators" preview links): raise min/max
 * in SOL, a custom bundle cap in % of supply (omitted = no cap), vault reserve in % of the raise.
 * Malformed values are ignored.
 */
export function parsePrefill(q: Record<string, string | string[] | undefined>): CreatePrefill {
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string).trim() : "");
  const out: CreatePrefill = {};
  const sol = /^\d*\.?\d{1,9}$/;
  if (sol.test(one("min")) && Number(one("min")) > 0) out.raiseMin = one("min");
  if (sol.test(one("max")) && Number(one("max")) > 0) out.raiseMax = one("max");
  const bundle = Number(one("bundle"));
  if (one("bundle") && Number.isFinite(bundle)) {
    out.bundleCap = "custom";
    out.bundlePct = Math.max(LIMITS.minBundleSupplyBps / 100, Math.round(bundle * 2) / 2);
  }
  const reserve = Number(one("reserve"));
  if (one("reserve") && Number.isFinite(reserve)) {
    out.reservePct = Math.min(LIMITS.maxReserveBps / 100, Math.max(MIN_RESERVE_PCT, Math.round(reserve)));
  }
  return out;
}

export interface DraftLimits {
  /** Connected wallet; a self-funded raise whitelists exactly this key. */
  creator?: PublicKey | null;
  minRaiseLamports: bigint;
  maxBundleSupplyBps: number;
  /** Platform beta cap on the max raise; 0n (or omitted) = no cap. */
  maxRaiseLamports?: bigint;
  /** Platform beta cap per wallet, applied on-chain on top of the creator's cap; 0n (or omitted) = no cap. */
  maxWalletDepositLamports?: bigint;
}

export function validateDraft(d: CreateDraft, p: DraftLimits): Validation {
  const errors: Validation["errors"] = {};
  const name = d.name.trim();
  const symbol = d.symbol.trim();

  if (!name) errors.name = "Name is required";
  else if (utf8Len(name) > LIMITS.maxNameLen) errors.name = `At most ${LIMITS.maxNameLen} bytes`;

  if (!symbol) errors.symbol = "Ticker is required";
  else if (utf8Len(symbol) > LIMITS.maxSymbolLen) errors.symbol = `At most ${LIMITS.maxSymbolLen} characters`;
  else if (!/^[A-Z0-9]+$/.test(symbol)) errors.symbol = "Letters and numbers only";

  if (d.description.length > MAX_DESCRIPTION) errors.description = `At most ${MAX_DESCRIPTION} characters`;

  if (!d.image) errors.image = "Add a token image";
  else if (!IMAGE_TYPES.includes(d.image.file.type)) errors.image = "Use PNG, JPG, GIF, WebP or SVG";
  else if (d.image.file.size > MAX_IMAGE_BYTES) errors.image = "Image must be 4 MB or smaller";

  const twitter = normalizeHandleUrl(d.twitter, "x.com", /(^|\.)(x|twitter)\.com$/i, /^[A-Za-z0-9_]{1,15}$/);
  if (twitter === null) errors.twitter = "Enter an X handle or x.com link";
  const telegram = normalizeHandleUrl(d.telegram, "t.me", /(^|\.)(t\.me|telegram\.me)$/i, /^[A-Za-z0-9_]{4,32}$/);
  if (telegram === null) errors.telegram = "Enter a Telegram handle or t.me link";

  const raiseMin = parseSol(d.raiseMin);
  const raiseMax = parseSol(d.raiseMax);
  const minSol = Number(p.minRaiseLamports) / 1e9;
  const betaRaise = p.maxRaiseLamports ?? 0n;
  const betaWallet = p.maxWalletDepositLamports ?? 0n;
  if (raiseMin === null) errors.raiseMin = "Enter a minimum";
  else if (raiseMin < p.minRaiseLamports) errors.raiseMin = `At least ${minSol} SOL (platform minimum)`;
  else if (betaRaise > 0n && raiseMin > betaRaise) errors.raiseMin = `At most ${Number(betaRaise) / 1e9} SOL (beta cap)`;
  if (raiseMax === null) errors.raiseMax = "Enter a maximum";
  else if (raiseMin !== null && raiseMax < raiseMin) errors.raiseMax = "Must be at least the minimum";
  else if (raiseMax > LIMITS.maxRaiseLamports) errors.raiseMax = "At most 100,000 SOL";
  else if (betaRaise > 0n && raiseMax > betaRaise) errors.raiseMax = `At most ${Number(betaRaise) / 1e9} SOL (beta cap)`;

  let maxPerWallet = 0n;
  if (d.access !== "self" && d.perWallet.trim()) {
    const v = parseSol(d.perWallet);
    if (v === null || v === 0n) errors.perWallet = "Enter an amount or leave empty for no cap";
    else if (betaWallet > 0n && v > betaWallet) errors.perWallet = `At most ${Number(betaWallet) / 1e9} SOL (beta cap)`;
    else maxPerWallet = v;
  }

  const durationSecs = durationSecsOf(d);
  if (durationSecs === null) errors.duration = "Enter a duration";
  else if (durationSecs < LIMITS.minRaiseDurationSecs) errors.duration = "At least 1 minute";
  else if (durationSecs > LIMITS.maxRaiseDurationSecs) errors.duration = "At most 14 days";

  const bundleSupplyBps = bundleBpsOf(d, p.maxBundleSupplyBps);
  if (bundleSupplyBps < LIMITS.minBundleSupplyBps) {
    errors.bundlePct = `Between ${LIMITS.minBundleSupplyBps / 100}% and ${p.maxBundleSupplyBps / 100}%`;
  }
  const reserveBps = Math.round(d.reservePct * 100);
  if (reserveBps < MIN_RESERVE_PCT * 100) errors.reservePct = `At least ${MIN_RESERVE_PCT}%: the vault agent buys dips with this SOL`;
  else if (reserveBps > LIMITS.maxReserveBps) errors.reservePct = `At most ${LIMITS.maxReserveBps / 100}%`;

  const whitelist: PublicKey[] = [];
  const badWhitelistLines: number[] = [];
  let whitelistDuplicates = 0;
  if (d.access === "self") {
    if (p.creator) whitelist.push(p.creator);
    else errors.whitelist = "Connect the wallet that will fund the raise";
  } else if (d.access === "whitelist") {
    const seen = new Set<string>();
    d.whitelistText.split(/\r?\n/).forEach((line, i) => {
      const v = line.trim().replace(/,$/, "");
      if (!v) return;
      try {
        const key = new PublicKey(v);
        const id = key.toBase58();
        if (id !== v) throw new Error("non-canonical");
        if (seen.has(id)) whitelistDuplicates++;
        else {
          seen.add(id);
          whitelist.push(key);
        }
      } catch {
        badWhitelistLines.push(i + 1);
      }
    });
    if (badWhitelistLines.length) {
      errors.whitelist = `Not a wallet address on line ${badWhitelistLines.slice(0, 5).join(", ")}${badWhitelistLines.length > 5 ? "…" : ""}`;
    } else if (whitelist.length === 0) {
      errors.whitelist = "Add at least one wallet, or make the raise open";
    } else if (whitelist.length > MAX_WHITELIST) {
      errors.whitelist = `At most ${MAX_WHITELIST.toLocaleString("en-US")} wallets`;
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    errors,
    badWhitelistLines,
    whitelist,
    whitelistDuplicates,
    parsed: ok
      ? {
          name,
          symbol,
          description: d.description.trim(),
          image: d.image!.file,
          twitter: twitter || undefined,
          telegram: telegram || undefined,
          raiseMin: raiseMin!,
          raiseMax: raiseMax!,
          maxPerWallet,
          durationSecs: durationSecs!,
          bundleSupplyBps,
          reserveBps,
          whitelist: d.access === "open" ? null : whitelist,
        }
      : null,
  };
}
