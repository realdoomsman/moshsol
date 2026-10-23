// "How much supply is burned?" post for the buyback mint (HOLD): the total from the mint's on-chain supply, split into
// pump.fun BOOST (PumpSwap `BoostBuyAndBurn` right after migration), Holdfast's buyback-and-burn (every launch's
// `burnedTokens`; the platform's buyback mint is HOLD) and whatever else was burned.
//   node brand/x/src/burns.mjs [launch address]   # default: the HOLD launch
// RPC: see `rpc` in stat-card.mjs.
import { DIM, HOLD_LAUNCH, MUTED, ORANGE, PAPER, get, money, n0, n2, page, render, rpc, sol } from "./stat-card.mjs";

const LAUNCH = process.argv[2] ?? HOLD_LAUNCH;
const SUPPLY = 1_000_000_000; // every pump.fun mint starts at 1B, 6 decimals
// The fee payer that signs pump.fun's BOOST transactions (observed on HOLD and TEST: PumpSwap `BoostBuyAndBurn`,
// the pool as burn authority). Counted only when the log names that instruction.
const BOOSTER = "HTVZVEQMBsNanubDPTs3CxDAEGNFQHJY8c1441iy2S5r";
const BOOST_WINDOW_SECS = 900;

const [platform, l, list, { solUsd }] = await Promise.all([
  get("/api/platform"),
  get(`/api/launches/${LAUNCH}`),
  get("/api/launches?status=all&sort=new&limit=500"),
  get("/api/stats"),
]);
if (!solUsd) throw new Error("no SOL/USD price from the indexer");
const mint = l.mint;
if (platform.params.buybackMint !== mint) throw new Error(`buyback mint is ${platform.params.buybackMint}, not ${mint}`);

const mintInfo = (await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }])).value.data.parsed.info;
const supply = Number(mintInfo.supply) / 10 ** mintInfo.decimals;
const burned = SUPPLY - supply;
if (mintInfo.mintAuthority !== null) throw new Error(`mint authority is ${mintInfo.mintAuthority}: supply can still grow`);

const holdfastBurned = list.launches.reduce((acc, x) => acc + Number(x.burnedTokens ?? 0) / 1e6, 0);
const holdfastSol = list.launches.reduce((acc, x) => acc + sol(x.burnedSol ?? 0), 0);
const feeLaunches = list.launches.filter((x) => Number(x.burnedTokens ?? 0) > 0).length;

// BOOST: the booster's transactions from launch to launch + 15 min that burn this mint.
const from = l.launchedAt - 5, to = l.launchedAt + BOOST_WINDOW_SECS;
const sigs = [];
for (let before; ; ) {
  const page_ = await rpc("getSignaturesForAddress", [BOOSTER, { limit: 1000, ...(before ? { before } : {}) }]);
  sigs.push(...page_.filter((s) => s.err === null && s.blockTime >= from && s.blockTime <= to));
  if (page_.length < 1000 || page_[page_.length - 1].blockTime < from) break;
  before = page_[page_.length - 1].signature;
}
const boosts = [];
for (const s of sigs) {
  const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
  if (!tx.meta.logMessages.some((m) => m === "Program log: Instruction: BoostBuyAndBurn")) continue;
  const ixs = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions)];
  const amount = ixs
    .filter((ix) => /^burn/i.test(ix.parsed?.type ?? "") && ix.parsed.info.mint === mint)
    .reduce((acc, ix) => acc + Number(ix.parsed.info.amount ?? ix.parsed.info.tokenAmount.amount) / 1e6, 0);
  if (amount > 0) boosts.push({ at: s.blockTime, amount });
}
const boostBurned = boosts.reduce((acc, b) => acc + b.amount, 0);
const boostMins = boosts.length ? Math.ceil((Math.max(...boosts.map((b) => b.at)) - l.launchedAt) / 60) : 0;
const other = burned - boostBurned - holdfastBurned;
if (other < -1) throw new Error(`parts exceed the total: ${burned} < ${boostBurned} + ${holdfastBurned}`);

const m = (x) => `${n2(x / 1e6)}M`;
const pct = (x) => `${n2((x / SUPPLY) * 100)}%`;
const now = Math.floor(Date.now() / 1000);
const tag = `$${l.symbol}`;
const parts = [
  { amount: boostBurned, color: PAPER, label: "pump.fun BOOST", note: `${boosts.length} buy-and-burns after migration` },
  { amount: holdfastBurned, color: ORANGE, label: "Holdfast buyback &amp; burn", note: `${money(holdfastSol * solUsd)} of creator fees` },
  { amount: Math.max(0, other), color: DIM, label: "other burns", note: "everything else on chain" },
];

// Headline: the share of supply. Below: one bar for everything burned, split by source, with a legend column each.
const style = `<style>
.burnbar{position:absolute;left:96px;right:96px;top:452px;height:44px;display:flex;gap:4px}
.burnbar i{display:block;height:100%}
.burnscale{position:absolute;left:96px;right:96px;top:508px;display:flex;justify-content:space-between;font-family:JBM,monospace;font-size:28px;color:${DIM}}
.legend{position:absolute;left:96px;right:96px;top:566px;display:grid;grid-template-columns:repeat(3,1fr);gap:48px}
.legend .n{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95;font-size:88px}
.legend .l{display:flex;align-items:center;gap:14px;font-size:32px;color:${PAPER};margin-top:16px}
.legend .l i{width:20px;height:20px;display:inline-block}
.legend .d{font-size:28px;color:${MUTED};margin-top:8px}
</style>`;
const cards = [
  {
    name: "burns",
    html: page(
      `${tag} · burned supply`,
      `${style}
<div class="disp big" style="top:196px"><em>${pct(burned)}</em> of ${tag}<br>is already burned.</div>
<div class="burnbar">${parts.map((p) => `<i style="flex:${p.amount.toFixed(0)} 0 0;background:${p.color}"></i>`).join("")}</div>
<div class="burnscale"><span>${m(burned)} ${tag} burned</span><span>of 1,000,000,000</span></div>
<div class="legend">${parts.map((p) => `<div><div class="n" style="color:${p.color}">${m(p.amount)}</div><div class="l"><i style="background:${p.color}"></i>${p.label}</div><div class="d">${p.note}</div></div>`).join("")}</div>`,
      `supply on the mint: ${n0(supply)} · mint authority: none`,
    ),
  },
];

const text = `${pct(burned)} of the ${tag} supply is already burned: ${m(burned)} tokens, gone for good.

• ${m(boostBurned)}: pump.fun BOOST, ${boosts.length} buy-and-burns right after migration
• ${m(holdfastBurned)}: Holdfast buyback-and-burn, paid with ${money(holdfastSol * solUsd)} of creator fees
• ${m(Math.max(0, other))}: other burns

Mint authority revoked. Supply only goes one way.`;

render(now, cards, [
  {
    images: ["burns"],
    alt: [`${pct(burned)} of ${tag} supply burned, ${m(burned)} of 1 billion: ${m(boostBurned)} by pump.fun BOOST, ${m(holdfastBurned)} by Holdfast buyback and burn, ${m(Math.max(0, other))} other burns`],
    text,
  },
], { launch: LAUNCH, mint, supply, burned, solUsd, boostBurned, boosts, holdfastBurned, holdfastSol, feeLaunches, other });
