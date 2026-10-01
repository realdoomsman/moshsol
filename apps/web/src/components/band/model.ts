/**
 * The band, as data: pure helpers shared by the token chart overlay, the vault panel, the agents
 * page and the docs. Everything is derived from indexer rows and the launch's frozen `terms` with
 * the SDK's curve maths (`spotPrice`, `bps`) — no typed limits.
 */
import { bps, compact, fmtSol, lamportsToSol, spotPrice, tokensToUi, type CurveState, type LaunchJson } from "@holdfast/sdk";
import type { AgentDecision, LaunchSummary, TradeRow } from "@/lib/types";

/** "2%" / "0.5%" from basis points. */
export const pctFromBps = (b: number) => `${+(b / 100).toFixed(2)}%`;

/** "−2.4%" / "+1.1%" with a typographic minus (same shape as the vault agent's reasons). */
export function fmtDeviation(fraction: number): string {
  const abs = Math.abs(fraction * 100).toFixed(1);
  return fraction < 0 && abs !== "0.0" ? `−${abs}%` : `+${abs}%`;
}

// ---------------------------------------------------------------------------------------------
// Agent trade markers

export interface AgentMarker {
  signature: string;
  time: number;
  /** Price right after the agent's trade. */
  price: number;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  /** Spot vs EMA when the agent traded (pre-trade price, as the program checked it). */
  deviation: number | null;
}

/**
 * Spot price just before a vault-agent trade, rebuilt from the post-trade reserves in the row (agent
 * trades pay no fee, so the full SOL amount moved the curve).
 */
export function preTradePrice(t: TradeRow, virtualSol: string | bigint): number {
  const x = BigInt(virtualSol) + BigInt(t.realSol);
  const y = BigInt(t.tokenReserve);
  const sol = BigInt(t.solAmount);
  const tokens = BigInt(t.tokenAmount);
  const before: CurveState = t.isBuy
    ? { virtualSol: 0n, realSol: x - sol, tokenReserve: y + tokens }
    : { virtualSol: 0n, realSol: x + sol, tokenReserve: y - tokens };
  return before.realSol > 0n && before.tokenReserve > 0n ? spotPrice(before) : t.priceSol;
}

/** Vault-agent trades as chart markers (oldest first). */
export function agentMarkers(trades: TradeRow[], virtualSol: string | bigint): AgentMarker[] {
  return trades
    .filter((t) => t.isAgent)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t) => {
      const before = preTradePrice(t, virtualSol);
      return {
        signature: t.signature,
        time: t.timestamp,
        price: t.priceSol,
        side: t.isBuy ? "buy" : "sell",
        sol: lamportsToSol(t.solAmount),
        tokens: tokensToUi(t.tokenAmount),
        deviation: t.emaSol > 0 ? before / t.emaSol - 1 : null,
      };
    });
}

/** "Agent bought 0.12 SOL · −2.4% vs EMA" / "Agent sold 1.2M $MOSH · +3.1% vs EMA". */
export function describeAgentTrade(m: AgentMarker, symbol: string): string {
  const what = m.side === "buy" ? `Agent bought ${fmtSol(m.sol, 4)} SOL` : `Agent sold ${compact(m.tokens)} $${symbol}`;
  return m.deviation === null ? what : `${what} · ${fmtDeviation(m.deviation)} vs EMA`;
}

// ---------------------------------------------------------------------------------------------
// Featured launch

/** Live launch with the most trades — the landing's featured launch. */
export function mostTraded(live: LaunchSummary[]): LaunchSummary | null {
  let best: LaunchSummary | null = null;
  for (const l of live) {
    if (l.status !== "live") continue;
    if (!best || l.tradeCount > best.tradeCount) best = l;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Vault agent decisions (from the agent's /status)

/**
 * A raw agent action as user copy: hold → "Holding", skip → "Waiting" (cooldown, back-off or pause;
 * the reason says which), buy → "Buying the dip" / "Bought", sell → "Selling the rally" / "Sold".
 */
export function decisionLabel(d: Pick<AgentDecision, "action" | "signature">): string {
  switch (d.action) {
    case "buy":
      return d.signature ? "Bought" : "Buying the dip";
    case "sell":
      return d.signature ? "Sold" : "Selling the rally";
    case "skip":
      return "Waiting";
    default:
      return "Holding";
  }
}

/**
 * The clause of an agent reason worth a headline: "price inside band (+0.4% vs EMA)" → "price
 * inside band"; "cooldown after last trade, 12s left; wants dip …" → "cooldown after last trade, 12s left".
 */
export function decisionClause(reason: string): string {
  return reason.split(";")[0].split(" (")[0].split(":")[0].trim();
}

/** One-line headline for an agent decision: "Holding: price inside band", "Waiting: cooldown …", "Bought". */
export function decisionHeadline(d: Pick<AgentDecision, "action" | "reason" | "signature" | "error">): string {
  if (d.error && (d.action === "buy" || d.action === "sell")) return `${d.action === "buy" ? "Buy" : "Sell"} failed`;
  const label = decisionLabel(d);
  if (d.action === "buy" || d.action === "sell") return label;
  const clause = decisionClause(d.reason);
  return clause ? `${label}: ${clause}` : label;
}

/** Spot vs EMA of a decision, as a fraction. */
export const decisionDeviation = (d: Pick<AgentDecision, "priceSol" | "emaSol">) =>
  d.emaSol > 0 ? d.priceSol / d.emaSol - 1 : 0;

// ---------------------------------------------------------------------------------------------
// Window budgets

/** Window budgets as the program will see them now (`roll_window`). */
export function windowBudgets(l: LaunchJson, nowSec: number): { buySol: bigint; sellTokens: bigint; resetsAt: number } {
  const t = l.terms;
  if (nowSec >= l.windowStart + t.agentWindowSecs) {
    return {
      buySol: bps(BigInt(l.vaultSol), t.agentBuyBpsPerWindow),
      sellTokens: bps(BigInt(l.vaultTokens), t.agentSellBpsPerWindow),
      resetsAt: nowSec + t.agentWindowSecs,
    };
  }
  const buyCap = BigInt(l.windowBuyCap);
  const spent = BigInt(l.windowSolSpent);
  const sellCap = BigInt(l.windowSellCap);
  const sold = BigInt(l.windowTokensSold);
  return {
    buySol: buyCap > spent ? buyCap - spent : 0n,
    sellTokens: sellCap > sold ? sellCap - sold : 0n,
    resetsAt: l.windowStart + t.agentWindowSecs,
  };
}
