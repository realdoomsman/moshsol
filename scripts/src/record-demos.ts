/**
 * On-chain setup for the four landing/docs product loops (design brief §3.9):
 * `back-a-raise`, `the-lock`, `agent-defends`, `claim`. Every step sends real transactions to the
 * local validator through the SDK; nothing is mocked. The screen capture itself is driven from a
 * headless Chrome (see "Recording procedure" below) because this repo has no Puppeteer dependency.
 *
 *   pnpm --filter @holdfast/scripts record:demos <step> [mint] [--flag value]
 *
 * Steps (mints are remembered in `.localnet/demo/state.json`; pass a mint to target another launch):
 *   burner                     create/load the test wallet `.localnet/demo/burner.json`, fund it, and print the
 *                              localStorage line that makes the web app's Burner wallet use it
 *   back-a-raise [--name N --symbol S]
 *                              open raise (default Tidepool/TIDE; script creator, min 2 / max 10 SOL, 1 day) with
 *                              1.25 SOL of backing from two script backers
 *   the-lock [--name N --symbol S]
 *                              raise (default Anchorage/ANCR) created BY THE BURNER (min 2 / max 10 SOL); the burner
 *                              backs 1 SOL and script backers push it past the minimum, so its page shows "Launch now"
 *   trades [mint] [--rounds n] public buys/sells from script traders so backer + creator fees accrue (default mint:
 *                              the last the-lock raise)
 *   defend-prep [mint] [--sol n]  a script whale buys a position, then the script traders sell out
 *   defend-dump [mint] [--dry] dumps just enough of the whale's tokens that the agent's own `evaluate()` plans an
 *                              `agent_buy` (spot > band below EMA and at/below vault cost or avg agent sell × (1 − band)),
 *                              then waits for the agent's buy to land and prints it; `--dry` only predicts
 *   status [mint]              curve, EMA/band, agent budgets and the burner's claimable fees
 *
 * Recording procedure (what produced apps/web/public/videos/*; the -m cuts repeat it at 390×844, DPR 2, touch):
 *   1. `pnpm --filter @holdfast/web build`, then in apps/web `pnpm exec next start -p 3310` (default env = localnet).
 *   2. `record:demos burner`; open a dedicated headless Chrome (`--headless=new`, own `--user-data-dir`,
 *      `--force-device-scale-factor=2`) at 1600×1000 CSS px, DPR 2, on http://localhost:3310, run the printed
 *      `localStorage.setItem(…)` line, reload, and connect "Test wallet" from the header Connect button.
 *      Capture with CDP `Page.startScreencast` (jpeg, maxWidth 3200 / maxHeight 4000) and assemble the frames with
 *      their timestamps (ffconcat durations) so idle stretches keep real time.
 *   3. back-a-raise: `record:demos back-a-raise` → open `/launch/<mint>`; start; type 0.5 in the back amount,
 *      click "Back with 0.5 SOL", wait until the progress bar, backer count and "What you get" update; stop.
 *   4. the-lock: `record:demos the-lock` → set the viewport to 1600×1700 (the vault card sits below the fold)
 *      and open `/launch/<mint>`; start; click "Launch now"; keep recording ~8 s. Cut: the click (top 1600×1000),
 *      the vault card as its clamp closes (zoomed crop), then the live page with the unlocked trade panel.
 *   5. `record:demos trades --rounds 24` (fees accrue), `record:demos defend-prep`, then wait until the agent has
 *      sold into the rally and `defend-dump --dry` predicts a buy (a few minutes; its buy window must have room).
 *      agent-defends: 1600×1900 viewport on `/launch/<mint>`; start; run `record:demos defend-dump`; keep
 *      recording until the agent's up-marker, the "Agent buy" row and "Bought" in the vault card appear (the
 *      agent's 15 s cooldown after its own last trade may delay it); stop. Cut the wait; crop chart+trades, then
 *      the vault card.
 *   6. claim: open `/portfolio`; start; run `record:demos trades <mint> --rounds 1` so the claimable ticks up;
 *      click "Claim all · …"; wait for the "Claimed …" toast with its explorer link and the claimable reset; stop.
 *   7. Trim/crop/encode each capture with ffmpeg (1280×800 H.264 MP4 ≤ 1.5 MB, VP9 WebM ≤ 1.2 MB, JPG poster
 *      ≤ 120 KB; -m cuts 780 px wide) and update `apps/web/public/videos/manifest.json` (cluster, recordedAt,
 *      durationSec), which the landing caption reads.
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  OPEN_WHITELIST_ROOT,
  backerClaimable,
  curveOf,
  describeError,
  fmtPrice,
  lamportsToSol,
  minOut,
  q64ToSolPerToken,
  spotPrice,
  quoteBuy,
  quoteSell,
  solOut,
  solToLamports,
  tokenAta,
  type LaunchAccount,
  type MoshClient,
} from "@holdfast/sdk";
import { NEUTRAL_FLOW } from "../../apps/agent/src/flow";
import { DEFAULT_PARAMS, evaluate, isqrt, marketOf, type Sizing } from "../../apps/agent/src/strategy";
import { LOCALNET_DIR, RPC_URL, airdrop, clientFor, loadOrCreateKeypair, send } from "./common";

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const DEMO_DIR = path.join(LOCALNET_DIR, "demo");
const STATE_FILE = path.join(DEMO_DIR, "state.json");
const DAY = 86_400;
const SLIPPAGE_BPS = 300;
/** The vault agent's default sizing and policy (apps/agent/src/config.ts), used to predict its next decision. */
const AGENT_SIZING: Sizing = { minTradeLamports: 10_000_000n, slippageBps: 100 };
/** Extra depth below the agent's trigger so EMA drift during the next ticks can't cancel the buy. */
const DUMP_EXTRA_BPS = 120n;
/** The agent's decision on `l` at `now` (flow features neutral: the demo dumps into a quiet market, no flow gate fires). */
function predict(l: LaunchAccount, now: bigint) {
  return evaluate(marketOf(l), AGENT_SIZING, now, DEFAULT_PARAMS, NEUTRAL_FLOW);
}

