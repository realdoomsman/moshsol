/**
 * Seeds a localnet with realistic demo data through the real program and the indexer's upload
 * endpoint: 2 raising launches (one whitelisted), 3 live launches with a few minutes of public
 * trading, and 1 cancelled launch with a refund. Every run creates new launches; wallets are
 * reused from `.localnet/seed/` and topped up by airdrop.
 *
 * Env: RPC_URL (default http://127.0.0.1:8899), INDEXER_URL (default http://127.0.0.1:8787),
 *      SEED_TRADE_SECS (default 150) — wall time of the trading phase.
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  OPEN_WHITELIST_ROOT,
  buildWhitelist,
  curveOf,
  describeError,
  fmtPrice,
  lamportsToSol,
  minOut,
  quoteBuy,
  quoteSell,
  solToLamports,
  tokenAta,
  type LaunchAccount,
  type MoshClient,
  type Whitelist,
} from "@holdfast/sdk";
import { LOCALNET_DIR, RPC_URL, airdrop, clientFor, loadOrCreateKeypair, send } from "./common";

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const TRADE_SECS = Number(process.env.SEED_TRADE_SECS ?? 150);
const ROUND_PAUSE_MS = 5_000;
const SLIPPAGE_BPS = 200;
const SEED_DIR = path.join(LOCALNET_DIR, "seed");

// ---------------------------------------------------------------- logos

interface Design {
  from: string;
  to: string;
  glyph: string;
}

function logoSvg(symbol: string, d: Design): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${d.from}"/>
      <stop offset="1" stop-color="${d.to}"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.28" cy="0.2" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/>
      <stop offset="0.6" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.18"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#sheen)"/>
  ${d.glyph}
  <text x="256" y="456" text-anchor="middle" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="58"
    font-weight="800" letter-spacing="3" fill="#ffffff" fill-opacity="0.94">$${symbol}</text>
</svg>
`;
}

const bolt = "M290 52 L148 250 H244 L214 384 L366 176 H264 Z";
const sunRays = Array.from(
  { length: 12 },
  (_, i) => `<rect x="247" y="58" width="18" height="52" rx="9" fill="#fff" transform="rotate(${i * 30} 256 210)"/>`,
).join("");
const PUP_ROWS = ["XX......XX", "XXX....XXX", "XXXXXXXXXX", "XXeXXXXeXX", "XXXXXXXXXX", "XXXXnnXXXX", "XXXXXXXXXX", ".XXXttXXX.", "..XXttXX.."];
const PUP_COLORS: Record<string, string> = { X: "#ffffff", e: "#1e1b4b", n: "#1e1b4b", t: "#fb7185" };
const pupPixels = PUP_ROWS.flatMap((row, y) =>
  [...row].map((c, x) =>
    PUP_COLORS[c] ? `<rect x="${126 + x * 26}" y="${76 + y * 26}" width="26" height="26" fill="${PUP_COLORS[c]}"/>` : "",
  ),
).join("");

const DESIGNS: Record<string, Design> = {
  MOSH: {
    from: "#ff2d95",
    to: "#ff8a00",
    glyph: `<path d="${bolt}" fill="#000" fill-opacity="0.2" transform="translate(10 12)"/><path d="${bolt}" fill="#fff"/>`,
  },
  KOI: {
    from: "#06b6d4",
    to: "#4338ca",
    glyph: `<circle cx="256" cy="212" r="160" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="10"/>
  <circle cx="256" cy="212" r="120" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="8"/>
  <path d="M136 212 C 182 132, 300 124, 352 212 C 300 300, 182 292, 136 212 Z" fill="#fff"/>
  <path d="M342 212 L408 156 L392 212 L408 268 Z" fill="#fff"/>
  <path d="M232 160 C 262 184, 262 240, 232 264" stroke="#f97316" stroke-width="18" fill="none" stroke-linecap="round"/>
  <path d="M290 176 C 304 196, 304 228, 290 248" stroke="#ef4444" stroke-width="12" fill="none" stroke-linecap="round"/>
  <circle cx="184" cy="198" r="11" fill="#1e1b4b"/>`,
  },
  FLARE: {
    from: "#facc15",
    to: "#dc2626",
    glyph: `${sunRays}<circle cx="256" cy="210" r="84" fill="#fff"/>
  <circle cx="256" cy="210" r="60" fill="#fde047" fill-opacity="0.55"/>`,
  },
  LFROG: {
    from: "#84cc16",
    to: "#047857",
    glyph: `<circle cx="178" cy="146" r="54" fill="#ecfccb"/><circle cx="334" cy="146" r="54" fill="#ecfccb"/>
  <ellipse cx="256" cy="248" rx="156" ry="112" fill="#ecfccb"/>
  <circle cx="178" cy="146" r="31" fill="#14532d"/><circle cx="334" cy="146" r="31" fill="#14532d"/>
  <circle cx="189" cy="135" r="10" fill="#fff"/><circle cx="345" cy="135" r="10" fill="#fff"/>
  <circle cx="160" cy="262" r="20" fill="#f9a8d4" fill-opacity="0.85"/><circle cx="352" cy="262" r="20" fill="#f9a8d4" fill-opacity="0.85"/>
  <path d="M184 262 Q256 330 328 262" stroke="#14532d" stroke-width="14" fill="none" stroke-linecap="round"/>`,
  },
  PUP: {
    from: "#38bdf8",
    to: "#7c3aed",
    glyph: `<g transform="translate(8 10)" opacity="0.22">${pupPixels.replaceAll("#ffffff", "#000000")}</g>${pupPixels}`,
  },
  VCAT: {
    from: "#f472b6",
    to: "#6d28d9",
    glyph: `<circle cx="256" cy="214" r="150" fill="#fde68a" fill-opacity="0.22"/>
  <path d="M142 156 L170 56 L240 118 Z" fill="#fff"/><path d="M370 156 L342 56 L272 118 Z" fill="#fff"/>
  <path d="M166 142 L178 92 L214 124 Z" fill="#f9a8d4"/><path d="M346 142 L334 92 L298 124 Z" fill="#f9a8d4"/>
  <ellipse cx="256" cy="220" rx="134" ry="116" fill="#fff"/>
  <path d="M192 206 Q214 182 236 206" stroke="#581c87" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M276 206 Q298 182 320 206" stroke="#581c87" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M244 240 H268 L256 254 Z" fill="#ec4899"/>
  <path d="M226 266 Q256 290 286 266" stroke="#581c87" stroke-width="10" fill="none" stroke-linecap="round"/>
  <path d="M120 236 L196 244 M120 266 L196 258 M392 236 L316 244 M392 266 L316 258" stroke="#581c87" stroke-opacity="0.6" stroke-width="6" stroke-linecap="round"/>`,
  },
};

// ---------------------------------------------------------------- plans

type Kind = "raising" | "whitelist" | "live" | "cancelled";

interface Plan {
  /** Also the key of its logo in DESIGNS. */
  symbol: string;
  name: string;
  description: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  kind: Kind;
  creator: number;
  raiseMin: number;
  raiseMax: number;
  maxPerWallet: number;
  durationSecs: number;
  bundleSupplyBps: number;
  reserveBps: number;
  /** [backer index, SOL] */
  deposits: [number, number][];
  /** Probability that a trade is a buy, by trading-phase progress 0..1. */
  buyBias?: (progress: number) => number;
}

