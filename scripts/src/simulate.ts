/**
 * Localnet traffic simulator: keeps the site alive with organic-looking activity through the real
 * program and the indexer's upload endpoint.
 *
 * - Trades every live launch from a pool of trader wallets: momentum chasers, mean-reverters and noise
 *   traders, log-normal sizes, and the occasional whale pump or dump (which is what makes the vault
 *   agents step in).
 * - Now and then opens a raise (generated name + SVG art uploaded to the indexer), fills it with
 *   deposits from sim backers and launches it once the minimum is met.
 * - Backers and creators claim their fees from time to time.
 *
 * Wallets live in <KEYS_DIR>/sim/ (default .localnet/sim/) and are topped up by airdrop. Refuses to
 * run unless RPC_URL points at this machine. Ctrl+C finishes the in-flight transaction and exits.
 *
 * Env (defaults): RPC_URL (http://127.0.0.1:8899), INDEXER_URL (http://127.0.0.1:8787),
 *   SIM_INTERVAL_MS (3000: mean pause between transactions), SIM_TRADERS (10), SIM_BACKERS (6),
 *   SIM_MEDIAN_TRADE_SOL (0.15), SIM_WHALE_PROB (0.04: share of trades that are whale moves),
 *   SIM_RAISE_EVERY_S (300: mean gap between new raises), SIM_MAX_RAISING (1), SIM_CLAIM_EVERY_S (90)
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Connection, LAMPORTS_PER_SOL, Keypair, PublicKey } from "@solana/web3.js";
import {
  OPEN_WHITELIST_ROOT,
  TOKEN_2022_PROGRAM_ID,
  TOTAL_SUPPLY,
  backerClaimable,
  compact,
  curveOf,
  describeError,
  fmtPrice,
  lamportsToSol,
  launchToJson,
  minOut,
  projectEma,
  quoteBuy,
  quoteSell,
  solToLamports,
  spotPrice,
  tokensToUi,
  type LaunchJson,
  type MoshClient,
  type PlatformAccount,
} from "@moshsol/sdk";
import { LOCALNET_DIR, RPC_URL, airdrop, clientFor, loadOrCreateKeypair, send } from "./common";

// ---------------------------------------------------------------- config

function envNum(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number in [${min}, ${max}], got "${raw}"`);
  return v;
}

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const INTERVAL_MS = envNum("SIM_INTERVAL_MS", 3_000, 100, 600_000);
const TRADERS = envNum("SIM_TRADERS", 10, 2, 100);
const BACKERS = envNum("SIM_BACKERS", 6, 2, 100);
const MEDIAN_TRADE_SOL = envNum("SIM_MEDIAN_TRADE_SOL", 0.15, 0.01, 100);
const WHALE_PROB = envNum("SIM_WHALE_PROB", 0.04, 0, 1);
const RAISE_EVERY_S = envNum("SIM_RAISE_EVERY_S", 300, 10, 86_400);
const MAX_RAISING = envNum("SIM_MAX_RAISING", 1, 0, 10);
const CLAIM_EVERY_S = envNum("SIM_CLAIM_EVERY_S", 90, 5, 86_400);

const SIM_DIR = path.join(LOCALNET_DIR, "sim");
const SLIPPAGE_BPS = 300;
const CREATORS = 3;
const WHALES = 2;
/** A raise stays visible (and keeps collecting deposits) for at least this long before its creator launches it. */
const MIN_RAISE_OPEN_S = 120;
/** Genesis hashes of public clusters: never spam these even through a local tunnel. */
const PUBLIC_GENESIS = new Set([
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
]);

// ---------------------------------------------------------------- randomness

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

function gauss(): number {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/** Log-normal around `median` (sigma in log space), clamped. */
function logNormal(median: number, sigma: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, median * Math.exp(sigma * gauss())));
}

/** Exponential inter-arrival time with the given mean, clamped to [mean/6, 4·mean]. */
const nextDelay = (mean: number) => Math.min(4 * mean, Math.max(mean / 6, -Math.log(1 - Math.random()) * mean));

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round = (v: number, step: number) => Math.round(v / step) * step;