interface State {
  backARaise?: string;
  theLock?: string;
}

/** Loaded or created on first use under `.localnet/demo/`. */
const key = (name: string) => loadOrCreateKeypair(`demo/${name}`);

async function topUp(connection: Connection, kp: Keypair, minSol: number): Promise<void> {
  const bal = await connection.getBalance(kp.publicKey, "confirmed");
  if (bal < minSol * LAMPORTS_PER_SOL) await airdrop(connection, kp.publicKey, minSol * 2 - bal / LAMPORTS_PER_SOL);
}

async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const ata = tokenAta(owner, mint);
  if (!(await connection.getAccountInfo(ata, "confirmed"))) return 0n;
  return BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
}

function logoSvg(symbol: string, bg: string, fg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${bg}"/><text x="256" y="300" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="700" fill="${fg}" text-anchor="middle">${symbol.slice(0, 3)}</text></svg>`;
}

async function upload(meta: { name: string; symbol: string; description: string; bg: string; fg: string }): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([logoSvg(meta.symbol, meta.bg, meta.fg)], { type: "image/svg+xml" }), `${meta.symbol}.svg`);
  form.append("name", meta.name);
  form.append("symbol", meta.symbol);
  form.append("description", meta.description);
  const res = await fetch(`${INDEXER_URL}/api/upload`, { method: "POST", body: form });
  const body = (await res.json()) as { uri?: string; error?: string };
  if (!res.ok || !body.uri) throw new Error(`upload ${meta.symbol} failed: ${res.status} ${body.error ?? ""}`);
  return body.uri;
}

