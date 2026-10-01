import { agentZones, timeAgo } from "@holdfast/sdk";
import { formatCountdown } from "@/components/ui/countdown";
import { AGENT_STALE_SECS } from "@/lib/status";
import type { AgentDecision, AgentLaunchRow, LaunchSummary } from "@/lib/types";
import { decisionLabel, windowBudgets } from "../band/model";

export type HealthTone = "ok" | "warn";

export interface VaultHealth {
  row: AgentLaunchRow;
  launch: LaunchSummary | undefined;
  decision: AgentDecision | undefined;
  tone: HealthTone;
  /** Plain-English status, e.g. "Holding: price inside band (+0.4% vs EMA)". */
  status: string;
  /** Window budgets as the program sees them now (a rolled window counts as unused). */
  buyUsedPct: number;
  sellUsedPct: number;
  buySpent: bigint;
  sellSold: bigint;
  /** This window's caps; a rolled window shows the caps the next agent trade will open with. */
  buyCap: bigint;
  sellCap: bigint;
  resetsInSecs: number | null;
  /** Thresholds for the band meter (spot, EMA, effective buy/sell lines, vault cost). */
  meter: { price: number; ema: number; buyBelow: number; sellAbove: number; avgCost?: number };
}

/**
 * A decision in one plain-English line: "Holding: price inside band (+0.4% vs EMA)", "Waiting:
 * cooldown after last trade, 20s left; …", "Sold 2.44M tokens for ~0.11 SOL …", "Sell failed: …".
 */
export function decisionText(d: AgentDecision): string {
  if (d.error && (d.action === "buy" || d.action === "sell")) return `${d.action === "buy" ? "Buy" : "Sell"} failed: ${d.error}`;
  if (d.action === "hold" || d.action === "skip") return `${decisionLabel(d)}: ${d.reason}`;
  // Trade reasons read "dip −2.4% vs EMA: buy 0.01 SOL …"; a sent trade reads "Bought 0.01 SOL …".
  const detail = d.reason.split(": ").slice(1).join(": ") || d.reason;
  return d.signature ? `${decisionLabel(d)} ${detail.replace(/^(buy|sell) /, "")}` : `${decisionLabel(d)}: ${detail}`;
}

const usedPct = (used: bigint, cap: bigint) => (cap > 0n ? Number((used * 10_000n) / cap) / 100 : 0);

/**
 * One live vault's health for /agents (§4.10): budgets, band position and a plain-English status.
 * `warn` = needs attention: the agent isn't evaluating the vault (offline, stale, never) or its
 * last trade failed, or agents are paused. Everything else is the rules working as designed.
 */
export function vaultHealth(p: {
  row: AgentLaunchRow;
  launch: LaunchSummary | undefined;
  decision: AgentDecision | undefined;
  agent: "up" | "warn" | "down" | "unknown";
  agentsPaused: boolean;
  /** Platform window length; a launch's own frozen terms win when loaded. */
  platformWindowSecs: number;
  now: number;
}): VaultHealth {
  const { row, launch, decision, now } = p;
  const windowSecs = launch?.terms.agentWindowSecs ?? p.platformWindowSecs;
  const rolled = windowSecs > 0 && now >= row.windowStart + windowSecs;
  const buySpent = rolled ? 0n : BigInt(row.windowSolSpent);
  const sellSold = rolled ? 0n : BigInt(row.windowTokensSold);
  // A rolled window reopens on the next agent trade with caps from the vault as it is now (as the token page shows).
  const next = rolled && launch ? windowBudgets(launch, now) : null;
  const buyCap = next ? next.buySol : BigInt(row.windowBuyCap);
  const sellCap = next ? next.sellTokens : BigInt(row.windowSellCap);
  const resetsInSecs = rolled || windowSecs <= 0 ? null : row.windowStart + windowSecs - now;

  const zones = launch ? agentZones(launch, now) : null;
  const meter = zones
    ? { price: launch!.priceSol, ema: zones.ema, buyBelow: zones.buyBelow, sellAbove: zones.sellAbove, avgCost: zones.avgCost }
    : { price: row.priceSol, ema: row.emaSol, buyBelow: row.bandLowSol, sellAbove: row.bandHighSol };

  let tone: HealthTone = "ok";
  let status: string;
  const age = decision ? now - decision.at : null;
  if (p.agentsPaused) {
    tone = "warn";
    status = "Agents paused by the platform admin";
  } else if (p.agent === "down") {
    tone = "warn";
    status = "Agent offline; the vault's limits are still enforced on-chain";
  } else if (!decision) {
    tone = p.agent === "unknown" ? "ok" : "warn";
    status = p.agent === "unknown" ? "Checking the agent…" : "Agent hasn't evaluated this vault yet";
  } else if (age !== null && age > AGENT_STALE_SECS) {
    tone = "warn";
    status = `Agent hasn't evaluated in ${timeAgo(decision.at, now).replace(" ago", "")}`;
  } else {
    tone = decision.error ? "warn" : "ok";
    status = decisionText(decision);
  }
  // A spent budget explains a hold better than the band does.
  if (tone === "ok" && decision?.action === "hold" && resetsInSecs !== null) {
    const inBuyZone = meter.price <= meter.buyBelow;
    const inSellZone = meter.price >= meter.sellAbove;
    if (inBuyZone && buyCap > 0n && buySpent >= buyCap) {
      status = `Buy budget used up; resets in ${formatCountdown(resetsInSecs)}`;
    } else if (inSellZone && sellCap > 0n && sellSold >= sellCap) {
      status = `Sell budget used up; resets in ${formatCountdown(resetsInSecs)}`;
    }
  }

  return {
    row,
    launch,
    decision,
    tone,
    status,
    buyUsedPct: usedPct(buySpent, buyCap),
    sellUsedPct: usedPct(sellSold, sellCap),
    buySpent,
    sellSold,
    buyCap,
    sellCap,
    resetsInSecs,
    meter,
  };
}