const DAY = 86_400;

const PLANS: Plan[] = [
  {
    symbol: "MOSH",
    name: "Moshpit",
    description: "The flagship pit. Backers bought a 20% bundle first; agents trade it only on dips and rallies, and backers keep the profit.",
    twitter: "@moshpit_sol",
    telegram: "https://t.me/moshpit_sol",
    website: "https://moshpit.example",
    kind: "live",
    creator: 1,
    raiseMin: 10,
    raiseMax: 60,
    maxPerWallet: 0,
    durationSecs: 2 * DAY,
    bundleSupplyBps: 2_000,
    reserveBps: 3_000,
    deposits: [
      [1, 15],
      [2, 12],
      [3, 8],
      [4, 6],
    ],
    buyBias: () => 0.72,
  },
  {
    symbol: "KOI",
    name: "Neon Koi",
    description: "Slow water, deep vault. A koi that swims against every panic sell.",
    twitter: "@neonkoi",
    website: "https://neonkoi.example",
    kind: "live",
    creator: 2,
    raiseMin: 5,
    raiseMax: 30,
    maxPerWallet: 0,
    durationSecs: 2 * DAY,
    bundleSupplyBps: 1_500,
    reserveBps: 4_000,
    deposits: [
      [2, 10],
      [5, 7],
      [6, 5],
    ],
    buyBias: () => 0.5,
  },
  {
    symbol: "FLARE",
    name: "Solar Flare",
    description: "Burns bright, cools off, burns again. Max bundle, thin reserve.",
    telegram: "@solarflare_pit",
    kind: "live",
    creator: 3,
    raiseMin: 3,
    raiseMax: 25,
    maxPerWallet: 0,
    durationSecs: 2 * DAY,
    bundleSupplyBps: 2_500,
    reserveBps: 2_000,
    deposits: [
      [1, 6],
      [3, 4],
      [4, 5],
      [6, 3],
    ],
    buyBias: (p) => (p < 0.55 ? 0.82 : 0.28),
  },
  {
    symbol: "LFROG",
    name: "Lunar Frog",
    description: "A frog that jumped to the moon and decided to stay. Raise open to everyone.",
    twitter: "@lunarfrog",
    website: "https://lunarfrog.example",
    kind: "raising",
    creator: 1,
    raiseMin: 20,
    raiseMax: 80,
    maxPerWallet: 0,
    durationSecs: 3 * DAY,
    bundleSupplyBps: 2_000,
    reserveBps: 3_500,
    deposits: [
      [2, 4],
      [5, 3.5],
      [1, 2],
    ],
  },
  {
    symbol: "PUP",
    name: "Pixel Pup",
    description: "8-bit good boy. Whitelisted raise for early pixel pals, 10 SOL max per wallet.",
    twitter: "@pixelpup",
    kind: "whitelist",
    creator: 2,
    raiseMin: 8,
    raiseMax: 40,
    maxPerWallet: 10,
    durationSecs: 2 * DAY,
    bundleSupplyBps: 1_800,
    reserveBps: 3_000,
    deposits: [
      [3, 5],
      [4, 3],
      [6, 12],
    ],
  },
  {
    symbol: "VCAT",
    name: "Vapor Cat",
    description: "Aesthetic cat that vanished before launch. Creator cancelled; every backer can refund in full.",
    website: "https://vaporcat.example",
    kind: "cancelled",
    creator: 3,
    raiseMin: 15,
    raiseMax: 50,
    maxPerWallet: 0,
    durationSecs: DAY,
    bundleSupplyBps: 1_500,
    reserveBps: 3_000,
    deposits: [
      [5, 3],
      [2, 2],
    ],
  },
];

