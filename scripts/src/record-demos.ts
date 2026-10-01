/**
 * On-chain setup for the four landing/docs product loops (design brief §3.9) on the pump.fun venue:
 * `back-a-raise`, `the-bundle`, `agent-defends`, `claim`. Every step sends real transactions to the
 * local validator through the SDK (`create_launch_pump` / `launch_pump`, public trades straight on
 * pump.fun's bonding curve, the real vault agent landing `agent_buy_pump` / `agent_sell_pump`); nothing
 * is mocked. The screen capture is driven from a headless Chrome over CDP (see "Recording procedure").
 *
 *   pnpm --filter @holdfast/scripts record:demos <step> [launch] [--flag value]
 *
 * `launch` is the launch address (what the URL shows) or its create key; steps default to the launch
 * remembered in `.localnet/demo/state.json` by `the-bundle`.
 *
 * Steps:
 *   burner                     create/load the test wallet `.localnet/demo/burner.json`, fund it, and print the
 *                              localStorage line that makes the web app's Burner wallet use it
 *   back-a-raise [--name N --symbol S]
 *                              open raise (default Tidepool/TIDE; script creator, min 2 / max 10 SOL, 1 day) with
 *                              1.25 SOL of backing from two script backers
 *   the-bundle [--name N --symbol S]
 *                              raise (default Anchorage/ANCR) created BY THE BURNER (min 2 / max 10 SOL); the burner
 *                              backs 1 SOL and script backers push it past the minimum, so its page shows "Launch now"
 *                              (clicking it runs `launch_pump`: the token is created on pump.fun and the bundle is its
 *                              first buy). `launch` cranks the same instruction from the script instead.
 *   launch [launch]            `launch_pump` from the script creator (when the browser didn't click "Launch now")
 *   trades [launch] [--rounds n]
 *                              public buys/sells by script traders on the token's pump.fun curve (volume for the
 *                              agent's sell guardrail; pump.fun's creator fee accrues to the launch)
 *   rally [launch] [--sol n]   a script whale buys `n` SOL (default 12) on pump.fun, then the script traders sell out,
 *                              so spot ends near where it was while the whale holds enough tokens for a dump well
 *                              below the EMA; the agent sells into the rally first (realized profit → backers' claimable)
 *   defend-dump [launch] [--dry]
 *                              dumps just enough of the whale's tokens on pump.fun that the agent's own `evaluate()`
 *                              plans an `agent_buy_pump` (spot > band below EMA and at/below vault cost or avg agent
 *                              sell × (1 − band)), then waits for the agent's buy to land and prints it; `--dry` only predicts
 *   status [launch]            venue reserves, EMA/band, agent budgets and the burner's claimable profit share
 *   payout-prep [launch] [--mult 5 --sol 4]
 *                              (new economics, `payout` scene) script whales pump on pump.fun until the agent's sells
 *                              lift vault SOL to `mult` × the launch's initial vault SOL; then crank `payout_backers`
 *                              (`client.payoutBackersIx`, pending the program upgrade) and record /portfolio showing
 *                              the backer's principal returned. Open the raise with a 1 SOL minimum so 5× is reachable.
 *
 * Recording procedure (what produced apps/web/public/videos/* and brand/x/video/*). This file prepares the chain;
 * `record-demos-capture.mjs` records a scene, `record-demos-encode.mjs` cuts and encodes it, `record-demos-cards.mjs`
 * renders the hero's title cards (all plain Node + ffmpeg + the installed Chrome; nothing to install):
 *   0. Validator with pump.fun cloned (`CLONE_PUMP=1 bash scripts/localnet.sh --reset` in WSL), `HOLDFAST_CURVE=0
 *      MAX_RAISE_SOL=50 MAX_WALLET_SOL=5 pnpm setup:localnet` (`--update` on an existing platform), the indexer
 *      (`PORT=8797 DB_PATH=… pnpm --filter @holdfast/indexer start`) and the agent (`STATUS_PORT=8798 CRANK_MS=20000
 *      pnpm --filter @holdfast/agent start`) so its trades really land.
 *   1. `NEXT_PUBLIC_INDEXER_URL=http://127.0.0.1:8797 NEXT_PUBLIC_AGENT_URL=http://127.0.0.1:8798 NEXT_DIST_DIR=.next-demo
 *      pnpm --filter @holdfast/web build`, then in apps/web `NEXT_DIST_DIR=.next-demo pnpm exec next start -p 3310`.
 *   2. `record:demos burner`. Every `node scripts/src/record-demos-capture.mjs <scene> --path <url path> --out <dir>
 *      [--mobile] [--run "<command>"]` opens a dedicated headless Chrome (`--headless=new`, own `--user-data-dir`,
 *      `--force-device-scale-factor=2`) at 1600×1000 CSS px (taller for the launch page scenes; `--mobile` = 390×844,
 *      touch), seeds the burner secret in localStorage, connects "Test wallet", draws a synthetic cursor (the headless
 *      page has none) that eases between targets, and saves CDP `Page.startScreencast` frames (jpeg, 2× scale) with
 *      their timestamps plus the boxes of the panels the cut crops to (`timeline.json`).
 *   3. back-a-raise: `record:demos back-a-raise` → capture `back-a-raise --path /launch/<address>`: types 0.5 in the
 *      back amount, clicks "Back with 0.5 SOL", waits for the "Deposited 0.5 SOL" toast (progress bar, backer count
 *      and "What you get" update on the way).
 *   4. the-bundle: `record:demos the-bundle` → capture `the-bundle` (viewport 1600×2000: the vault card sits below the
 *      fold): clicks "Launch now", waits for the "Trade $SYMBOL on pump.fun curve" link. Cut: the click and the
 *      status flip (top 1600×1000), then the vault card zoomed.
 *   5. `record:demos trades --rounds 16` (volume), `record:demos rally` (the agent sells into it once its sell window
 *      has room — the realized profit is what `claim` collects), then wait until `defend-dump --dry` predicts a buy
 *      (buy window room, the agent's 15 s cooldown over). Capture `agent-defends --run "pnpm --filter
 *      @holdfast/scripts run record:demos defend-dump <address>"` (viewport 1600×1900): the dump lands, the agent's
 *      filled marker, the "Agent buy" row and "Bought" in the vault card appear. Cut: stats row + chart + first trade
 *      rows, then the vault card zoomed.
 *   6. claim: capture `claim --path /portfolio`: the burner's claimable profit share is visible, "Claim all" is
 *      clicked, the "Claimed … SOL" toast with its explorer link shows and the position's claimable resets.
 *   7. `record-demos-encode.mjs site <capture dir> <name>` writes 1280×800 H.264 MP4 ≤ 1.5 MB + VP9 WebM + JPG
 *      poster (780×1688 for `-m` captures) into apps/web/public/videos; `x <capture dir> <name>` writes 1920×1200
 *      H.264 + silent AAC into brand/x/video; `record-demos-cards.mjs` + `encode hero brand/x/video/launch-in-a-minute.mp4
 *      <cards and clips in order>` cut the ≤ 60 s 1920×1080 compilation; `encode manifest <name>=<seconds>…` updates
 *      `apps/web/public/videos/manifest.json` (cluster, recordedAt, durationSec), which the landing caption reads.
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  OPEN_WHITELIST_ROOT,
  backerClaimable,
  describeError,
  fmtPrice,
  lamportsToSol,
  launchPda,
  launchToJson,
  minOut,
  q64ToSolPerToken,
  quoteBuy,
  quoteSell,
  solOut,
  solToLamports,
  splAta,
  spotPrice,
  tokenAta,
  type CurveState,
  type LaunchAccount,
  type LaunchJson,
  type MoshClient,
} from "@holdfast/sdk";
import { NEUTRAL_FLOW } from "../../apps/agent/src/flow";
import { DEFAULT_PARAMS, evaluate, isqrt, marketOf, type Sizing } from "../../apps/agent/src/strategy";
import {
  LOCALNET_DIR,
  RPC_URL,
  VenueTrader,
  airdrop,
  clientFor,
  createRaise,
  launchRaise,
  loadOrCreateKeypair,
  send,
  venueCurveOf,
  venueFeeBps,
} from "./common";

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://127.0.0.1:8797").replace(/\/+$/, "");
const DEMO_DIR = path.join(LOCALNET_DIR, "demo");
const STATE_FILE = path.join(DEMO_DIR, "state.json");
const DAY = 86_400;
const SLIPPAGE_BPS = 300;
/** The vault agent's default sizing and policy (apps/agent/src/config.ts), used to predict its next decision. */
const AGENT_SIZING: Sizing = { minTradeLamports: 10_000_000n, slippageBps: 100 };
/** Extra depth below the agent's trigger so EMA drift during the next ticks can't cancel the buy. */
const DUMP_EXTRA_BPS = 120n;

