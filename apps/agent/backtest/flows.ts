import { publicBuy, publicFeeBps } from "./program";
import { T0, type Market, type PublicFlow, type Recording, type Rng } from "./sim";

/**
 * Public order flow models.
 *
 * - `FairValueFlow` (history, arbitrage): every public trade moves spot to the historical path, and
 *   whatever deviation the agent created since the previous public trade decays with a half-life
 *   (the crowd trades against a price it considers wrong), so agent impact is temporary.
 * - `ReplayFlow` (history, exogenous): replays the exact public trades of the no-agent run of the
 *   same path (buys as SOL in, sells as tokens in, capped by what the public holds), so agent impact
 *   persists: flows don't care what the vault did.
 * - `TraderMixFlow` (synthetic): the persona mix of scripts/src/simulate.ts (momentum, mean-reverting
 *   against the on-chain EMA, noise, whale pumps and dumps), reacting to the agent endogenously.
 */

/** Public trades per candle minute on the historical paths (one every ~5 s, jittered). */
const TRADES_PER_MIN = 12;
const MINUTE_MS = 60_000;

/** Piecewise log-linear price path (log of price relative to the first open) with knots in ms. */
export interface PricePath {
  kt: number[];
  kl: number[];
  /** Start (ms) of every minute that had a candle: public trades happen only there. */
  minutes: number[];
  /** Per candle minute: USD volume over the first open price (whole tokens traded at the first price). */
  volume: number[];
  durationMs: number;
  minLog: number;
}

export type Candle = [t: number, o: number, h: number, l: number, c: number, volumeUsd: number];

/** A wick more than 3× beyond the candle body is treated as a bad print and clamped to 3×. */
const WICK_MAX = 3;

/**
 * Intra-minute path from o/h/l/c: open at :00, the extreme nearer in the candle's direction at :20
 * (low first for up candles, high first for down candles), the other extreme at :40, close at :59.999,
 * then flat through minutes without trades.
 */
export function pathFromCandles(candles: Candle[]): PricePath {
  const kt: number[] = [];
  const kl: number[] = [];
  const minutes: number[] = [];
  const volume: number[] = [];
  const t0 = candles[0]![0];
  const first = candles[0]![1];
  const ref = Math.log(first);
  let minLog = 0;
  const knot = (t: number, price: number) => {
    const l = Math.log(price) - ref;
    kt.push(t);
    kl.push(l);
    if (l < minLog) minLog = l;
  };
  for (let i = 0; i < candles.length; i++) {
    const [t, o, hRaw, lRaw, c, volumeUsd] = candles[i]!;
    const h = Math.min(hRaw, Math.max(o, c) * WICK_MAX);
    const l = Math.max(lRaw, Math.min(o, c) / WICK_MAX);
    const start = (t - t0) * 1_000;
    const up = c >= o;
    minutes.push(start);
    volume.push(volumeUsd > 0 ? volumeUsd / first : 0);
    knot(start, o);
    knot(start + 20_000, up ? l : h);
    knot(start + 40_000, up ? h : l);
    knot(start + 59_999, c);
    const next = candles[i + 1];
    if (next && (next[0] - t0) * 1_000 > start + MINUTE_MS) knot((next[0] - t0) * 1_000 - 1, c);
  }
  const last = candles[candles.length - 1]!;
  return { kt, kl, minutes, volume, durationMs: (last[0] - t0) * 1_000 + MINUTE_MS, minLog };
}

/** Moving read cursor over a path (queries arrive in increasing time). */
class PathCursor {
  private i = 0;

  constructor(private readonly p: PricePath) {}

  at(t: number): number {
    const { kt, kl } = this.p;
    while (this.i + 1 < kt.length && kt[this.i + 1]! <= t) this.i++;
    const i = this.i;
    if (i + 1 >= kt.length || t <= kt[i]!) return kl[i]!;
    const w = (t - kt[i]!) / (kt[i + 1]! - kt[i]!);
    return kl[i]! + w * (kl[i + 1]! - kl[i]!);
  }
}

/**
 * Public buys from the launch price up to the path's (scaled) first price before t = 0, with the EMA
 * settled there and the window fresh: the history starts in a calm, already-traded market.
 */
export function preroll(market: Market, logTarget: number): void {
  const c = market.chain;
  const x = Number(c.virtualSol + c.realSol);
  const d = logTarget - Math.log(x / Number(c.tokenReserve));
  if (d > 1e-6) {
    const gross = Math.floor((x * (Math.exp(d / 2) - 1)) / (1 - Number(publicFeeBps(c)) / 10_000));
    const res = publicBuy(c, BigInt(gross), 0n, BigInt(T0), 0);
    if (!res.ok) throw new Error(`preroll buy failed: ${res.error}`);
  }
  c.emaPrice = ((c.virtualSol + c.realSol) << 64n) / c.tokenReserve;
  c.lastTradeTs = BigInt(T0);
  c.lastPublicTradeSlot = -1;
}