// ---------------------------------------------------------------- helpers

async function topUp(connection: Connection, kp: Keypair, minSol: number): Promise<void> {
  const bal = await connection.getBalance(kp.publicKey, "confirmed");
  if (bal < minSol * LAMPORTS_PER_SOL) await airdrop(connection, kp.publicKey, minSol * 2 - bal / LAMPORTS_PER_SOL);
}

async function upload(plan: Plan, whitelist: string[] | null): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([logoSvg(plan.symbol, DESIGNS[plan.symbol]!)], { type: "image/svg+xml" }), `${plan.symbol}.svg`);
  form.append("name", plan.name);
  form.append("symbol", plan.symbol);
  form.append("description", plan.description);
  if (plan.twitter) form.append("twitter", plan.twitter);
  if (plan.telegram) form.append("telegram", plan.telegram);
  if (plan.website) form.append("website", plan.website);
  if (whitelist) form.append("whitelist", JSON.stringify(whitelist));
  const res = await fetch(`${INDEXER_URL}/api/upload`, { method: "POST", body: form });
  const body = (await res.json()) as { uri?: string; error?: string };
  if (!res.ok || !body.uri) throw new Error(`upload ${plan.symbol} failed: ${res.status} ${body.error ?? ""}`);
  return body.uri;
}