/** The agent's decision on `l` trading against `curve` at `now` (flow neutral: the demo dumps into a quiet market). */
function predict(l: LaunchAccount, curve: CurveState, now: bigint) {
  return evaluate(marketOf(l, curve), AGENT_SIZING, now, DEFAULT_PARAMS, NEUTRAL_FLOW);
}

/** A launch by its PDA (the URL) and the PDA's second seed (what deposits and claims key on). */
interface Target {
  address: string;
  seedKey: string;
}

interface State {
  backARaise?: Target;
  theBundle?: Target;
}

/** Loaded or created on first use under `.localnet/demo/`. */
const key = (name: string) => loadOrCreateKeypair(`demo/${name}`);

async function topUp(connection: Connection, kp: Keypair, minSol: number): Promise<void> {
  const bal = await connection.getBalance(kp.publicKey, "confirmed");
  if (bal < minSol * LAMPORTS_PER_SOL) await airdrop(connection, kp.publicKey, minSol * 2 - bal / LAMPORTS_PER_SOL);
}

async function tokenBalance(connection: Connection, owner: PublicKey, l: LaunchJson): Promise<bigint> {
  const mint = new PublicKey(l.mint);
  const ata = l.venue === "pump" ? splAta(owner, mint) : tokenAta(owner, mint);
  if (!(await connection.getAccountInfo(ata, "confirmed"))) return 0n;
  return BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
}

