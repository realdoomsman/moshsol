import { BPS, bpsCeil } from "@holdfast/sdk";
import { FlowWindow, NEUTRAL_FLOW, type FlowFeatures } from "../src/flow";
import { evaluate, project, type Plan, type Sizing, type StrategyParams } from "../src/strategy";
import { agentBuy, agentSell, launch, publicBuy, publicFeeBps, publicSell, publicTokens, type Chain, type LaunchSetup, type ProgramError } from "./program";
import { evaluateV1 } from "./v1";

/**
 * Event-driven launch simulator. One `Chain` (the program mirror) is traded by a public flow model
 * and, optionally, by a simulated agent that behaves like apps/agent/src/agent.ts: it polls every
 * `pollMs`, re-reads the launch before sending, lands after a network delay in a later slot (where
 * public trades may have moved the market or taken the slot), waits `cooldownMs` after a trade and
 * backs off exponentially after a failure.
 */

export const SLOT_MS = 400;
/** Unix time of simulated t = 0 (any value works; the program only uses differences). */
export const T0 = 1_700_000_000;
const MINUTE_MS = 60_000;

export type Policy = { kind: "none" } | { kind: "v1" } | { kind: "tuned"; params: StrategyParams };

export interface SimOptions {
  pollMs: number;
  /** Poll → re-read of launch + clock right before sending. */
  rereadMs: number;
  /** Re-read → landing, uniform in [min, max]. */
  sendMsMin: number;
  sendMsMax: number;
  /** Landing → confirmation seen by the agent. */
  confirmMs: number;
  cooldownMs: number;
  maxBackoffMs: number;
  sizing: Sizing;
}

/** apps/agent defaults, with the production poll interval (Railway `POLL_MS=10000`). */
export const DEFAULT_SIM: SimOptions = {
  pollMs: 10_000,
  rereadMs: 250,
  sendMsMin: 400,
  sendMsMax: 1_200,
  confirmMs: 600,
  cooldownMs: 15_000,
  maxBackoffMs: 300_000,
  sizing: { minTradeLamports: 10_000_000n, slippageBps: 100 },
};

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hashSeed(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16_777_619);
  return h >>> 0;
}

/**
 * Executed public trades (the exogenous-flow recording), column-wise to keep dozens of 72 h
 * recordings per worker small: times (ms) and signed amounts, + = buy of that many gross lamports,
 * − = sell of that many token base units (both below 2^53, so exact as doubles), plus the churn
 * volume (lamports, see `Market.churn`) booked with the trade (an entry with amount 0 is churn only).
 */
export interface Recording {
  t: number[];
  amount: number[];
  churn: number[];
}

/** Chain + clock + public-trade bookkeeping shared by the flow models and the agent. */
export class Market {
  t = 0;
  /** Per minute: curve-side SOL (lamports) and tokens traded publicly, for VWAPs. */
  readonly pubSol: number[] = [];
  readonly pubTok: number[] = [];
  publicFails = 0;
  /** Public volume, lamports: executed public trades (gross) plus the history's churn (see `churn`). */
  publicVolume = 0;
  /** Gross lamports of the last executed public trade (what `volume_sol` counted). */
  private lastGross = 0;

  constructor(
    readonly chain: Chain,
    /** When set, every executed public trade is appended (the exogenous-flow recording). */
    readonly recording: Recording | null,
  ) {}

  now(): bigint {
    return BigInt(T0 + Math.floor(this.t / 1_000));
  }

  slot(): number {
    return Math.floor(this.t / SLOT_MS);
  }

  /** Spot as lamports per token base unit (float). */
  spot(): number {
    return Number(this.chain.virtualSol + this.chain.realSol) / Number(this.chain.tokenReserve);
  }

  /** Public buy of `gross` lamports now; returns tokens bought (0 when the program rejected it). */
  buy(gross: bigint): bigint {
    const c = this.chain;
    const res = publicBuy(c, gross, 0n, this.now(), this.slot());
    if (!res.ok) {
      this.publicFails++;
      return 0n;
    }
    this.book(Number(gross - bpsCeil(gross, publicFeeBps(c))), Number(res.out));
    this.lastGross = Number(gross);
    this.publicVolume += this.lastGross;
    this.record(this.lastGross, 0);
    return res.out;
  }