// ---------------------------------------------------------------- generated launches

const ADJECTIVES = ["Turbo", "Neon", "Cosmic", "Feral", "Sleepy", "Glitch", "Quantum", "Rusty", "Velvet", "Hyper",
  "Lunar", "Pixel", "Salty", "Atomic", "Mellow", "Based", "Frosty", "Spicy", "Chonky", "Retro"];
const NOUNS = ["Otter", "Frog", "Mochi", "Walrus", "Comet", "Gecko", "Pigeon", "Noodle", "Badger", "Yeti", "Taco",
  "Moth", "Kraken", "Llama", "Squid", "Toad", "Corgi", "Panda", "Bison", "Raven", "Capy", "Shrimp"];
const TAGLINES = [
  "Backers locked the bundle forever; the vault buys every panic dip.",
  "No dev dump possible — the bundle is sealed in the vault for good.",
  "Community-funded bundle, agent-guarded curve, fees back to backers.",
  "Born on localnet, raised by degens, protected by a very patient vault.",
  "Every trade pays the backers. Every dip meets the vault.",
];

interface GeneratedMeta {
  name: string;
  symbol: string;
  description: string;
  svg: string;
}

/** Blob mascot on a gradient: a smooth random closed path with a face. Pure shapes (upload sanitizer-safe). */
function mascotSvg(symbol: string): string {
  const hue = Math.floor(rand(0, 360));
  const hue2 = (hue + Math.floor(rand(40, 140))) % 360;
  const bodyHue = (hue + 180 + Math.floor(rand(-30, 30))) % 360;
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 118 * rand(0.86, 1.14);
    return [256 + Math.cos(a) * r, 236 + Math.sin(a) * r * 0.92] as const;
  });
  const mid = (i: number) => {
    const [x1, y1] = pts[i % n]!;
    const [x2, y2] = pts[(i + 1) % n]!;
    return [(x1 + x2) / 2, (y1 + y2) / 2] as const;
  };
  let d = `M${mid(0)[0].toFixed(1)} ${mid(0)[1].toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const [cx, cy] = pts[i % n]!;
    const [mx, my] = mid(i);
    d += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const bubbles = Array.from({ length: 7 }, () => {
    const r = rand(14, 60).toFixed(0);
    return `<circle cx="${rand(20, 492).toFixed(0)}" cy="${rand(20, 400).toFixed(0)}" r="${r}" fill="#fff" fill-opacity="${rand(0.06, 0.18).toFixed(2)}"/>`;
  }).join("");
  const eyeDx = rand(34, 48);
  const eyeY = rand(206, 226);
  const eye = (x: number) =>
    `<circle cx="${x.toFixed(1)}" cy="${eyeY.toFixed(1)}" r="22" fill="#fff"/>` +
    `<circle cx="${(x + rand(-6, 6)).toFixed(1)}" cy="${(eyeY + rand(-4, 6)).toFixed(1)}" r="10" fill="#111827"/>`;
  const smileW = rand(34, 58);
  const smile = `<path d="M${(256 - smileW).toFixed(1)} 272 Q256 ${rand(300, 320).toFixed(1)} ${(256 + smileW).toFixed(1)} 272" fill="none" stroke="#111827" stroke-width="9" stroke-linecap="round"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue}, 85%, 58%)"/>
      <stop offset="1" stop-color="hsl(${hue2}, 75%, 32%)"/>
    </linearGradient>
    <radialGradient id="body" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="hsl(${bodyHue}, 95%, 78%)"/>
      <stop offset="1" stop-color="hsl(${bodyHue}, 80%, 52%)"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  ${bubbles}
  <ellipse cx="256" cy="372" rx="120" ry="16" fill="#000" fill-opacity="0.18"/>
  <path d="${d} Z" fill="url(#body)" stroke="#111827" stroke-opacity="0.25" stroke-width="6"/>
  ${eye(256 - eyeDx)}${eye(256 + eyeDx)}
  ${smile}
  <text x="256" y="462" text-anchor="middle" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="54"
    font-weight="800" letter-spacing="3" fill="#ffffff" fill-opacity="0.95">$${symbol}</text>
