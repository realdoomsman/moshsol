import { compact, lamportsToSol, tokensToUi } from "@holdfast/sdk";
import type { LaunchSummary } from "./types";

/** SOL amount with magnitude-aware precision ("1.25K", "32.4", "0.0521"). */
export function fmtSolValue(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 10_000) return compact(v, 1);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.001) return v.toFixed(4).replace(/\.?0+$/, "");
  return v.toPrecision(2);
}

/** `fmtSolValue` for table columns: sub-1 amounts keep all four decimals so figures line up ("0.1140"). */
export function fmtSolColumn(v: number): string {
  const abs = Math.abs(v);
  return abs >= 0.001 && abs < 1 ? v.toFixed(4) : fmtSolValue(v);
}

/** USD valuation, compact like pump.fun ("$5.2K", "$1.3M", "$312", "$0.42"). */
export function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000) return `${sign}$${compact(abs, 1).replace(/\.0(?=[KMB]$)/, "")}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(0)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toPrecision(2)}`;
}

type MarketCap = Pick<LaunchSummary, "marketCapSol" | "marketCapUsd">;

const fmtSolMcap = (v: number) => `${fmtSolValue(v)} SOL`;

/**
 * Market cap as `NumberTicker` props: USD while the indexer has a SOL price, SOL otherwise
 * (`marketCapUsd` is null until its first price fetch, and absent from an indexer that predates it).
 * Sorting stays on `marketCapSol`.
 */
export function mcapTicker(l: MarketCap): { value: number; format: (v: number) => string } {
  return l.marketCapUsd == null ? { value: l.marketCapSol, format: fmtSolMcap } : { value: l.marketCapUsd, format: fmtUsd };
}

/** `mcapTicker` as text: "$4.2K", or "27.96 SOL" without a price. */
export function fmtMcap(l: MarketCap): string {
  const t = mcapTicker(l);
  return t.format(t.value);
}

/** The SOL/USD rate the indexer priced `l` with, for valuing other SOL figures of the same launch; null without a price. */
export function solUsdOf(l: Pick<LaunchSummary, "priceSol" | "priceUsd">): number | null {
  return l.priceUsd != null && l.priceSol > 0 ? l.priceUsd / l.priceSol : null;
}

/** Lamports (decimal string or bigint) → formatted SOL. */
export function fmtLamports(v: string | bigint): string {
  return fmtSolValue(lamportsToSol(v));
}

/** Token base units → compact whole-token amount. */
export function fmtTokens(v: string | bigint | number): string {
  const ui = tokensToUi(typeof v === "number" ? BigInt(Math.floor(v)) : v);
  if (ui === 0) return "0";
  return ui >= 1_000 ? compact(ui, 2) : ui.toFixed(ui >= 1 ? 2 : 4);
}

export function fmtChange(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
}

/** Share of `part` in `whole` as a 0–100 number (bigint-safe). */
export function pctOf(part: string | bigint, whole: string | bigint): number {
  const w = BigInt(whole);
  if (w === 0n) return 0;
  return Number((BigInt(part) * 1_000_000n) / w) / 10_000;
}