async function createRaise(
  client: MoshClient,
  creator: Keypair,
  meta: { name: string; symbol: string; description: string; bg: string; fg: string },
): Promise<PublicKey> {
  const platform = await client.fetchPlatform();
  if (!platform) throw new Error("platform not initialized — run `pnpm setup:localnet` first");
  // The demo loops record the in-app trade panel, which only Holdfast-curve launches have.
  if (!platform.params.holdfastCurveEnabled) {
    throw new Error("the Holdfast curve is disabled on this platform: run `HOLDFAST_CURVE=1 pnpm setup:localnet --update` first");
  }
  const mint = Keypair.generate();
  const ix = await client.createLaunchIx({
    creator: creator.publicKey,
    mint: mint.publicKey,
    feeRecipient: platform.feeRecipient,
    name: meta.name,
    symbol: meta.symbol,
    uri: await upload(meta),
    raiseMin: solToLamports(2),
    raiseMax: solToLamports(10),
    maxPerWallet: 0n,
    durationSecs: DAY,
    whitelistRoot: OPEN_WHITELIST_ROOT,
    bundleSupplyBps: 2_000,
    reserveBps: 3_000,
    terms: platform.params,
  });
  await send(client, creator, [ix], [mint]);
  console.log(`created ${meta.symbol} ${mint.publicKey.toBase58()}`);
  return mint.publicKey;
}

async function deposit(client: MoshClient, backer: Keypair, mint: PublicKey, sol: number, who: string) {
  await send(client, backer, [await client.depositIx(backer.publicKey, mint, solToLamports(sol))]);
  console.log(`  ${who} backed ${sol} SOL`);
}

async function fetchLaunch(client: MoshClient, mint: PublicKey): Promise<LaunchAccount> {
  const l = await client.fetchLaunch(mint);
  if (!l) throw new Error(`no launch for mint ${mint.toBase58()}`);
  return l;
}

async function status(client: MoshClient, mint: PublicKey) {
  const l = await fetchLaunch(client, mint);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ev = predict(l, now);
  const p = ev.projection;
  const burner = key("burner").publicKey;
  const b = await client.fetchBacker(mint, burner);
  const claimable = b ? backerClaimable(BigInt(b.deposited.toString()), BigInt(l.accFeePerShare.toString()), BigInt(b.feesClaimed.toString())) : 0n;
  console.log(
    [
      `mint ${mint.toBase58()} status ${Object.keys(l.status)[0]}`,
      `spot ${fmtPrice(q64ToSolPerToken(p.price))}  ema ${fmtPrice(q64ToSolPerToken(p.ema))}  buy ceiling ${fmtPrice(q64ToSolPerToken(p.buyCeiling))}`,
      `vault ${lamportsToSol(l.vaultSol.toString())} SOL · buy window left ${lamportsToSol(p.buyRemaining)} SOL · buy-back ${lamportsToSol(l.buybackSol.toString())} SOL`,
      `agent sold ${l.agentTokensSold.toString()} base units for ${lamportsToSol(l.agentSolReceived.toString())} SOL`,
      `agent would now: ${ev.plan.action} — ${ev.plan.reason}`,
      `burner backer claimable ${lamportsToSol(claimable)} SOL · creator fees unclaimed ${lamportsToSol(l.creatorFeesUnclaimed.toString())} SOL`,
    ].join("\n"),
  );
}

async function trades(connection: Connection, client: MoshClient, mint: PublicKey, rounds: number) {
  const traders = [1, 2, 3].map((i) => key(`trader-${i}`));
  await Promise.all(traders.map((t) => topUp(connection, t, 60)));
  let volume = 0;
  for (let r = 0; r < rounds; r++) {
    const trader = traders[r % traders.length]!;
    try {
      const l = await fetchLaunch(client, mint);
      const fee = l.terms.tradeFeeBps;
      const lamports = solToLamports(Math.round((1 + Math.random() * 3) * 1000) / 1000);
      const q = quoteBuy(curveOf(l), lamports, fee);
      await send(client, trader, [await client.buyIx(trader.publicKey, mint, lamports, minOut(q.tokensOut, SLIPPAGE_BPS))]);
      volume += lamportsToSol(lamports);
      await sleep(1_500);
      const held = await tokenBalance(connection, trader.publicKey, mint);
      const sellPart = (held * BigInt(55 + Math.floor(Math.random() * 45))) / 100n;
      const l2 = await fetchLaunch(client, mint);
      const qs = quoteSell(curveOf(l2), sellPart, fee);
      await send(client, trader, [await client.sellIx(trader.publicKey, mint, sellPart, minOut(qs.solOut, SLIPPAGE_BPS))]);
      volume += lamportsToSol(qs.solOut);
      console.log(`  round ${r + 1}/${rounds}: price ${fmtPrice(spotPrice(curveOf(l2)))} · volume ${volume.toFixed(2)} SOL`);
    } catch (err) {
      console.warn(`  round ${r + 1} failed: ${describeError(err)}`);
    }
    await sleep(1_500);
  }
}

