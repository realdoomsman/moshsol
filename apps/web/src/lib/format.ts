import { compact, lamportsToSol, tokensToUi } from "@moshsol/sdk";

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