function logoSvg(symbol: string, bg: string, fg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${bg}"/><text x="256" y="300" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="700" fill="${fg}" text-anchor="middle">${symbol.slice(0, 3)}</text></svg>`;
}

interface Meta {
  name: string;
  symbol: string;
  description: string;
  bg: string;
  fg: string;
}

async function upload(meta: Meta): Promise<string> {
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

/** A pump.fun raise (min 2 / max 10 SOL, one day, open whitelist, 20% bundle, 30% reserve) by `creator`. */
async function openRaise(client: MoshClient, creator: Keypair, meta: Meta): Promise<Target> {
  const platform = await client.fetchPlatform();
  if (!platform) throw new Error("platform not initialized — run `pnpm setup:localnet` first");
  if (platform.params.holdfastCurveEnabled) {
    throw new Error("the Holdfast curve is enabled: the loops record pump.fun launches, run `HOLDFAST_CURVE=0 pnpm setup:localnet --update`");
  }
  const { address, seedKey } = await createRaise(client, creator, platform, {
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
  });
  console.log(`created ${meta.symbol} ${address.toBase58()} (pump.fun)`);
  return { address: address.toBase58(), seedKey: seedKey.toBase58() };
}

async function deposit(client: MoshClient, backer: Keypair, t: Target, sol: number, who: string) {
  await send(client, backer, [await client.depositIx(backer.publicKey, new PublicKey(t.seedKey), solToLamports(sol))]);
  console.log(`  ${who} backed ${sol} SOL`);
}

async function fetchLaunch(client: MoshClient, t: Target): Promise<LaunchAccount> {
  const l = await client.fetchLaunch(new PublicKey(t.seedKey));
  if (!l) throw new Error(`no launch at ${t.address}`);
  return l;
}

async function snapshot(client: MoshClient, t: Target): Promise<{ account: LaunchAccount; json: LaunchJson }> {
  const account = await fetchLaunch(client, t);
  return { account, json: launchToJson(new PublicKey(t.address), account) };
}

/** The venue reserves a live launch trades against (pump.fun curve before graduation). */
async function venueOf(connection: Connection, json: LaunchJson): Promise<CurveState> {
  const curve = await venueCurveOf(connection, json);
  if (!curve) throw new Error(`${json.symbol} has no venue yet (status ${json.status}) — launch it first`);
  return curve;
}

async function status(connection: Connection, client: MoshClient, t: Target) {
  const { account: l, json } = await snapshot(client, t);
  const burner = key("burner").publicKey;
  const b = await client.fetchBacker(new PublicKey(t.seedKey), burner);
  const claimable = b ? backerClaimable(BigInt(b.deposited.toString()), BigInt(l.accFeePerShare.toString()), BigInt(b.feesClaimed.toString())) : 0n;
  const lines = [`${json.symbol} ${t.address} status ${json.status} · mint ${json.mint}`];
  if (json.status === "live") {
    const curve = await venueOf(connection, json);
    const ev = predict(l, curve, BigInt(Math.floor(Date.now() / 1000)));
    const p = ev.projection;
    lines.push(
      `spot ${fmtPrice(q64ToSolPerToken(p.price))}  ema ${fmtPrice(q64ToSolPerToken(p.ema))}  buy ceiling ${fmtPrice(q64ToSolPerToken(p.buyCeiling))}`,
      `vault ${lamportsToSol(l.vaultSol.toString())} SOL · buy window left ${lamportsToSol(p.buyRemaining)} SOL · buyback pool ${lamportsToSol(l.buybackPoolSol.toString())} SOL`,
      `agent sold ${l.agentTokensSold.toString()} base units for ${lamportsToSol(l.agentSolReceived.toString())} SOL · public volume ${lamportsToSol(l.volumeSol.toString())} SOL`,
      `agent would now: ${ev.plan.action} — ${ev.plan.reason}`,
    );
  }
  lines.push(`burner backer claimable ${lamportsToSol(claimable)} SOL (profit share)`);
  console.log(lines.join("\n"));
}

async function trades(connection: Connection, client: MoshClient, t: Target, rounds: number) {
  const traders = [1, 2, 3].map((i) => key(`trader-${i}`));
  await Promise.all(traders.map((tr) => topUp(connection, tr, 60)));
  const venue = new VenueTrader(client);
  let volume = 0;
  for (let r = 0; r < rounds; r++) {
    const trader = traders[r % traders.length]!;
    try {
      const { json } = await snapshot(client, t);
      const fee = venueFeeBps(json);
      const curve = await venueOf(connection, json);
      const lamports = solToLamports(Math.round((1 + Math.random() * 3) * 1000) / 1000);
      const q = quoteBuy(curve, lamports, fee);
      await send(client, trader, await venue.buyIxs(trader.publicKey, json, lamports, minOut(q.tokensOut, SLIPPAGE_BPS)));
      volume += lamportsToSol(lamports);
      await sleep(1_500);
      const held = await tokenBalance(connection, trader.publicKey, json);
      const sellPart = (held * BigInt(55 + Math.floor(Math.random() * 45))) / 100n;
      const curve2 = await venueOf(connection, json);
      const qs = quoteSell(curve2, sellPart, fee);
      await send(client, trader, await venue.sellIxs(trader.publicKey, json, sellPart, minOut(qs.solOut, SLIPPAGE_BPS)));
      volume += lamportsToSol(qs.solOut);
      console.log(`  round ${r + 1}/${rounds}: price ${fmtPrice(spotPrice(curve2))} · volume ${volume.toFixed(2)} SOL`);
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
async function rally(connection: Connection, client: MoshClient, t: Target, sol: number) {
  const whale = key("whale");
  await topUp(connection, whale, sol + 20);
  const venue = new VenueTrader(client);
  const { json } = await snapshot(client, t);
  const fee = venueFeeBps(json);
  const lamports = solToLamports(sol);
  const q = quoteBuy(await venueOf(connection, json), lamports, fee);
  await send(client, whale, await venue.buyIxs(whale.publicKey, json, lamports, minOut(q.tokensOut, SLIPPAGE_BPS)));
  console.log(`whale bought ${sol} SOL → price ${fmtPrice(q.priceAfter)}`);
  for (const i of [1, 2, 3]) {
    const trader = key(`trader-${i}`);
    const held = await tokenBalance(connection, trader.publicKey, json);
    if (held === 0n) continue;
    const qs = quoteSell(await venueOf(connection, json), held, fee);
    await send(client, trader, await venue.sellIxs(trader.publicKey, json, held, minOut(qs.solOut, SLIPPAGE_BPS)));
    console.log(`  trader-${i} sold out → price ${fmtPrice(qs.priceAfter)}`);
  }
  await status(connection, client, t);
}

/**
 * `payout` scene (new economics: agent sells keep all proceeds in the vault; backers get their principal
 * back once vault liquid SOL ≥ `mult` × the initial vault SOL, then 15% every 4 h via `payout_backers`).
 * Script whales buy on pump.fun in `--sol` steps until the agent has sold enough that vault SOL reaches the
 * multiple (every agent sell window lets it sell ≤ 5% of the vault, ~1 SOL/window near launch price, so
 * this runs across several windows: ~10 min each on localnet). Use a small raise (1 SOL min) so the
 * multiple is reachable. When `client.payoutBackersIx` exists (ProgramEcon), `payout` cranks it after this.
 */
async function payoutPrep(connection: Connection, client: MoshClient, t: Target, mult: number, stepSol: number) {
  const whales = [1, 2, 3].map((i) => key(`whale-${i}`));
  await Promise.all(whales.map((w) => topUp(connection, w, stepSol * 4 + 20)));
  const venue = new VenueTrader(client);
  const first = (await snapshot(client, t)).account;
  const initialVault = BigInt(first.vaultSol.toString()) + BigInt(first.agentSolReceived.toString()) - BigInt(first.agentSolSpent.toString());
  const target = (initialVault * BigInt(Math.round(mult * 100))) / 100n;
  console.log(`vault SOL at launch ≈ ${lamportsToSol(initialVault)} SOL · payout at ${mult}× = ${lamportsToSol(target)} SOL`);
  for (let round = 0; round < 60; round++) {
    const { account: l, json } = await snapshot(client, t);
    const vault = BigInt(l.vaultSol.toString());
    if (vault >= target) {
      console.log(`vault ${lamportsToSol(vault)} SOL ≥ ${lamportsToSol(target)} SOL: ready for payout_backers`);
      return;
    }
    const curve = await venueOf(connection, json);
    const ev = predict(l, curve, BigInt(Math.floor(Date.now() / 1000)));
    console.log(`  round ${round + 1}: vault ${lamportsToSol(vault)} / ${lamportsToSol(target)} SOL · spot ${fmtPrice(q64ToSolPerToken(ev.projection.price))} · agent: ${ev.plan.action} — ${ev.plan.reason}`);
    // Below the sell band: a whale buys `stepSol` to put spot above it; otherwise wait for the agent's sell (or its window).
    if (ev.plan.action !== "sell" && !ev.plan.reason.includes("window budget")) {
      const whale = whales[round % whales.length]!;
      const lamports = solToLamports(stepSol);
      const q = quoteBuy(curve, lamports, venueFeeBps(json));
      await send(client, whale, await venue.buyIxs(whale.publicKey, json, lamports, minOut(q.tokensOut, SLIPPAGE_BPS)));
      console.log(`  whale bought ${stepSol} SOL → price ${fmtPrice(q.priceAfter)}`);
    }
    await sleep(20_000);
  }
  throw new Error("vault did not reach the payout multiple in 60 rounds — raise --sol or lower --mult");
}

/** Reserves after a public sell of `tokens` (the venue's fee comes off the proceeds, not the price). */
function afterSell(c: CurveState, tokens: bigint): CurveState {
  const out = solOut(c.virtualSol + c.realSol, c.tokenReserve, tokens);
  return { ...c, realSol: c.realSol - out, tokenReserve: c.tokenReserve + tokens };
}

async function defendDump(connection: Connection, client: MoshClient, t: Target) {
  const whale = key("whale");
  const { account: l, json } = await snapshot(client, t);
  const held = await tokenBalance(connection, whale.publicKey, json);
  const curve = await venueOf(connection, json);
  const now = BigInt(Math.floor(Date.now() / 1000)) + 3n;
  const x = curve.virtualSol + curve.realSol;
  const y = curve.tokenReserve;
  const ema = predict(l, curve, now).projection.ema;
  const band = BigInt(l.terms.agentBandBps);
  // Spot after selling T tokens is x·y/(y+T)²; start at the price `DUMP_EXTRA_BPS` under the agent's trigger.
  const target = (ema * (10_000n - band - BigInt(Math.ceil(DEFAULT_PARAMS.buyMarginBps)) - DUMP_EXTRA_BPS)) / 10_000n;
  let tokens = isqrt(((x * y) << 64n) / target) - y;
  if (tokens < 0n) tokens = 0n;
  // Deepen in 2% steps until the agent's own planner says "buy" (cost-basis or buy-back path).
  let plan = predict(l, afterSell(curve, tokens), now).plan;
  while (plan.action !== "buy" && tokens < held) {
    tokens = tokens + tokens / 50n + 1n;
    plan = predict(l, afterSell(curve, tokens), now).plan;
  }
  if (plan.action !== "buy" || tokens > held) {
    throw new Error(`whale holds ${held} base units; not enough for an agent buy (${plan.reason}). Run rally first.`);
  }
  console.log(`dump ${(Number(tokens) / 1e6).toLocaleString()} of ${(Number(held) / 1e6).toLocaleString()} whale tokens; agent will plan: ${plan.reason}`);
  if (process.argv.includes("--dry")) return;
  const q = quoteSell(curve, tokens, venueFeeBps(json));
  const before = Math.floor(Date.now() / 1000) - 1;
  const sig = await send(client, whale, await new VenueTrader(client).sellIxs(whale.publicKey, json, tokens, minOut(q.solOut, SLIPPAGE_BPS)));
  console.log(`dump ${sig}: ${lamportsToSol(q.solOut).toFixed(3)} SOL out, price → ${fmtPrice(q.priceAfter)}`);
  for (let i = 0; i < 45; i++) {
    await sleep(2_000);
    const res = await fetch(`${INDEXER_URL}/api/launches/${t.address}/trades?agent=1&side=buy&limit=1`);
    const body = (await res.json()) as { trades: { timestamp: number; solAmount?: string; signature?: string }[] };
    const tr = body.trades[0];
    if (tr && tr.timestamp >= before) {
      console.log(`agent_buy_pump landed: ${JSON.stringify(tr)}`);
      return;
    }
  }
  throw new Error("no agent buy within 90 s — check `curl 127.0.0.1:8798/status`");
}

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

/** `arg` as a launch address or create key, else the remembered launch. */
async function resolve(client: MoshClient, arg: string | undefined, fallback: Target | undefined): Promise<Target> {
  if (!arg) {
    if (!fallback) throw new Error("no launch: pass one or run the-bundle first");
    return fallback;
  }
  const pk = new PublicKey(arg);
  const bySeed = await client.fetchLaunch(pk);
  if (bySeed) return { address: launchPda(pk).toBase58(), seedKey: pk.toBase58() };
  const hit = (await client.fetchAllLaunches()).find((l) => l.publicKey.equals(pk));
  if (!hit) throw new Error(`no launch at ${arg}`);
  return { address: arg, seedKey: hit.account.createKey.toBase58() };
}

async function main(): Promise<void> {
  const [step, launchArg] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  const connection = new Connection(RPC_URL, "confirmed");
  const creator = key("creator");
  const client = clientFor(connection, creator);
  const state = (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {}) as State;
  const remember = (patch: Partial<State>) => fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, ...patch }, null, 2));

  switch (step) {
    case "burner": {
      const burner = key("burner");
      await topUp(connection, burner, 50);
      console.log(`burner ${burner.publicKey.toBase58()}`);
      console.log(`localStorage.setItem("holdfast:burner-secret", ${JSON.stringify(JSON.stringify(Array.from(burner.secretKey)))})`);
      return;
    }
    case "back-a-raise": {
      const backers = [1, 2].map((i) => key(`backer-${i}`));
      await Promise.all([creator, ...backers].map((kp) => topUp(connection, kp, 20)));
      const t = await openRaise(client, creator, {
        name: flag("name", "Tidepool"),
        symbol: flag("symbol", "TIDE"),
        description: "A slow-filling pool for patient backers. Raise 2–10 SOL; the bundle buys first on pump.fun and backers share the vault agent's profit.",
        bg: "#0E7490",
        fg: "#ECFEFF",
      });
      await deposit(client, backers[0]!, t, 0.8, "backer-1");
      await deposit(client, backers[1]!, t, 0.45, "backer-2");
      remember({ backARaise: t });
      console.log(`back-a-raise ready: /launch/${t.address}`);
      return;
    }
    case "the-bundle": {
      const burner = key("burner");
      const backers = [1, 2, 3].map((i) => key(`backer-${i}`));
      await Promise.all([topUp(connection, burner, 50), ...backers.map((kp) => topUp(connection, kp, 20))]);
      const t = await openRaise(clientFor(connection, burner), burner, {
        name: flag("name", "Anchorage"),
        symbol: flag("symbol", "ANCR"),
        description: "Dropped anchor: a fifth of supply bundled into the vault at launch, traded only by the rate-limited vault agent.",
        bg: "#1E293B",
        fg: "#FDBA74",
      });
      await deposit(client, burner, t, 1, "burner");
      await deposit(client, backers[0]!, t, 1.5, "backer-1");
      await deposit(client, backers[1]!, t, 1, "backer-2");
      await deposit(client, backers[2]!, t, 0.7, "backer-3");
      remember({ theBundle: t });
      console.log(`the-bundle ready (burner is creator, min met): /launch/${t.address}`);
      return;
    }
    case "launch": {
      const t = await resolve(client, launchArg, state.theBundle);
      const { json } = await snapshot(client, t);
      const mint = await launchRaise(client, creator, json);
      console.log(`launched ${json.symbol}: mint ${mint.toBase58()} on pump.fun`);
      return;
    }
    case "trades": {
      const t = await resolve(client, launchArg, state.theBundle);
      await trades(connection, client, t, Number(flag("rounds", "16")));
      await status(connection, client, t);
      return;
    }
    case "rally":
      await rally(connection, client, await resolve(client, launchArg, state.theBundle), Number(flag("sol", "12")));
      return;
    case "payout-prep":
      await payoutPrep(connection, client, await resolve(client, launchArg, state.theBundle), Number(flag("mult", "5")), Number(flag("sol", "4")));
      return;
    case "defend-dump":
      await defendDump(connection, client, await resolve(client, launchArg, state.theBundle));
      return;
    case "status":
      await status(connection, client, await resolve(client, launchArg, state.theBundle));
      return;
    default:
      throw new Error(`unknown step "${step ?? ""}" — see the header of scripts/src/record-demos.ts`);
  }
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});