/**
 * The whale takes a large position; the script traders then sell theirs, so spot ends near where it
 * was while the whale holds enough tokens for a dump well below the EMA and the agent's sell prices.
 */
async function defendPrep(connection: Connection, client: MoshClient, mint: PublicKey, sol: number) {
  const whale = key("whale");
  await topUp(connection, whale, sol + 20);
  const l = await fetchLaunch(client, mint);
  const lamports = solToLamports(sol);
  const q = quoteBuy(curveOf(l), lamports, l.terms.tradeFeeBps);
  await send(client, whale, [await client.buyIx(whale.publicKey, mint, lamports, minOut(q.tokensOut, SLIPPAGE_BPS))]);
  console.log(`whale bought ${sol} SOL → price ${fmtPrice(q.priceAfter)}`);
  for (const i of [1, 2, 3]) {
    const trader = key(`trader-${i}`);
    const held = await tokenBalance(connection, trader.publicKey, mint);
    if (held === 0n) continue;
    const now = await fetchLaunch(client, mint);
    const qs = quoteSell(curveOf(now), held, now.terms.tradeFeeBps);
    await send(client, trader, [await client.sellIx(trader.publicKey, mint, held, minOut(qs.solOut, SLIPPAGE_BPS))]);
    console.log(`  trader-${i} sold out → price ${fmtPrice(qs.priceAfter)}`);
  }
  await status(client, mint);
}

/** State after a public sell of `tokens` (curve only; fees leave `realSol` too but not the price). */
function afterSell(l: LaunchAccount, tokens: bigint): LaunchAccount {
  const x = BigInt(l.virtualSol.toString()) + BigInt(l.realSol.toString());
  const y = BigInt(l.tokenReserve.toString());
  const out = solOut(x, y, tokens);
  return { ...l, realSol: new BN((BigInt(l.realSol.toString()) - out).toString()), tokenReserve: new BN((y + tokens).toString()) };
}