/** Schedules TRADES_PER_MIN jittered trade times in every candle minute, never going back in time. */
class MinuteClock {
  private minute = 0;
  private k = 0;
  private due: number;
  private last = -1;

  constructor(
    private readonly minutes: number[],
    private readonly rng: Rng,
  ) {
    this.due = this.slotTime();
  }

  private slotTime(): number {
    if (this.minute >= this.minutes.length) return Infinity;
    const step = MINUTE_MS / TRADES_PER_MIN;
    return Math.max(this.last + 1, this.minutes[this.minute]! + this.k * step + Math.floor(this.rng() * step));
  }

  next(): number {
    return this.due;
  }

  defer(at: number): void {
    this.due = at;
  }

  /** Index of the candle minute the due trade belongs to. */
  minuteIndex(): number {
    return this.minute;
  }

  advance(t: number): void {
    this.last = t;
    if (++this.k >= TRADES_PER_MIN) {
      this.k = 0;
      this.minute++;
    }
    this.due = this.slotTime();
  }
}

export class FairValueFlow implements PublicFlow {
  private readonly cursor: PathCursor;
  private readonly clock: MinuteClock;
  private lastTarget: number;
  private lastT = 0;
  /** Lamports of volume per trade slot in each candle minute (the candle's volume on this curve, see `volumeLamports`). */
  private readonly slotVolume: number[];

  /**
   * `logOffset` maps the path's log(relative price) to log(curve spot); `halfLifeMs` = 0 resets every deviation at
   * once; `volumeScale` multiplies the candle volume the flow window sees (robustness runs).
   */
  constructor(
    path: PricePath,
    private readonly logOffset: number,
    private readonly halfLifeMs: number,
    rng: Rng,
    volumeScale = 1,
  ) {
    this.cursor = new PathCursor(path);
    this.clock = new MinuteClock(path.minutes, rng);
    this.lastTarget = logOffset + path.kl[0]!;
    this.slotVolume = path.volume.map((v) => (volumeLamports(v, logOffset) * volumeScale) / TRADES_PER_MIN);
  }

  next(): number {
    return this.clock.next();
  }

  defer(at: number): void {
    this.clock.defer(at);
  }

  trade(m: Market): void {
    const target = this.logOffset + this.cursor.at(m.t);
    const deviation = Math.log(m.spot()) - this.lastTarget;
    const keep = this.halfLifeMs > 0 ? 0.5 ** ((m.t - this.lastT) / this.halfLifeMs) : 0;
    const gross = m.moveTo(target + deviation * keep);
    // The candle's volume beyond what the move took is two-sided: booked as churn, the price path stays the path.
    m.churn(this.slotVolume[this.clock.minuteIndex()]! - gross);
    this.lastTarget = target;
    this.lastT = m.t;
    this.clock.advance(m.t);
  }
}

/**
 * Candle volume on our curve, in lamports: `volume` is USD volume / first USD price (whole tokens at the
 * first price); the price mapping is multiplicative (spot_t / P_t = e^logOffset / P_0 for every t), so the
 * SOL value of those tokens on the curve is volume × 10^6 base units × e^logOffset lamports per base unit.
 * This is the market-cap-consistent scaling; it says nothing about how deep the real pool was.
 */
export function volumeLamports(volume: number, logOffset: number): number {
  return volume * 1e6 * Math.exp(logOffset);
}

export class ReplayFlow implements PublicFlow {
  private i = 0;
  private due: number;
  private last = -1;

  constructor(private readonly trades: Recording) {
    this.due = trades.t[0] ?? Infinity;
  }

  next(): number {
    return this.due;
  }

  defer(at: number): void {
    this.due = at;
  }

  trade(m: Market): void {
    const i = this.i++;
    const amount = this.trades.amount[i]!;
    if (amount > 0) m.buy(BigInt(amount));
    else if (amount < 0) m.sell(BigInt(-amount));
    m.churn(this.trades.churn[i]!);
    this.last = m.t;
    const next = this.trades.t[this.i];
    this.due = next === undefined ? Infinity : Math.max(next, this.last + 1);
  }
}

// ------------------------------------------------------------------ synthetic trader mix

type Persona = "momentum" | "reverter" | "noise";
const PERSONA_WEIGHTS: Record<Persona, { momentum: number; revert: number }> = {
  momentum: { momentum: 0.9, revert: 0.1 },
  reverter: { momentum: 0.1, revert: 0.9 },
  noise: { momentum: 0.25, revert: 0.25 },
};
const PERSONAS: Persona[] = ["momentum", "reverter", "noise"];

