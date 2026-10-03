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

/**
 * Flow horizons (s): the latest minute, the short window the gates (and the short VWAP) look at, the window of the
 * recent high the sell pause measures drawdowns from, the long baseline window, the day the support mode looks at.
 */
export const FLOW_RECENT_SECS = 60;
export const FLOW_SHORT_SECS = 180;
export const FLOW_HIGH_SECS = 900;
export const FLOW_LONG_SECS = 1_800;
export const FLOW_DAY_SECS = 86_400;
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
  /** SOL the agent's own sells took out of the curve in the interval. */
  agentSold: number;
  /** Spot the interval's volume is attributed to (lamports per base unit): geometric mean of both ends. */
  price: number;
  /** Spot at the end of the interval (lamports per base unit). */
  close: number;
}

export interface FlowFeatures {
  /** History covered by the window, s (0 at the first poll: every feature below is neutral). */
  spanSecs: number;
  /** Public volume (SOL), net flow (SOL) and trades over the short window. */
  volumeSol: number;
  netSol: number;
  trades: number;
  /** SOL the agent's own sells took out over the short window (sells sized against `netSol` subtract it). */
  agentSoldSol: number;
  /** Σ net / Σ volume over the short / latest-minute window: −1 all sells … +1 all buys (0 without volume). */
  imbalance: number;
  imbalanceRecent: number;
  /** Short / latest-minute volume per minute over the long window's median minute volume (1 until the baseline exists). */
  volumeRatio: number;
  volumeRatioRecent: number;
  /** Spot vs the long window's volume-weighted average price, bps (0 without volume). */
  vwapDevBps: number;
  /** Spot vs the short window's (FLOW_SHORT_SECS) volume-weighted average price, bps (0 without volume). */
  vwapShortDevBps: number;
  /** Spot vs the highest spot seen over the last FLOW_HIGH_SECS (0 = at the high, 0.5 = halved). */
  drawdownHigh: number;
  /**
   * Net public SOL into the curve since that high (buys − sells, the agent's own fills removed; 0 at the high). On a
   * constant-product curve a price under its high with this negative means the public sold it down, not the agent.
   */
  netSinceHighSol: number;
  /** Seconds since the last on-chain trade of any side. */
  sinceTradeSecs: number;
  /** Seconds since the agent's own last fill as seen through the `agent_*` counters; Infinity before the window saw one. */
  sinceAgentTradeSecs: number;
  /**
   * Activity over the last 24 h, SOL: per interval the larger of the public gross volume and the absolute net flow
   * (on a pump launch public volume never reaches the Launch counters, so the price-implied net flow is the lower bound).
   */
  volume24hSol: number;
  /** Spot vs the highest spot of the last 24 h (0 = at the high, 0.5 = halved). */
  drawdown24h: number;
}