async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const ata = tokenAta(owner, mint);
  if (!(await connection.getAccountInfo(ata, "confirmed"))) return 0n;
  return BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
}

/** Mostly small buys with the occasional whale: 0.15 – ~4 SOL. */
const buySize = () => Math.round((0.15 + Math.random() ** 2 * 3.8) * 1_000) / 1_000;

// ---------------------------------------------------------------- main

interface Created {
  plan: Plan;
  mint: PublicKey;
}

async function main(): Promise<void> {
  const health = await fetch(`${INDEXER_URL}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`indexer not reachable at ${INDEXER_URL} (start it first: pnpm dev:indexer)`);

  fs.mkdirSync(SEED_DIR, { recursive: true });
  const connection = new Connection(RPC_URL, "confirmed");
  const creators = [1, 2, 3].map((i) => loadOrCreateKeypair(`seed/creator-${i}`));
  const backers = [1, 2, 3, 4, 5, 6].map((i) => loadOrCreateKeypair(`seed/backer-${i}`));
  const traders = [1, 2, 3, 4, 5].map((i) => loadOrCreateKeypair(`seed/trader-${i}`));

  console.log("funding seed wallets…");
  await Promise.all([
    ...creators.map((kp) => topUp(connection, kp, 10)),
    ...backers.map((kp) => topUp(connection, kp, 60)),
    ...traders.map((kp) => topUp(connection, kp, 60)),
  ]);

  const client: MoshClient = clientFor(connection, creators[0]!);
  const platform = await client.fetchPlatform();
  if (!platform) throw new Error("platform not initialized — run `pnpm setup:localnet` first");

  const creatorOf = (p: Plan) => creators[p.creator - 1]!;
  const backerOf = (i: number) => backers[i - 1]!;
  const created: Created[] = [];

  for (const plan of PLANS) {
    const creator = creatorOf(plan);
    let whitelist: Whitelist | null = null;
    if (plan.kind === "whitelist") {
      const outsiders = Array.from({ length: 4 }, () => Keypair.generate().publicKey);
      whitelist = buildWhitelist([...[3, 4, 6, 1].map((i) => backerOf(i).publicKey), ...outsiders]);
    }
    const uri = await upload(plan, whitelist?.members ?? null);
    const mint = Keypair.generate();
    const createIx = await client.createLaunchIx({
      creator: creator.publicKey,
      mint: mint.publicKey,
      feeRecipient: platform.feeRecipient,
      name: plan.name,
      symbol: plan.symbol,
      uri,
      raiseMin: solToLamports(plan.raiseMin),
      raiseMax: solToLamports(plan.raiseMax),
      maxPerWallet: solToLamports(plan.maxPerWallet),
      durationSecs: plan.durationSecs,
      whitelistRoot: whitelist?.root ?? OPEN_WHITELIST_ROOT,
      bundleSupplyBps: plan.bundleSupplyBps,
      reserveBps: plan.reserveBps,
      terms: platform.params,
    });
    await send(client, creator, [createIx], [mint]);
    console.log(`created ${plan.symbol.padEnd(5)} ${mint.publicKey.toBase58()} (${plan.kind})`);

    for (const [i, amount] of plan.deposits) {
      const backer = backerOf(i);
      const proof = whitelist ? whitelist.proof(backer.publicKey) : [];
      if (proof === null) throw new Error(`backer-${i} is not on the ${plan.symbol} whitelist`);
      const ix = await client.depositIx(backer.publicKey, mint.publicKey, solToLamports(amount), proof);
      await send(client, backer, [ix]);
      console.log(`  backer-${i} deposited ${amount} SOL`);
    }

    if (plan.kind === "live") {
      await send(client, creator, [await client.launchIx(creator.publicKey, mint.publicKey)]);
      const l = (await client.fetchLaunch(mint.publicKey))!;
      console.log(
        `  launched: bundle ${lamportsToSol(l.bundleSol.toString())} SOL → vault ${lamportsToSol(l.vaultSol.toString())} SOL`,
      );
    } else if (plan.kind === "cancelled") {
      await send(client, creator, [await client.cancelLaunchIx(creator.publicKey, mint.publicKey)]);
      const [first] = plan.deposits[0]!;
      await send(client, backerOf(first), [await client.refundIx(backerOf(first).publicKey, mint.publicKey)]);
      console.log(`  cancelled; backer-${first} refunded`);
    }
    created.push({ plan, mint: mint.publicKey });
  }

  // ------------------------------------------------ trading phase
  const live = created.filter((c) => c.plan.kind === "live");
  const started = Date.now();
  const deadline = started + TRADE_SECS * 1_000;
  let trades = 0;
  let failures = 0;
  console.log(`trading for ${TRADE_SECS}s across ${live.map((c) => c.plan.symbol).join(", ")}…`);

  const trade = async (c: Created, trader: Keypair, wantBuy: boolean) => {
    const l: LaunchAccount = (await client.fetchLaunch(c.mint))!;
    const feeBps = l.terms.tradeFeeBps;
    const held = await tokenBalance(connection, trader.publicKey, c.mint);
    const who = `trader-${traders.indexOf(trader) + 1}`;
    if (wantBuy || held === 0n) {
      const amount = buySize();
      const lamports = solToLamports(amount);
      const q = quoteBuy(curveOf(l), lamports, feeBps);
      const ix = await client.buyIx(trader.publicKey, c.mint, lamports, minOut(q.tokensOut, SLIPPAGE_BPS));
      await send(client, trader, [ix]);
      console.log(`  ${c.plan.symbol.padEnd(5)} ${who} buy  ${amount.toFixed(3)} SOL → price ${fmtPrice(q.priceAfter)}`);
    } else {
      const pct = 20 + Math.floor(Math.random() * 60);
      const tokens = (held * BigInt(pct)) / 100n;
      const q = quoteSell(curveOf(l), tokens, feeBps);
      await send(client, trader, [await client.sellIx(trader.publicKey, c.mint, tokens, minOut(q.solOut, SLIPPAGE_BPS))]);
      console.log(
        `  ${c.plan.symbol.padEnd(5)} ${who} sell ${pct}% → ${lamportsToSol(q.solOut).toFixed(3)} SOL, price ${fmtPrice(q.priceAfter)}`,
      );
    }
    trades++;
  };

  while (Date.now() < deadline) {
    const progress = (Date.now() - started) / (deadline - started);
    for (const c of live) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        try {
          const trader = traders[Math.floor(Math.random() * traders.length)]!;
          await trade(c, trader, Math.random() < c.plan.buyBias!(progress));
        } catch (err) {
          failures++;
          console.warn(`  ${c.plan.symbol} trade failed: ${describeError(err)}`);
        }
      }
    }
    await sleep(ROUND_PAUSE_MS);
  }

  // ------------------------------------------------ fee claims
  const mosh = live[0]!;
  await send(client, backerOf(1), [await client.claimBackerFeesIx(backerOf(1).publicKey, mosh.mint)]);
  await send(client, creatorOf(mosh.plan), [await client.claimCreatorFeesIx(creatorOf(mosh.plan).publicKey, mosh.mint)]);
  console.log(`claimed backer-1 + creator fees on ${mosh.plan.symbol}`);

  const summary = {
    ranAt: new Date().toISOString(),
    indexer: INDEXER_URL,
    launches: Object.fromEntries(created.map((c) => [c.plan.symbol, { mint: c.mint.toBase58(), kind: c.plan.kind }])),
    wallets: {
      creators: creators.map((k) => k.publicKey.toBase58()),
      backers: backers.map((k) => k.publicKey.toBase58()),
      traders: traders.map((k) => k.publicKey.toBase58()),
    },
  };
  fs.writeFileSync(path.join(SEED_DIR, "last-seed.json"), JSON.stringify(summary, null, 2));
  console.log(`done: ${created.length} launches, ${trades} trades (${failures} failed). Summary: .localnet/seed/last-seed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