async function defendDump(connection: Connection, client: MoshClient, mint: PublicKey) {
  const whale = key("whale");
  const held = await tokenBalance(connection, whale.publicKey, mint);
  const l = await fetchLaunch(client, mint);
  const now = BigInt(Math.floor(Date.now() / 1000)) + 3n;
  const x = BigInt(l.virtualSol.toString()) + BigInt(l.realSol.toString());
  const y = BigInt(l.tokenReserve.toString());
  const ema = predict(l, now).projection.ema;
  const band = BigInt(l.terms.agentBandBps);
  // Spot after selling T tokens is x·y/(y+T)²; start at the price `DUMP_EXTRA_BPS` under the agent's trigger.
  const target = (ema * (10_000n - band - BigInt(Math.ceil(DEFAULT_PARAMS.buyMarginBps)) - DUMP_EXTRA_BPS)) / 10_000n;
  let tokens = isqrt((((x * y) << 64n) / target)) - y;
  if (tokens < 0n) tokens = 0n;
  // Deepen in 2% steps until the agent's own planner says "buy" (cost-basis or buy-back path).
  let plan = predict(afterSell(l, tokens), now).plan;
  while (plan.action !== "buy" && tokens < held) {
    tokens = tokens + tokens / 50n + 1n;
    plan = predict(afterSell(l, tokens), now).plan;
  }
  if (plan.action !== "buy" || tokens > held) {
    throw new Error(`whale holds ${held} base units; not enough for an agent buy (${plan.reason}). Run defend-prep first.`);
  }
  console.log(`dump ${(Number(tokens) / 1e6).toLocaleString()} of ${(Number(held) / 1e6).toLocaleString()} whale tokens; agent will plan: ${plan.reason}`);
  if (process.argv.includes("--dry")) return;
  const q = quoteSell(curveOf(l), tokens, l.terms.tradeFeeBps);
  const before = Math.floor(Date.now() / 1000) - 1;
  const sig = await send(client, whale, [await client.sellIx(whale.publicKey, mint, tokens, minOut(q.solOut, SLIPPAGE_BPS))]);
  console.log(`dump ${sig}: ${lamportsToSol(q.solOut).toFixed(3)} SOL out, price → ${fmtPrice(q.priceAfter)}`);
  for (let i = 0; i < 45; i++) {
    await sleep(2_000);
    const res = await fetch(`${INDEXER_URL}/api/launches/${mint.toBase58()}/trades?agent=1&side=buy&limit=1`);
    const body = (await res.json()) as { trades: { timestamp: number; solAmount?: string; signature?: string }[] };
    const t = body.trades[0];
    if (t && t.timestamp >= before) {
      console.log(`agent_buy landed: ${JSON.stringify(t)}`);
      return;
    }
  }
  throw new Error("no agent_buy within 90 s — check `curl 127.0.0.1:8788/status`");
}

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const [step, mintArg] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  const connection = new Connection(RPC_URL, "confirmed");
  const client = clientFor(connection, key("creator"));
  const state = (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {}) as State;
  const mintOr = (fallback: string | undefined) => {
    const m = mintArg ?? fallback;
    if (!m) throw new Error("no mint: pass one or run the-lock first");
    return new PublicKey(m);
  };

  switch (step) {
    case "burner": {
      const burner = key("burner");
      await topUp(connection, burner, 50);
      console.log(`burner ${burner.publicKey.toBase58()}`);
      console.log(`localStorage.setItem("holdfast:burner-secret", ${JSON.stringify(JSON.stringify(Array.from(burner.secretKey)))})`);
      return;
    }
    case "back-a-raise": {
      const creator = key("creator");
      const backers = [1, 2].map((i) => key(`backer-${i}`));
      await Promise.all([creator, ...backers].map((kp) => topUp(connection, kp, 20)));
      const mint = await createRaise(client, creator, {
        name: flag("name", "Tidepool"),
        symbol: flag("symbol", "TIDE"),
        description: "A slow-filling pool for patient backers. Raise 2–10 SOL; the bundle buys first and backers share its profit.",
        bg: "#0E7490",
        fg: "#ECFEFF",
      });
      await deposit(client, backers[0]!, mint, 0.8, "backer-1");
      await deposit(client, backers[1]!, mint, 0.45, "backer-2");
      fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, backARaise: mint.toBase58() }, null, 2));
      console.log(`back-a-raise ready: /launch/${mint.toBase58()}`);
      return;
    }
    case "the-lock": {
      const burner = key("burner");
      const backers = [1, 2, 3].map((i) => key(`backer-${i}`));
      await Promise.all([topUp(connection, burner, 50), ...backers.map((kp) => topUp(connection, kp, 20))]);
      const mint = await createRaise(clientFor(connection, burner), burner, {
        name: flag("name", "Anchorage"),
        symbol: flag("symbol", "ANCR"),
        description: "Dropped anchor: a fifth of supply bundled into the vault, traded only by the rate-limited agent.",
        bg: "#1E293B",
        fg: "#FDBA74",
      });
      await deposit(client, burner, mint, 1, "burner");
      await deposit(client, backers[0]!, mint, 1.5, "backer-1");
      await deposit(client, backers[1]!, mint, 1, "backer-2");
      await deposit(client, backers[2]!, mint, 0.7, "backer-3");
      fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, theLock: mint.toBase58() }, null, 2));
      console.log(`the-lock ready (burner is creator, min met): /launch/${mint.toBase58()}`);
      return;
    }
    case "trades":
      await trades(connection, client, mintOr(state.theLock), Number(flag("rounds", "20")));
      await status(client, mintOr(state.theLock));
      return;
    case "defend-prep":
      await defendPrep(connection, client, mintOr(state.theLock), Number(flag("sol", "12")));
      return;
    case "defend-dump":
      await defendDump(connection, client, mintOr(state.theLock));
      return;
    case "status":
      await status(client, mintOr(state.theLock));
      return;
    default:
      throw new Error(`unknown step "${step ?? ""}" — see the header of scripts/src/record-demos.ts`);
  }
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});