/** scripts/src/simulate.ts defaults: 10 traders, 2 whales, median trade 0.15 SOL, whale probability 0.04, ~3 s between trades. */
export interface TraderMixOptions {
  traders: number;
  whales: number;
  medianTradeSol: number;
  whaleProb: number;
  intervalMs: number;
}

export const TRADER_MIX: TraderMixOptions = { traders: 10, whales: 2, medianTradeSol: 0.15, whaleProb: 0.04, intervalMs: 3_000 };

/** SOL rounded to 0.001 as lamports, like the traffic simulator's amounts. */
const solLamports = (sol: number) => BigInt(Math.round(sol * 1_000)) * 1_000_000n;

export class TraderMixFlow implements PublicFlow {
  private mood = 0.8; // fresh launches draw a crowd
  private prices: number[] = [];
  private due: number;
  private readonly traders: { persona: Persona; held: bigint }[];
  private readonly whales: bigint[];

  constructor(
    private readonly rng: Rng,
    private readonly launchPrice: number,
    private readonly o: TraderMixOptions = TRADER_MIX,
  ) {
    this.traders = Array.from({ length: o.traders }, (_, i) => ({ persona: PERSONAS[i % 3]!, held: 0n }));
    this.whales = Array.from({ length: o.whales }, () => 0n);
    this.due = this.delay(0);
  }

  private gauss(): number {
    const u = 1 - this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng());
  }

  private logNormal(median: number, sigma: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, median * Math.exp(sigma * this.gauss())));
  }

  /** Exponential inter-arrival with the configured mean, clamped to [mean/6, 4·mean]. */
  private delay(from: number): number {
    const mean = this.o.intervalMs;
    return from + Math.min(4 * mean, Math.max(mean / 6, -Math.log(1 - this.rng()) * mean));
  }

  next(): number {
    return this.due;
  }

  defer(at: number): void {
    this.due = at;
  }


  /** Tokens to sell for about `sol` net (curve inverse incl. fee); the whole bag when that is most of it. */
  private tokensForSol(m: Market, sol: number, held: bigint): bigint {
    const c = m.chain;
    const x = Number(c.virtualSol + c.realSol) / 1e9;
    const gross = sol / (1 - Number(publicFeeBps(c)) / 10_000);
    if (gross >= x * 0.9) return held;
    const want = BigInt(Math.floor((gross * Number(c.tokenReserve)) / (x - gross)));
    return want * 100n >= held * 85n ? held : want;
  }

  trade(m: Market): void {
    const r = this.rng;
    this.mood += -0.08 * this.mood + 0.3 * this.gauss();
    const price = m.spot();
    if (this.prices.at(-1) !== price) this.prices = [...this.prices.slice(-11), price];

    if (r() < this.o.whaleProb) {
      const runUp = price / this.launchPrice;
      let top = -1;
      for (let i = 0; i < this.whales.length; i++) if (this.whales[i]! > 0n && (top < 0 || this.whales[i]! > this.whales[top]!)) top = i;
      if (top >= 0 && r() < Math.min(0.8, 0.3 + 0.25 * Math.log(runUp + 1))) {
        const held = this.whales[top]!;
        this.whales[top] = held - m.sell((held * BigInt(Math.round(600 + r() * 400))) / 1_000n);
      } else {
        const w = Math.floor(r() * this.whales.length);
        this.whales[w]! += m.buy(solLamports(this.logNormal(3, 0.4, 1.5, 8)));
      }
    } else {
      const trader = this.traders[Math.floor(r() * this.traders.length)]!;
      const w = PERSONA_WEIGHTS[trader.persona];
      const past = this.prices.length > 1 ? this.prices[0]! : price;
      const momentum = Math.log(price / past) / 0.05;
      const c = m.chain;
      const dt = Math.max(0, Number(m.now() - c.lastTradeTs));
      const emaNow = Number(c.emaPrice) / 2 ** 64;
      const ema = emaNow + ((price - emaNow) * dt) / (dt + Number(c.terms.emaPeriodSecs));
      const deviation = Math.log(price / ema) / 0.03;
      const anchor = Math.log(price / this.launchPrice);
      const pBuy = Math.min(0.9, Math.max(0.1, 1 / (1 + Math.exp(-(this.mood + w.momentum * momentum - w.revert * deviation - 0.8 * anchor)))));
      const sol = this.logNormal(this.o.medianTradeSol, 0.85, 0.02, 3);
      if (r() < pBuy || trader.held === 0n) trader.held += m.buy(solLamports(sol));
      else trader.held -= m.sell(this.tokensForSol(m, sol, trader.held));
    }
    this.due = this.delay(m.t);
  }
}