  /** Public sell of up to `tokens` (capped by what the public holds); returns tokens sold. */
  sell(tokens: bigint): bigint {
    const c = this.chain;
    const held = publicTokens(c);
    const amount = tokens > held ? held : tokens;
    if (amount <= 0n) return 0n;
    const gross = ((c.virtualSol + c.realSol) * amount) / (c.tokenReserve + amount);
    const res = publicSell(c, amount, 0n, this.now(), this.slot());
    if (!res.ok) {
      this.publicFails++;
      return 0n;
    }
    this.book(Number(gross), Number(amount));
    this.lastGross = Number(gross);
    this.publicVolume += this.lastGross;
    this.record(-Number(amount), 0);
    return amount;
  }

  /**
   * Two-sided volume the history had beyond what moving the price took: booked on the launch's
   * `volume_sol` / `trade_count` as one round trip (a buy and its sell at the same price, which leaves
   * reserves, EMA and the slot bookkeeping as they are), so the agent's flow window sees the candle's
   * volume while the price path stays exactly the path. A pump launch never sees public volume (it
   * trades on pump.fun), so only the recording gets it.
   */
  churn(lamports: number): void {
    if (lamports < 1) return;
    const l = Math.floor(lamports);
    this.publicVolume += l;
    if (this.chain.venue === "holdfast") {
      this.chain.volumeSol += BigInt(l);
      this.chain.tradeCount += 2;
    }
    this.record(0, l);
  }

  /** Public trade that moves spot to exp(logTarget) (lamports per base unit); sells stop at the public's holdings. Returns the gross lamports traded. */
  moveTo(logTarget: number): number {
    const c = this.chain;
    const x = Number(c.virtualSol + c.realSol);
    const y = Number(c.tokenReserve);
    const d = logTarget - Math.log(x / y);
    this.lastGross = 0;
    if (d > 1e-5) {
      // x·y is constant, spot = x/y, so x scales with √(spot ratio); gross covers the fee.
      const net = x * (Math.exp(d / 2) - 1);
      const gross = Math.floor(net / (1 - Number(publicFeeBps(c)) / Number(BPS)));
      if (gross >= 10_000) this.buy(BigInt(gross));
    } else if (d < -1e-5) {
      const tokens = Math.floor(y * (Math.exp(-d / 2) - 1));
      if (tokens >= 1_000) this.sell(BigInt(tokens));
    }
    return this.lastGross;
  }

  private record(amount: number, churn: number): void {
    const r = this.recording;
    if (!r) return;
    const last = r.t.length - 1;
    if (churn > 0 && last >= 0 && r.t[last] === this.t && r.churn[last] === 0) {
      r.churn[last] = churn;
      return;
    }
    r.t.push(this.t);
    r.amount.push(amount);
    r.churn.push(churn);
  }

  private book(sol: number, tokens: number): void {
    const m = Math.floor(this.t / MINUTE_MS);
    while (this.pubSol.length <= m) {
      this.pubSol.push(0);
      this.pubTok.push(0);
    }
    this.pubSol[m]! += sol;
    this.pubTok[m]! += tokens;
  }
}

/** A public order-flow model driving one run. */
export interface PublicFlow {
  /** Sim time (ms) of the next public trade; Infinity when the flow is done. */
  next(): number;
  /** Executes the trade due at `market.t` (== next()). */
  trade(market: Market): void;
  /** The due trade would share a slot with an agent trade (the program rejects it): retry at `at`. */
  defer(at: number): void;
}

export interface Scenario {
  id: string;
  tag: string;
  model: string;
  setup: LaunchSetup;
  durationMs: number;
  /** Seed for the launch's public start state (pre-roll to the history's first price) and the flow. */
  prepare(market: Market, rng: Rng): PublicFlow;
}

export interface AgentStats {
  polls: number;
  buys: number;
  sells: number;
  solSpent: number;
  solReceived: number;
  tokensBought: number;
  tokensSold: number;
  /** Plans the program mirror rejects on the very state they were planned on (must stay 0). */
  plannedRejects: number;
  plannedRejectKinds: Partial<Record<ProgramError, number>>;
  /** Sent trades that failed on landing (state or slot changed in flight). */
  landedRejects: Partial<Record<ProgramError, number>>;
  holds: Record<string, number>;
}

