import type { MarketState } from "./strategy";

/**
 * Public order flow seen through the Launch account. Every poll reads cumulative counters
 * (`volume_sol`, `trade_count`, `real_sol`, `agent_*`); their differences between two polls are the
 * public volume, trade count and NET SOL flow (buys − sells into the curve) of that interval, with the
 * agent's own fills removed through the `agent_*` counters. On a constant-product curve the net flow
 * is what moved the price (bulk volume classification, Easley–López de Prado–O'Hara), the gross
 * volume is how much two-sided trading it took, and their ratio is the order-flow imbalance of
 * Cont–Kukanov–Stoikov. The simulator feeds the same counters, so the policy never sees anything the
 * live agent cannot.
 */

/** Flow horizons (s): the latest minute, the short window the gates look at, the long baseline window. */
export const FLOW_RECENT_SECS = 60;
export const FLOW_SHORT_SECS = 180;
export const FLOW_LONG_SECS = 1_800;
/** Minute volumes needed before the long window's median is used as the volume baseline. */
const MIN_BASELINE_MINUTES = 5;
/** Volume ratio reported when the baseline is 0 and there is volume now. */
const MAX_VOLUME_RATIO = 100;

export interface FlowSample {
  /** Chain time (s) of the poll that closed the interval and the interval's length. */
  t: number;
  dt: number;
  /** Public gross volume (SOL), net SOL into the curve (buys − sells, SOL) and public trades. */
  volume: number;
  net: number;
  trades: number;
  /** Spot the interval's volume is attributed to (lamports per base unit): geometric mean of both ends. */
  price: number;
}

export interface FlowFeatures {
  /** History covered by the window, s (0 at the first poll: every feature below is neutral). */
  spanSecs: number;
  /** Public volume (SOL), net flow (SOL) and trades over the short window. */
  volumeSol: number;
  netSol: number;
  trades: number;
  /** Σ net / Σ volume over the short / latest-minute window: −1 all sells … +1 all buys (0 without volume). */
  imbalance: number;
  imbalanceRecent: number;
  /** Short / latest-minute volume per minute over the long window's median minute volume (1 until the baseline exists). */
  volumeRatio: number;
  volumeRatioRecent: number;
  /** Spot vs the long window's volume-weighted average price, bps (0 without volume). */
  vwapDevBps: number;
  /** Seconds since the last on-chain trade of any side. */
  sinceTradeSecs: number;
}

/** Features of an empty window: no gate fires, no margin moves. */
export const NEUTRAL_FLOW: FlowFeatures = {
  spanSecs: 0,
  volumeSol: 0,
  netSol: 0,
  trades: 0,
  imbalance: 0,
  imbalanceRecent: 0,
  volumeRatio: 1,
  volumeRatioRecent: 1,
  vwapDevBps: 0,
  sinceTradeSecs: 0,
};

interface Counters {
  realSol: bigint;
  volumeSol: bigint;
  tradeCount: number;
  agentSolSpent: bigint;
  agentSolReceived: bigint;
  agentBuys: number;
  agentSells: number;
}

const LAMPORTS = 1e9;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Rolling per-launch flow window; `observe` once per poll, in chain time. */
export class FlowWindow {
  private last: { t: number; c: Counters; price: number } | null = null;
  private readonly samples: FlowSample[] = [];

