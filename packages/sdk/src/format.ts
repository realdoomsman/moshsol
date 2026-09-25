const LAMPORTS = 1_000_000_000;
const TOKEN = 1_000_000;

export function lamportsToSol(v: bigint | string | number): number {
  return Number(BigInt(v.toString())) / LAMPORTS;
}

export function solToLamports(sol: number | string): bigint {
  const s = typeof sol === "number" ? sol.toFixed(9) : sol.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error(`invalid SOL amount: ${sol}`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole || "0") * 1_000_000_000n + BigInt((frac + "000000000").slice(0, 9));
}

export function tokensToUi(v: bigint | string | number): number {
  return Number(BigInt(v.toString())) / TOKEN;
}

export function uiToTokens(ui: number | string): bigint {
  const s = typeof ui === "number" ? ui.toFixed(6) : ui.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error(`invalid token amount: ${ui}`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

/** 1234567 -> "1.23M" */
export function compact(n: number, digits = 2): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
  return n.toFixed(abs >= 100 ? 0 : abs >= 1 ? digits : Math.min(digits + 2, 6));
}

export function fmtSol(v: number, digits = 3): string {
  if (v === 0) return "0";
  if (Math.abs(v) < 0.001) return v.toFixed(6);
  if (Math.abs(v) >= 1000) return compact(v);
  return v.toFixed(digits);
}

/** Tiny prices: 0.0000312 -> "0.0₄312" style subscript notation. */
export function fmtPrice(v: number): string {
  if (!isFinite(v) || v <= 0) return "0";
  if (v >= 0.01) return v.toFixed(4);
  const exp = Math.floor(Math.log10(v));
  const zeros = -exp - 1;
  const digits = Math.round(v * 10 ** (-exp + 2)).toString().slice(0, 3);
  if (zeros < 4) return v.toFixed(zeros + 3);
  const sub = String(zeros)
    .split("")
    .map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)])
    .join("");
  return `0.0${sub}${digits}`;
}

export function shortAddr(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

export function timeAgo(tsSec: number, nowSec = Date.now() / 1000): string {
  const d = Math.max(0, Math.floor(nowSec - tsSec));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function countdown(targetSec: number, nowSec = Date.now() / 1000): string {
  let d = Math.max(0, Math.floor(targetSec - nowSec));
  const days = Math.floor(d / 86400);
  d %= 86400;
  const h = Math.floor(d / 3600);
  d %= 3600;
  const m = Math.floor(d / 60);
  const s = d % 60;
  if (days > 0) return `${days}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