export interface RunResult {
  scenario: string;
  tag: string;
  model: string;
  policy: string;
  minutes: number;
  /** Spot at t = 0 and at the end, lamports per base unit. */
  startPrice: number;
  finalPrice: number;
  /** Public curve-side VWAP over the run's last 24 h (final price when nothing traded). */
  vwap24: number;
  sol0: number;
  tokens0: number;
  sol1: number;
  tokens1: number;
  /** Largest peak-to-trough fall of minute spot, 0..1. */
  maxDrawdown: number;
  /** σ of minute log returns, bps. */
  volBps: number;
  /** Share of minutes with spot within the EMA band. */
  inBand: number;
  feesSol: number;
  publicFails: number;
  /** Public volume over the run, SOL (`Market.publicVolume`). */
  publicVolumeSol: number;
  agent: AgentStats | null;
}

class SimAgent {
  at: number;
  private phase: "poll" | "decide" | "land" = "poll";
  private pollStart = 0;
  private nextTradeAt = 0;
  private failures = 0;
  private plan: Plan | null = null;
  /**
   * One flow observation per poll, reused by the re-read right before sending. The live agent also folds in every
   * streamed update, which only refines the same per-second samples (`FlowWindow`): `pollMs: 1_000` mirrors it.
   */
  private readonly flow = new FlowWindow();
  private features: FlowFeatures = NEUTRAL_FLOW;
  readonly stats: AgentStats = {
    polls: 0,
    buys: 0,
    sells: 0,
    solSpent: 0,
    solReceived: 0,
    tokensBought: 0,
    tokensSold: 0,
    plannedRejects: 0,
    plannedRejectKinds: {},
    landedRejects: {},
    holds: {},
  };

  constructor(
    private readonly policy: Exclude<Policy, { kind: "none" }>,
    private readonly opt: SimOptions,
    private readonly rng: Rng,
  ) {
    this.at = Math.floor(rng() * opt.pollMs);
  }

  private decide(market: Market): Plan {
    const c = market.chain;
    const now = market.now();
    return this.policy.kind === "v1" ? evaluateV1(c, this.opt.sizing, now) : evaluate(c, this.opt.sizing, now, this.policy.params, this.features).plan;
  }

  private nextPoll(earliest: number): void {
    this.phase = "poll";
    this.at = Math.max(this.pollStart + this.opt.pollMs, earliest);
  }

  step(market: Market): void {
    const s = this.stats;
    if (this.phase === "poll") {
      this.pollStart = this.at;
      s.polls++;
      this.features = this.flow.observe(market.chain, market.now());
      const plan = this.decide(market);
      if (plan.action === "hold") {
        s.holds[plan.kind] = (s.holds[plan.kind] ?? 0) + 1;
        this.failures = 0;
        return this.nextPoll(this.at);
      }
      if (this.at < this.nextTradeAt) {
        s.holds.cooldown = (s.holds.cooldown ?? 0) + 1;
        return this.nextPoll(this.at);
      }
      this.phase = "decide";
      this.at += this.opt.rereadMs;
      return;
    }
    if (this.phase === "decide") {
      const plan = this.decide(market);
      if (plan.action === "hold") {
        this.failures = 0;
        return this.nextPoll(this.at);
      }
      // The plan must pass the program on the state it was planned on (fresh slot, same clock).
      const probe = { ...market.chain };
      const slot = Math.max(probe.lastPublicTradeSlot, probe.lastAgentTradeSlot) + 1;
      const check =
        plan.action === "buy"
          ? agentBuy(probe, plan.amount, plan.minOut, market.now(), slot)
          : agentSell(probe, plan.amount, plan.minOut, market.now(), slot);
      if (!check.ok) {
        s.plannedRejects++;
        s.plannedRejectKinds[check.error] = (s.plannedRejectKinds[check.error] ?? 0) + 1;
      }
      this.plan = plan;
      this.phase = "land";
      this.at += this.opt.sendMsMin + Math.floor(this.rng() * (this.opt.sendMsMax - this.opt.sendMsMin));
      return;
    }
    const plan = this.plan as Extract<Plan, { action: "buy" | "sell" }>;
    const c = market.chain;
    const res =
      plan.action === "buy"
        ? agentBuy(c, plan.amount, plan.minOut, market.now(), market.slot())
        : agentSell(c, plan.amount, plan.minOut, market.now(), market.slot());
    const confirmed = this.at + this.opt.confirmMs;
    if (res.ok) {
      this.failures = 0;
      this.nextTradeAt = confirmed + this.opt.cooldownMs;
      if (plan.action === "buy") {
        s.buys++;
        s.solSpent += Number(plan.amount) / 1e9;
        s.tokensBought += Number(res.out) / 1e6;
      } else {
        s.sells++;
        s.solReceived += Number(res.out) / 1e9;
        s.tokensSold += Number(plan.amount) / 1e6;
      }
    } else {
      this.failures++;
      s.landedRejects[res.error] = (s.landedRejects[res.error] ?? 0) + 1;
      this.nextTradeAt = confirmed + Math.min(this.opt.cooldownMs * 2 ** (this.failures - 1), this.opt.maxBackoffMs);
    }
    this.plan = null;
    this.nextPoll(confirmed);
  }
}

