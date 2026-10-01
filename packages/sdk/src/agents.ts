/** Quote and agent-rule helpers shared by the web app and the vault agent. */
import { quoteBuy, solInForTokens, type CurveState } from "./math";
import type { LaunchJson } from "./launch";

/** Smallest gross SOL input (fee included) whose buy quote yields at least `tokens`. */
export function solForTokens(c: CurveState, tokens: bigint, tradeFeeBps: number): bigint {
  const net = solInForTokens(c.virtualSol + c.realSol, c.tokenReserve, tokens);
  let gross = (net * 10_000n + BigInt(9_999 - tradeFeeBps)) / BigInt(10_000 - tradeFeeBps);
  while (quoteBuy(c, gross, tradeFeeBps).tokensOut < tokens) gross += 1n;
  return gross;
}

/**
 * EMA as the program will see it on the next trade: `ema += (spot − ema) · dt / (dt + period)`,
 * where dt is the time since the last trade.
 */
export function projectEma(p: {
  emaSol: number;
  priceSol: number;
  lastTradeTs: number;
  nowSec: number;
  periodSecs: number;
}): number {
  if (p.emaSol <= 0) return p.priceSol;
  const dt = Math.max(0, p.nowSec - p.lastTradeTs);
  return p.emaSol + ((p.priceSol - p.emaSol) * dt) / (dt + p.periodSecs);
}

export interface AgentZones {
  /** EMA projected to now (SOL per token). */
  ema: number;
  bandLow: number;
  bandHigh: number;
  /** Vault average cost basis (SOL per token). */
  avgCost: number;
  /** Buy-back ceiling from earlier agent sells, when buy-back SOL is available. */
  buybackCeiling: number | null;
  /** Agents may only buy while spot is at or below this. */
  buyBelow: number;
  /** Agents may only sell while spot is at or above this. */
  sellAbove: number;
}

/**
 * Spot-price thresholds implied by the on-chain agent rules (launch.terms):
 * buy needs spot ≤ EMA·(1−band) and a fill at/below avg cost (or a buy-back below avg sell·(1−band));
 * sell needs spot ≥ EMA·(1+band) and a fill ≥ avg cost·(1+band).
 */
export function agentZones(l: LaunchJson, nowSec: number): AgentZones {
  const band = l.terms.agentBandBps / 10_000;
  const ema = projectEma({
    emaSol: l.emaSol,
    priceSol: l.priceSol,
    lastTradeTs: l.lastTradeTs,
    nowSec,
    periodSecs: l.terms.emaPeriodSecs,
  });
  const bandLow = ema * (1 - band);
  const bandHigh = ema * (1 + band);
  const avgCost = l.vaultAvgCostSol;
  const buybackCeiling = l.agentAvgSellSol !== null ? l.agentAvgSellSol * (1 - band) : null;
  return {
    ema,
    bandLow,
    bandHigh,
    avgCost,
    buybackCeiling,
    buyBelow: Math.min(bandLow, Math.max(avgCost, buybackCeiling ?? 0)),
    sellAbove: Math.max(bandHigh, avgCost * (1 + band)),
  };
}