</svg>
`;
}

function generateMeta(takenSymbols: Set<string>): GeneratedMeta {
  for (;;) {
    const adj = pick(ADJECTIVES);
    const noun = pick(NOUNS);
    let symbol = noun.toUpperCase();
    if (takenSymbols.has(symbol)) symbol = `${adj[0]}${noun}`.toUpperCase().slice(0, 10);
    if (takenSymbols.has(symbol)) continue;
    return {
      name: `${adj} ${noun}`,
      symbol,
      description: `${adj} ${noun} (${symbol}). ${pick(TAGLINES)}`,
      svg: mascotSvg(symbol),
    };
  }
}

async function uploadMeta(meta: GeneratedMeta): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([meta.svg], { type: "image/svg+xml" }), `${meta.symbol}.svg`);
  form.append("name", meta.name);
  form.append("symbol", meta.symbol);
  form.append("description", meta.description);
  form.append("twitter", `@${meta.symbol.toLowerCase()}_sol`);
  const res = await fetch(`${INDEXER_URL}/api/upload`, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { uri?: string; error?: string };
  if (!res.ok || !body.uri) throw new Error(`upload failed: HTTP ${res.status} ${body.error ?? ""}`.trim());
  return body.uri;
}

// ---------------------------------------------------------------- market model

type Persona = "momentum" | "reverter" | "noise";
const PERSONA_WEIGHTS: Record<Persona, { momentum: number; revert: number }> = {
  momentum: { momentum: 0.9, revert: 0.1 },
  reverter: { momentum: 0.1, revert: 0.9 },
  noise: { momentum: 0.25, revert: 0.25 },
};

interface Wallet {
  label: string;
  kp: Keypair;
  persona: Persona;
}

/** Per-launch sentiment (Ornstein–Uhlenbeck), attention weight and a short price memory. */
interface MarketState {
  mood: number;
  hype: number;
  prices: number[];
}

// ---------------------------------------------------------------- simulator

interface Stats {
  buys: number;
  sells: number;
  whales: number;
  deposits: number;
  raises: number;
  launches: number;
  claims: number;
  refunds: number;
  failed: number;
}

class Simulator {
  private readonly markets = new Map<string, MarketState>();
  /** mint → symbol from the indexer (on-chain names live in token metadata); refreshed on misses. */
  private readonly symbols = new Map<string, string>();
  private symbolsAt = 0;
  private readonly stats: Stats = { buys: 0, sells: 0, whales: 0, deposits: 0, raises: 0, launches: 0, claims: 0, refunds: 0, failed: 0 };
  private nextRaiseAt = 0;
  private nextClaimAt = Date.now() + CLAIM_EVERY_S * 500;
  private agentTradesAtStart: number | null = null;
  private agentTradesNow = 0;
  private stopping = false;
  private readonly connection: Connection;

  constructor(
    private readonly client: MoshClient,
    private readonly platform: PlatformAccount,
    private readonly traders: Wallet[],
    private readonly whales: Wallet[],
    private readonly backers: Wallet[],
    private readonly creators: Wallet[],
  ) {
    this.connection = client.connection;
  }

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    const started = Date.now();
    let nextStatsAt = started + 60_000;
    let outageSince: number | null = null;
    while (!this.stopping) {
      try {
        await this.step();
        if (outageSince !== null) {
          log(`validator reachable again after ${Math.round((Date.now() - outageSince) / 1000)}s`);
          outageSince = null;
        }
      } catch (err) {
        // Only chain reads reach here (actions catch their own errors): the validator is down or restarting.
        if (outageSince === null) {
          outageSince = Date.now();
          log(`chain unreachable (${describeError(err)}); retrying`);
        }
        await sleep(5_000);
        continue;
      }
      if (Date.now() >= nextStatsAt) {
        nextStatsAt += 60_000;
        log(this.summary(started));
      }
      await sleep(nextDelay(INTERVAL_MS));
    }
    log(`stopped. ${this.summary(started)}`);
  }

  summary(started: number): string {
    const s = this.stats;
    const mins = ((Date.now() - started) / 60_000).toFixed(1);
    const agent = this.agentTradesAtStart === null ? 0 : this.agentTradesNow - this.agentTradesAtStart;
    return (
      `stats ${mins}m: ${s.buys} buys, ${s.sells} sells (${s.whales} whale), ${s.deposits} deposits, ` +
      `${s.raises} raises, ${s.launches} launches, ${s.claims} claims, ${s.refunds} refunds, ${s.failed} failed; ` +
      `agent trades since start: ${agent}`
    );
  }

  // ------------------------------------------------ one action per step

  private async step(): Promise<void> {
    const accounts = await this.client.program.account.launch.all();
    const launches = accounts.map((a) => launchToJson(a.publicKey, a.account));
    const now = Math.floor(Date.now() / 1000);
    this.agentTradesNow = launches.reduce((n, l) => n + l.agentBuys + l.agentSells, 0);
    this.agentTradesAtStart ??= this.agentTradesNow;
    if (launches.some((l) => !this.symbols.has(l.mint))) await this.refreshSymbols();

    const live = launches.filter((l) => l.status === "live");
    this.observe(live);
    const creatorKeys = new Set(this.creators.map((c) => c.kp.publicKey.toBase58()));
    const simRaises = launches.filter((l) => l.status === "raising" && creatorKeys.has(l.creator));
    const open = simRaises.filter((l) => now < l.raiseDeadline);
    const metMin = (l: LaunchJson) => BigInt(l.raised) >= BigInt(l.raiseMin);

    const ready = simRaises.find((l) => metMin(l) && now - l.createdAt >= MIN_RAISE_OPEN_S);
    if (ready && Math.random() < 0.5) return this.act("launch", () => this.launch(ready));
    const expired = simRaises.find((l) => now >= l.raiseDeadline && !metMin(l));
    if (expired) return this.act("refund", () => this.refund(expired));
    if (open.length < MAX_RAISING && Date.now() >= this.nextRaiseAt) {
      this.nextRaiseAt = Date.now() + nextDelay(RAISE_EVERY_S * 1000);
      return this.act("raise", () => this.createRaise());
    }
    const fillable = open.filter((l) => BigInt(l.raised) < BigInt(l.raiseMax));
    if (fillable.length > 0 && Math.random() < (live.length === 0 ? 0.9 : 0.2)) {
      return this.act("deposit", () => this.deposit(pick(fillable)));
    }
    if (Date.now() >= this.nextClaimAt) {
      this.nextClaimAt = Date.now() + nextDelay(CLAIM_EVERY_S * 1000);
      return this.act("claim", () => this.claim(live));
    }
    if (live.length > 0) return this.act("trade", () => this.trade(live, now));
  }

  /** Runs one transaction-sending action; failures are logged and counted, never fatal. */
  private async act(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.stats.failed++;
      log(`✗ ${what}: ${describeError(err)}`);
    }
  }

  private observe(live: LaunchJson[]): void {
    const seen = new Set<string>();
    for (const l of live) {
      seen.add(l.mint);
      let m = this.markets.get(l.mint);
      if (!m) {
        // Fresh launches draw a crowd.
        const fresh = Date.now() / 1000 - l.launchedAt < 600;
        m = { mood: fresh ? 0.8 : gauss() * 0.3, hype: fresh ? 2 : gauss() * 0.5, prices: [] };
        this.markets.set(l.mint, m);
      }
      m.mood += -0.08 * m.mood + 0.3 * gauss();
      m.hype += -0.04 * m.hype + 0.2 * gauss();
      if (m.prices.at(-1) !== l.priceSol) m.prices = [...m.prices.slice(-11), l.priceSol];
    }
    for (const mint of this.markets.keys()) if (!seen.has(mint)) this.markets.delete(mint);
  }

  // ------------------------------------------------ trading

  private async trade(live: LaunchJson[], now: number): Promise<void> {
    const weights = live.map((l) => Math.exp(this.markets.get(l.mint)!.hype));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    const l = live[Math.max(0, weights.findIndex((w) => (r -= w) <= 0))]!;
    const market = this.markets.get(l.mint)!;
    const holdings = await this.holdings(l.mint);

    if (Math.random() < WHALE_PROB) return this.whaleMove(l, holdings);

    const trader = pick(this.traders);
    const w = PERSONA_WEIGHTS[trader.persona];
    const price = l.priceSol;
    const past = market.prices.length > 1 ? market.prices[0]! : price;
    const momentum = Math.log(price / past) / 0.05;
    const ema = projectEma({ emaSol: l.emaSol, priceSol: price, lastTradeTs: l.lastTradeTs, nowSec: now, periodSecs: l.terms.emaPeriodSecs });
    const deviation = Math.log(price / ema) / 0.03;
    // Pull toward the launch price keeps prices oscillating around it instead of drifting off, so the
    // vault agents get to both sell rallies and buy dips below their cost basis.
    const anchor = Math.log(price / launchPrice(l));
    const pBuy = Math.min(0.9, Math.max(0.1, sigmoid(market.mood + w.momentum * momentum - w.revert * deviation - 0.8 * anchor)));

    const held = holdings.get(trader.kp.publicKey.toBase58()) ?? 0n;
    const sol = logNormal(MEDIAN_TRADE_SOL, 0.85, 0.02, 3);
    if (Math.random() < pBuy || held === 0n) await this.buy(l, trader, sol, "");
    else await this.sell(l, trader, tokensForSol(l, sol, held), "");
  }

  private async whaleMove(l: LaunchJson, holdings: Map<string, bigint>): Promise<void> {
    this.stats.whales++;
    const bags = this.whales
      .map((w) => ({ w, held: holdings.get(w.kp.publicKey.toBase58()) ?? 0n }))
      .filter((b) => b.held > 0n)
      .sort((a, b) => (b.held > a.held ? 1 : -1));
    // Dumps get likelier the further price ran above launch; otherwise a whale apes in.
    const runUp = l.priceSol / launchPrice(l);
    if (bags.length > 0 && Math.random() < Math.min(0.8, 0.3 + 0.25 * Math.log(runUp + 1))) {
      const { w, held } = bags[0]!;
      await this.sell(l, w, (held * BigInt(Math.round(rand(600, 1_000)))) / 1_000n, "🐋 dump ");
    } else {
      await this.buy(l, pick(this.whales), logNormal(3, 0.4, 1.5, 8), "🐋 pump ");
    }
  }

  private async buy(l: LaunchJson, who: Wallet, sol: number, tag: string): Promise<void> {
    const lamports = solToLamports(sol.toFixed(3));
    await this.ensureSol(who, lamports + 20_000_000n);
    const mint = new PublicKey(l.mint);
    const q = quoteBuy(curveOf(l), lamports, l.terms.tradeFeeBps);
    const ix = await this.client.buyIx(who.kp.publicKey, mint, lamports, minOut(q.tokensOut, SLIPPAGE_BPS));
    await send(this.client, who.kp, [ix]);
    this.stats.buys++;
    log(`${tag}buy  ${this.sym(l)} ${who.label.padEnd(9)} ${solCol(lamports)} SOL → ${fmtPrice(q.priceAfter)} (${pct(q.priceAfter, q.priceBefore)})`);
  }

  private async sell(l: LaunchJson, who: Wallet, tokens: bigint, tag: string): Promise<void> {
    if (tokens <= 0n) return;
    const q = quoteSell(curveOf(l), tokens, l.terms.tradeFeeBps);
    const ix = await this.client.sellIx(who.kp.publicKey, new PublicKey(l.mint), tokens, minOut(q.solOut, SLIPPAGE_BPS));
    await this.ensureSol(who, 10_000_000n);
    await send(this.client, who.kp, [ix]);
    this.stats.sells++;
    log(
      `${tag}sell ${this.sym(l)} ${who.label.padEnd(9)} ${solCol(q.solOut)} SOL → ${fmtPrice(q.priceAfter)} ` +
        `(${pct(q.priceAfter, q.priceBefore)}) ${compact(tokensToUi(tokens))} tokens`,
    );
  }

  /** Token balances by owner for one mint (single getProgramAccounts, like the indexer's holder list). */
  private async holdings(mint: string): Promise<Map<string, bigint>> {
    const accounts = await this.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: mint } }],
      dataSlice: { offset: 32, length: 40 },
    });
    const out = new Map<string, bigint>();
    for (const { account } of accounts) {
      if (account.data.length < 40) continue;
      const owner = new PublicKey(account.data.subarray(0, 32)).toBase58();
      out.set(owner, (out.get(owner) ?? 0n) + account.data.readBigUInt64LE(32));
    }
    return out;
  }

  private async ensureSol(who: Wallet, lamports: bigint): Promise<void> {
    const bal = BigInt(await this.connection.getBalance(who.kp.publicKey, "confirmed"));
    if (bal >= lamports) return;
    const topUp = Math.max(30, Math.ceil(lamportsToSol(lamports - bal)) + 10);
    await airdrop(this.connection, who.kp.publicKey, topUp);
    log(`airdrop ${who.label} +${topUp} SOL`);
  }

  // ------------------------------------------------ raises

  private async createRaise(): Promise<void> {
    await this.refreshSymbols();
    const meta = generateMeta(new Set(this.symbols.values()));
    const uri = await uploadMeta(meta);
    const creator = pick(this.creators);
    const p = this.platform.params;
    const minSol = Math.max(lamportsToSol(p.minRaiseLamports.toString()), round(rand(2, 7), 0.5));
    const maxSol = round(minSol * rand(1.5, 3), 0.5);
    const mint = Keypair.generate();
    const ix = await this.client.createLaunchIx({
      creator: creator.kp.publicKey,
      mint: mint.publicKey,
      feeRecipient: this.platform.feeRecipient,
      name: meta.name,
      symbol: meta.symbol,
      uri,
      raiseMin: solToLamports(minSol),
      raiseMax: solToLamports(maxSol),
      maxPerWallet: 0n,
      durationSecs: Math.round(rand(2, 6)) * 3_600,
      whitelistRoot: OPEN_WHITELIST_ROOT,
      bundleSupplyBps: Math.min(p.maxBundleSupplyBps, round(rand(1_000, 2_500), 250)),
      reserveBps: round(rand(2_500, 5_000), 500),
    });
    await this.ensureSol(creator, 200_000_000n);
    await send(this.client, creator.kp, [ix], [mint], 400_000);
    this.symbols.set(mint.publicKey.toBase58(), meta.symbol);
    this.stats.raises++;
    log(`✨ raise ${meta.symbol} "${meta.name}" by ${creator.label}: min ${minSol} / max ${maxSol} SOL, mint ${mint.publicKey.toBase58()}`);
  }

  /** Pulls symbols from the indexer, at most every 10s (it serves them from token metadata). */
  private async refreshSymbols(): Promise<void> {
    if (Date.now() - this.symbolsAt < 10_000) return;
    this.symbolsAt = Date.now();
    const res = await fetch(`${INDEXER_URL}/api/launches?status=all&limit=200`).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { launches: { mint: string; symbol: string }[] };
    for (const x of body.launches) if (x.symbol) this.symbols.set(x.mint, x.symbol.toUpperCase());
  }

  private sym(l: LaunchJson): string {
    return (this.symbols.get(l.mint) ?? `${l.mint.slice(0, 5)}…`).padEnd(8);
  }

  private async deposit(l: LaunchJson): Promise<void> {
    const backer = pick(this.backers);
    const remaining = lamportsToSol(BigInt(l.raiseMax) - BigInt(l.raised));
    const minSol = lamportsToSol(l.raiseMin);
    const sol = Math.min(remaining, logNormal(0.8, 0.7, 0.1, minSol * 0.6));
    const lamports = solToLamports(sol.toFixed(3));
    if (lamports <= 0n) return;
    await this.ensureSol(backer, lamports + 20_000_000n);
    const ix = await this.client.depositIx(backer.kp.publicKey, new PublicKey(l.mint), lamports);
    await send(this.client, backer.kp, [ix]);
    this.stats.deposits++;
    const raised = lamportsToSol(BigInt(l.raised) + lamports);
    log(`deposit ${this.sym(l)} ${backer.label.padEnd(9)} ${solCol(lamports)} SOL raised ${raised.toFixed(2)} / min ${minSol}`);
  }

  private async launch(l: LaunchJson): Promise<void> {
    const creator = this.creators.find((c) => c.kp.publicKey.toBase58() === l.creator)!;
    await send(this.client, creator.kp, [await this.client.launchIx(creator.kp.publicKey, new PublicKey(l.mint))]);
    this.stats.launches++;
    log(`🚀 launch ${this.sym(l)} raised ${lamportsToSol(l.raised).toFixed(2)} SOL from ${l.backerCount} backers`);
  }

  private async refund(l: LaunchJson): Promise<void> {
    const mint = new PublicKey(l.mint);
    for (const b of this.backers) {
      if (!(await this.client.fetchBacker(mint, b.kp.publicKey))) continue;
      await send(this.client, b.kp, [await this.client.refundIx(b.kp.publicKey, mint)]);
      this.stats.refunds++;
      log(`refund ${this.sym(l)} ${b.label} (raise expired below minimum)`);
      return;
    }
  }

  // ------------------------------------------------ fee claims

  private async claim(live: LaunchJson[]): Promise<void> {
    const byAddress = new Map(live.map((l) => [l.address, l]));
    if (Math.random() < 0.6) {
      for (const backer of [...this.backers].sort(() => Math.random() - 0.5)) {
        for (const { account } of await this.client.fetchBackersOf(backer.kp.publicKey)) {
          const l = byAddress.get(account.launch.toBase58());
          if (!l) continue;
          const claimable = backerClaimable(
            BigInt(account.deposited.toString()),
            BigInt(l.accFeePerShare),
            BigInt(account.feesClaimed.toString()),
          );
          if (claimable < 1_000_000n) continue;
          await send(this.client, backer.kp, [await this.client.claimBackerFeesIx(backer.kp.publicKey, new PublicKey(l.mint))]);
          this.stats.claims++;
          log(`💸 claim ${this.sym(l)} ${backer.label.padEnd(9)} ${solCol(claimable)} SOL backer fees`);
          return;
        }
      }
    }
    for (const creator of this.creators) {
      const l = live.find((x) => x.creator === creator.kp.publicKey.toBase58() && BigInt(x.creatorFeesUnclaimed) >= 2_000_000n);
      if (!l) continue;
      await send(this.client, creator.kp, [await this.client.claimCreatorFeesIx(creator.kp.publicKey, new PublicKey(l.mint))]);
      this.stats.claims++;
      log(`💸 claim ${this.sym(l)} ${creator.label.padEnd(9)} ${solCol(BigInt(l.creatorFeesUnclaimed))} SOL creator fees`);
      return;
    }
  }
}

// ---------------------------------------------------------------- helpers

/** Post-bundle spot price: the bundle is the curve's first buy. */
function launchPrice(l: LaunchJson): number {
  return spotPrice({ virtualSol: BigInt(l.virtualSol), realSol: BigInt(l.bundleSol), tokenReserve: TOTAL_SUPPLY - BigInt(l.bundleTokens) });
}

/** Tokens to sell for about `sol` net (curve inverse incl. fee); the whole bag when that is most of it. */
function tokensForSol(l: LaunchJson, sol: number, held: bigint): bigint {
  const c = curveOf(l);
  const x = Number(c.virtualSol + c.realSol) / 1e9;
  const gross = sol / (1 - l.terms.tradeFeeBps / 10_000);
  if (gross >= x * 0.9) return held;
  const want = BigInt(Math.floor((gross * Number(c.tokenReserve)) / (x - gross)));
  return want * 100n >= held * 85n ? held : want;
}

const solCol = (lamports: bigint) => lamportsToSol(lamports).toFixed(3).padStart(7);
const pct = (after: number, before: number) => `${after >= before ? "+" : "−"}${(Math.abs(after / before - 1) * 100).toFixed(1)}%`;

function log(line: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
}

function assertLocal(rpc: string): void {
  const host = new URL(rpc).hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host)) {
    throw new Error(`refusing to simulate traffic against ${rpc}: RPC_URL must point at a local validator`);
  }
}

function wallets(prefix: string, count: number, personaOf: (i: number) => Persona): Wallet[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `${prefix}-${i + 1}`,
    kp: loadOrCreateKeypair(`sim/${prefix}-${i + 1}`),
    persona: personaOf(i),
  }));
}

async function main(): Promise<void> {
  assertLocal(RPC_URL);
  const connection = new Connection(RPC_URL, "confirmed");
  const genesis = await connection.getGenesisHash().catch((err: unknown) => {
    throw new Error(`validator not reachable at ${RPC_URL} (${describeError(err)}); start it with \`pnpm localnet\``);
  });
  if (PUBLIC_GENESIS.has(genesis)) throw new Error(`refusing to simulate traffic: ${RPC_URL} serves a public cluster`);

  fs.mkdirSync(SIM_DIR, { recursive: true });
  const personas: Persona[] = ["momentum", "reverter", "noise"];
  const traders = wallets("trader", TRADERS, (i) => personas[i % 3]!);
  const whales = wallets("whale", WHALES, () => "noise");
  const backers = wallets("backer", BACKERS, () => "noise");
  const creators = wallets("creator", CREATORS, () => "noise");

  const client = clientFor(connection, creators[0]!.kp);
  const platform = await client.fetchPlatform();
  if (!platform) throw new Error("platform not initialized — run `pnpm setup:localnet` first");
  const health = await fetch(`${INDEXER_URL}/api/health`).catch(() => null);
  if (!health) log(`indexer not reachable at ${INDEXER_URL}: new raises will fail until it is up (trading continues)`);

  log(`funding ${traders.length + whales.length + backers.length + creators.length} sim wallets in ${path.relative(process.cwd(), SIM_DIR) || SIM_DIR}…`);
  const fund = async (w: Wallet, min: number) => {
    const bal = await connection.getBalance(w.kp.publicKey, "confirmed");
    if (bal < min * LAMPORTS_PER_SOL) await airdrop(connection, w.kp.publicKey, min * 2 - bal / LAMPORTS_PER_SOL);
  };
  await Promise.all([
    ...traders.map((w) => fund(w, 25)),
    ...whales.map((w) => fund(w, 100)),
    ...backers.map((w) => fund(w, 20)),
    ...creators.map((w) => fund(w, 2)),
  ]);

  const sim = new Simulator(client, platform, traders, whales, backers, creators);
  let signals = 0;
  const onSignal = () => {
    signals += 1;
    if (signals > 1) process.exit(130);
    log("stopping after the in-flight transaction (Ctrl+C again to force)…");
    sim.stop();
  };
  // SIGBREAK: Ctrl+Break on Windows consoles.
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(signal, onSignal);

  log(
    `simulating on ${RPC_URL}: ~${(10_000 / INTERVAL_MS).toFixed(1)} tx/10s, ${traders.length} traders, ` +
      `whale prob ${WHALE_PROB}, new raise every ~${RAISE_EVERY_S}s (max ${MAX_RAISING} open)`,
  );
  await sim.run();
  // web3's websocket (used for confirmations) would otherwise keep the process alive.
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