/** Runs `scenario` under `policy`; `recording` collects the executed public trades (exogenous replay source). */
export function simulate(sc: Scenario, policy: Policy, opt: SimOptions = DEFAULT_SIM, recording: Recording | null = null): RunResult {
  const chain = launch(sc.setup, BigInt(T0));
  const market = new Market(chain, recording);
  const rng = mulberry32(hashSeed(sc.id));
  const flow = sc.prepare(market, rng);
  const agentRng = mulberry32(hashSeed(`${sc.id}/agent`));
  const agent = policy.kind === "none" ? null : new SimAgent(policy, opt, agentRng);
  const sol0 = Number(chain.vaultSol) / 1e9;
  const tokens0 = Number(chain.vaultTokens) / 1e6;
  const startPrice = market.spot();

  const band = Number(chain.terms.bandBps) * 100;
  const prices: number[] = [];
  let inBand = 0;
  let nextSample = 0;
  const sampleUpTo = (t: number) => {
    while (nextSample <= t && nextSample < sc.durationMs) {
      prices.push(market.spot());
      const p = project(chain, BigInt(T0 + Math.floor(nextSample / 1_000)));
      const dev = Number(p.deviationPpm);
      if (dev > -band && dev < band) inBand++;
      nextSample += MINUTE_MS;
    }
  };

  for (;;) {
    const tp = flow.next();
    const ta = agent ? agent.at : Infinity;
    const t = Math.min(tp, ta);
    if (t >= sc.durationMs) break;
    sampleUpTo(t);
    market.t = t;
    if (tp <= ta) {
      if (market.slot() <= chain.lastAgentTradeSlot) flow.defer((chain.lastAgentTradeSlot + 1) * SLOT_MS);
      else flow.trade(market);
    } else {
      agent!.step(market);
    }
  }
  market.t = sc.durationMs;
  sampleUpTo(sc.durationMs);

  let peak = 0;
  let maxDrawdown = 0;
  let sumSq = 0;
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i]!;
    if (p > peak) peak = p;
    else if (1 - p / peak > maxDrawdown) maxDrawdown = 1 - p / peak;
    if (i > 0) {
      const r = Math.log(p / prices[i - 1]!);
      sum += r;
      sumSq += r * r;
    }
  }
  const n = Math.max(1, prices.length - 1);
  const finalPrice = market.spot();
  let volSol = 0;
  let volTok = 0;
  for (let m = Math.max(0, market.pubSol.length - 1_440); m < market.pubSol.length; m++) {
    volSol += market.pubSol[m]!;
    volTok += market.pubTok[m]!;
  }
  return {
    scenario: sc.id,
    tag: sc.tag,
    model: sc.model,
    policy: policy.kind,
    minutes: prices.length,
    startPrice,
    finalPrice,
    vwap24: volTok > 0 ? volSol / volTok : finalPrice,
    sol0,
    tokens0,
    sol1: Number(chain.vaultSol) / 1e9,
    tokens1: Number(chain.vaultTokens) / 1e6,
    maxDrawdown,
    volBps: Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2)) * 10_000,
    inBand: prices.length > 0 ? inBand / prices.length : 0,
    feesSol: Number(chain.feesSol) / 1e9,
    publicFails: market.publicFails,
    publicVolumeSol: market.publicVolume / 1e9,
    agent: agent ? agent.stats : null,
  };
}