/** Features of an empty window: no gate fires, no margin moves. */
export const NEUTRAL_FLOW: FlowFeatures = {
  spanSecs: 0,
  volumeSol: 0,
  netSol: 0,
  trades: 0,
  agentSoldSol: 0,
  imbalance: 0,
  imbalanceRecent: 0,
  volumeRatio: 1,
  volumeRatioRecent: 1,
  vwapDevBps: 0,
  vwapShortDevBps: 0,
  drawdownHigh: 0,
  netSinceHighSol: 0,
  sinceTradeSecs: 0,
  sinceAgentTradeSecs: Infinity,
  volume24hSol: 0,
  drawdown24h: 0,
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

/** What the window reads of a launch: the venue reserves (spot) and the cumulative Launch counters. */
export type FlowInput = Pick<
  MarketState,
  "virtualSol" | "realSol" | "tokenReserve" | "volumeSol" | "tradeCount" | "agentSolSpent" | "agentSolReceived" | "agentBuys" | "agentSells" | "lastTradeTs"
>;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Rolling per-launch flow window, in chain time. `observe` at least once per poll; observing more often (every
 * account update of the subscription) only refines it: one sample per chain second at most, a later
 * observation in the same second extends that second's sample in place, so a trade is in the features as soon
 * as it is seen and the sums come out the same as one observation at the end of the second.
 */
export class FlowWindow {
  private last: { t: number; c: Counters; price: number } | null = null;
  /** What the latest sample is measured from (the observation before its second), while that sample is open. */
  private open: { c: Counters; price: number } | null = null;
  private readonly samples: FlowSample[] = [];
  /** Per minute bucket over the last FLOW_DAY_SECS: activity (SOL) and the highest spot seen. */
  private readonly daily = new Map<number, { activity: number; high: number }>();
  private dailySum = 0;
  /** Chain time of the first poll (the day window's age while younger than a day). */
  private firstT: number | null = null;
  /** Chain time of the poll that first saw the agent's latest fill; null until the window saw one. */
  private agentTradeAt: number | null = null;

  observe(m: FlowInput, now: bigint): FlowFeatures {
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
      this.firstT ??= t;
      const minute = Math.floor(t / 60);
      const bucket = this.daily.get(minute) ?? { activity: 0, high: 0 };
      if (price > bucket.high) bucket.high = price;
      if (last !== null) {
        const sample = this.sample(last, c, t, t - last.t, price);
        this.samples.push(sample);
        this.open = { c: last.c, price: last.price };
        const cutoff = t - FLOW_LONG_SECS;
        let drop = 0;
        while (drop < this.samples.length && this.samples[drop]!.t <= cutoff) drop++;
        if (drop > 0) this.samples.splice(0, drop);
        bucket.activity += sample.volume;
        this.dailySum += sample.volume;
      }
      this.daily.set(minute, bucket);
      const dayCutoff = minute - FLOW_DAY_SECS / 60;
      for (const [k, v] of this.daily) {
        if (k > dayCutoff) break;
        this.daily.delete(k);
        this.dailySum -= v.activity;
      }
      this.last = { t, c, price };
    } else if (t === last.t && this.open !== null && this.samples.at(-1)?.t === t) {
      // Same chain second as the open sample: re-measure it from its start to these counters.
      const prev = this.samples.at(-1)!;
      const sample = this.sample(this.open, c, t, prev.dt, price);
      this.samples[this.samples.length - 1] = sample;
      const bucket = this.daily.get(Math.floor(t / 60))!;
      if (price > bucket.high) bucket.high = price;
      bucket.activity += sample.volume - prev.volume;
      this.dailySum += sample.volume - prev.volume;
      this.last = { t, c, price };
    }
    return this.features(t, price, Math.max(0, t - Number(m.lastTradeTs)));
  }

  /** The public flow between the counters `from` and `c`, attributed to the interval of length `dt` ending at `t`. */
  private sample(from: { c: Counters; price: number }, c: Counters, t: number, dt: number, price: number): FlowSample {
    const spent = c.agentSolSpent - from.c.agentSolSpent;
    const received = c.agentSolReceived - from.c.agentSolReceived;
    // Public buys add their net to real_sol and their gross to volume; sells take their gross from real_sol
    // and add it to volume; the agent's own fills are in both and come out through the agent_* counters.
    const gross = Number(c.volumeSol - from.c.volumeSol - spent - received) / LAMPORTS;
    const net = Number(c.realSol - from.c.realSol - spent + received) / LAMPORTS;
    // On a pump launch public volume never reaches the Launch counters: the price-implied |net| is its lower bound
    // (otherwise imbalance and the volume ratio stay 0 / 1 there and no flow gate — the payout's included — can ever fire).
    const volume = Math.max(0, gross, Math.abs(net));
    const trades = c.tradeCount - from.c.tradeCount - (c.agentBuys - from.c.agentBuys) - (c.agentSells - from.c.agentSells);
    if (c.agentBuys !== from.c.agentBuys || c.agentSells !== from.c.agentSells) this.agentTradeAt = t;
    return { t, dt, volume, net, trades: Math.max(0, trades), agentSold: Number(received) / LAMPORTS, price: Math.sqrt(from.price * price), close: price };
  }

  private features(t: number, price: number, sinceTradeSecs: number): FlowFeatures {
    const s = this.samples;
    const sinceAgentTradeSecs = this.agentTradeAt === null ? Infinity : t - this.agentTradeAt;
    // Activity per 24 h; while the window is younger than a day the observed span (≥ 1 h) is scaled up to a day.
    const daySpan = Math.min(FLOW_DAY_SECS, Math.max(3_600, t - (this.firstT ?? t)));
    const volume24hSol = (Math.max(0, this.dailySum) * FLOW_DAY_SECS) / daySpan;
    let high = price;
    for (const b of this.daily.values()) if (b.high > high) high = b.high;
    const drawdown24h = high > 0 ? 1 - price / high : 0;
    if (s.length === 0) return { ...NEUTRAL_FLOW, sinceTradeSecs, sinceAgentTradeSecs, volume24hSol, drawdown24h };
    const span = t - (s[0]!.t - s[0]!.dt);
    let vShort = 0;
    let nShort = 0;
    let trShort = 0;
    let soldShort = 0;
    let vRecent = 0;
    let nRecent = 0;
    let vLong = 0;
    let pvLong = 0;
    let pvShort = 0;
    // Highest close of the high window and the public net flow of the samples after it.
    let recentHigh = 0;
    let netSinceHigh = 0;
    const minutes = new Map<number, number>();
    for (const x of s) {
      const age = t - x.t;
      vLong += x.volume;
      pvLong += x.volume * x.price;
      const minute = Math.floor(x.t / 60);
      minutes.set(minute, (minutes.get(minute) ?? 0) + x.volume);
      if (age < FLOW_SHORT_SECS) {
        vShort += x.volume;
        pvShort += x.volume * x.price;
        nShort += x.net;
        trShort += x.trades;
        soldShort += x.agentSold;
      }
      if (age < FLOW_HIGH_SECS) {
        if (x.close >= recentHigh) {
          recentHigh = x.close;
          netSinceHigh = 0;
        } else {
          netSinceHigh += x.net;
        }
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
      agentSoldSol: soldShort,
      imbalance: vShort > 0 ? nShort / vShort : 0,
      imbalanceRecent: vRecent > 0 ? nRecent / vRecent : 0,
      volumeRatio: ratio(vShort, FLOW_SHORT_SECS),
      volumeRatioRecent: ratio(vRecent, FLOW_RECENT_SECS),
      vwapDevBps: vLong > 0 ? (price / (pvLong / vLong) - 1) * 10_000 : 0,
      vwapShortDevBps: vShort > 0 ? (price / (pvShort / vShort) - 1) * 10_000 : 0,
      drawdownHigh: recentHigh > price ? 1 - price / recentHigh : 0,
      netSinceHighSol: recentHigh > price ? netSinceHigh : 0,
      sinceTradeSecs,
      sinceAgentTradeSecs,
      volume24hSol,
      drawdown24h,
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
    agentSoldSol: r(f.agentSoldSol, 4),
    imbalance: r(f.imbalance, 3),
    imbalanceRecent: r(f.imbalanceRecent, 3),
    volumeRatio: r(f.volumeRatio, 2),
    volumeRatioRecent: r(f.volumeRatioRecent, 2),
    vwapDevBps: r(f.vwapDevBps, 0),
    vwapShortDevBps: r(f.vwapShortDevBps, 0),
    drawdownHigh: r(f.drawdownHigh, 3),
    netSinceHighSol: r(f.netSinceHighSol, 4),
    sinceTradeSecs: f.sinceTradeSecs,
    sinceAgentTradeSecs: f.sinceAgentTradeSecs,
    volume24hSol: r(f.volume24hSol, 4),
    drawdown24h: r(f.drawdown24h, 3),
  };
}