  observe(m: MarketState, now: bigint): FlowFeatures {
    const t = Number(now);
    const price = Number(m.virtualSol + m.realSol) / Number(m.tokenReserve);
    const c: Counters = {
      realSol: m.realSol,
      volumeSol: m.volumeSol,
      tradeCount: m.tradeCount,
      agentSolSpent: m.agentSolSpent,
      agentSolReceived: m.agentSolReceived,
      agentBuys: m.agentBuys,
      agentSells: m.agentSells,
    };
    const last = this.last;
    if (last === null || t > last.t) {
      if (last !== null) {
        const spent = c.agentSolSpent - last.c.agentSolSpent;
        const received = c.agentSolReceived - last.c.agentSolReceived;
        // Public buys add their net to real_sol and their gross to volume; sells take their gross from real_sol
        // and add it to volume; the agent's own fills are in both and come out through the agent_* counters.
        const volume = Number(c.volumeSol - last.c.volumeSol - spent - received) / LAMPORTS;
        const net = Number(c.realSol - last.c.realSol - spent + received) / LAMPORTS;
        const trades = c.tradeCount - last.c.tradeCount - (c.agentBuys - last.c.agentBuys) - (c.agentSells - last.c.agentSells);
        this.samples.push({ t, dt: t - last.t, volume: Math.max(0, volume), net, trades: Math.max(0, trades), price: Math.sqrt(last.price * price) });
        const cutoff = t - FLOW_LONG_SECS;
        let drop = 0;
        while (drop < this.samples.length && this.samples[drop]!.t <= cutoff) drop++;
        if (drop > 0) this.samples.splice(0, drop);
      }
      this.last = { t, c, price };
    }
    return this.features(t, price, Math.max(0, t - Number(m.lastTradeTs)));
  }

  private features(t: number, price: number, sinceTradeSecs: number): FlowFeatures {
    const s = this.samples;
    if (s.length === 0) return { ...NEUTRAL_FLOW, sinceTradeSecs };
    const span = t - (s[0]!.t - s[0]!.dt);
    let vShort = 0;
    let nShort = 0;
    let trShort = 0;
    let vRecent = 0;
    let nRecent = 0;
    let vLong = 0;
    let pvLong = 0;
    const minutes = new Map<number, number>();
    for (const x of s) {
      const age = t - x.t;
      vLong += x.volume;
      pvLong += x.volume * x.price;
      const minute = Math.floor(x.t / 60);
      minutes.set(minute, (minutes.get(minute) ?? 0) + x.volume);
      if (age < FLOW_SHORT_SECS) {
        vShort += x.volume;
        nShort += x.net;
        trShort += x.trades;
      }
      if (age < FLOW_RECENT_SECS) {
        vRecent += x.volume;
        nRecent += x.net;
      }
    }
    const baseline = minutes.size >= MIN_BASELINE_MINUTES ? median([...minutes.values()]) : NaN;
    const ratio = (volume: number, windowSecs: number) => {
      if (Number.isNaN(baseline)) return 1;
      const rate = volume / (Math.min(windowSecs, span) / 60);
      if (baseline > 0) return Math.min(MAX_VOLUME_RATIO, rate / baseline);
      return rate > 0 ? MAX_VOLUME_RATIO : 1;
    };
    return {
      spanSecs: span,
      volumeSol: vShort,
      netSol: nShort,
      trades: trShort,
      imbalance: vShort > 0 ? nShort / vShort : 0,
      imbalanceRecent: vRecent > 0 ? nRecent / vRecent : 0,
      volumeRatio: ratio(vShort, FLOW_SHORT_SECS),
      volumeRatioRecent: ratio(vRecent, FLOW_RECENT_SECS),
      vwapDevBps: vLong > 0 ? (price / (pvLong / vLong) - 1) * 10_000 : 0,
      sinceTradeSecs,
    };
  }
}

/** Features rounded for `GET /status`. */
export function displayFlow(f: FlowFeatures): FlowFeatures {
  const r = (v: number, d: number) => Number(v.toFixed(d));
  return {
    spanSecs: f.spanSecs,
    volumeSol: r(f.volumeSol, 4),
    netSol: r(f.netSol, 4),
    trades: f.trades,
    imbalance: r(f.imbalance, 3),
    imbalanceRecent: r(f.imbalanceRecent, 3),
    volumeRatio: r(f.volumeRatio, 2),
    volumeRatioRecent: r(f.volumeRatioRecent, 2),
    vwapDevBps: r(f.vwapDevBps, 0),
    sinceTradeSecs: f.sinceTradeSecs,
  };
}
