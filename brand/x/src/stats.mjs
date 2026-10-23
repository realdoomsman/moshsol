// Live-stats posts: reads the mainnet indexer once, writes four 1600×900 cards in the kit's style plus the post copy
// built from the same snapshot, so every number on a card matches its post.
//   node brand/x/src/stats.mjs [launch address]   # default: the HOLD launch
// Output: brand/x/stats/<unix time>/{stats-*.html,stats-*.png,posts.json}
import { HOLD_LAUNCH, ORANGE, col, get, n0, n1, n2, page, render, sol } from "./stat-card.mjs";

const LAUNCH = process.argv[2] ?? HOLD_LAUNCH;
const [stats, l] = await Promise.all([get("/api/stats"), get(`/api/launches/${LAUNCH}`)]);
const now = Math.floor(Date.now() / 1000);

const mins = Math.max(1, Math.round((now - l.launchedAt) / 60));
const since = mins < 120 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`;
const volume = sol(l.volumeSol);
const vaultIn = sol(l.initialVaultSol);
const vault = sol(l.vaultSol);
const target = l.payoutTargetSol;
const mult = l.payoutMultiple;
const fees = l.creatorFeeSplit;
const feesTotal = sol(l.creatorFeesCollected);
const withdrawn = l.vaultWithdrawnSol;
// The bar runs to the larger of the vault's multiple and the 5× payback mark; the mark gets its own tick.
const scale = Math.max(mult, 5);
const pct = (mult / scale) * 100;
const markPct = (5 / scale) * 100;
const past = mult >= 5;

const cards = [
  {
    name: "stats-hold-launch",
    alt: `HOLD: ${n0(volume)} SOL traded in its first ${since}`,
    html: page(
      "HOLD · live on pump.fun",
      `<div class="disp big">${n0(volume)} SOL traded<br>in the first <em>${since}</em>.</div>
<div class="split">${col(n0(l.tradeCount), "trades")}${col(n0(l.holders), "holders", true)}${col(n0(l.buyers24h), "buyers")}</div>`,
      "read from chain by the Holdfast indexer",
    ),
    text: `HOLD has been live for ${since}.

${n0(volume)} SOL traded, ${n0(l.tradeCount)} trades, ${n0(l.holders)} holders, ${n0(l.buyers24h)} buyers.

The raise made the first buy in the create instruction. Nothing traded before it.`,
  },
  {
    name: "stats-hold-vault",
    alt: `HOLD vault: ${n1(vaultIn)} SOL in, ${n1(vault)} SOL now`,
    html: page(
      "HOLD · the vault",
      `<div class="disp big">${n1(vaultIn)} SOL went in.<br><em>${n1(vault)} SOL</em> in the vault now.</div>
<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
<div class="mark" style="left:calc(96px + (100% - 192px) * ${(markPct / 100).toFixed(4)})"></div>
<div class="ticks"><span style="left:0">0</span>${past ? `<span style="right:calc(${(100 - markPct).toFixed(2)}% + 12px)">5× · ${n1(target)} SOL</span><span style="right:0;color:${ORANGE}">${n2(mult)}×</span>` : `<span style="left:calc(${pct.toFixed(2)}% + 12px)">${n2(mult)}×</span><span style="right:0">5× · ${n1(target)} SOL</span>`}</div>
<div class="sup" style="top:680px">${n0(l.agentSells)} sells into strength. <b>Every lamport stays in the vault as SOL.</b></div>`,
      `vault withdrawals: ${n0(withdrawn)} SOL`,
    ),
    text: `The HOLD vault started with ${n1(vaultIn)} SOL. It holds ${n1(vault)} SOL now: ${n2(mult)}×.

The vault agent sold into strength ${n0(l.agentSells)} times and kept every lamport as SOL.

${past ? `Past 5× (${n1(target)} SOL): the raise is paid back when the chart is strong, 4 hours after launch at the earliest.` : `At 5× (${n1(target)} SOL) the raise is paid back.`}`,
  },
  {
    name: "stats-hold-fees",
    alt: `HOLD creator fees: ${n2(feesTotal)} SOL, split 75/15/10`,
    html: page(
      "HOLD · creator fees",
      `<div class="disp big">${n2(feesTotal)} SOL in creator fees.<br><em>0%</em> to the creator.</div>
<div class="split">${col(n2(fees.vaultSol), "to the vault · 75%", true)}${col(n2(fees.burnSol), "buy &amp; burn · 15%")}${col(n2(fees.backersSol), "to backers · 10%")}</div>`,
      `collected ${l.cranks.creatorFeeCollections} times · split on chain`,
    ),
    text: `${n2(feesTotal)} SOL of pump.fun creator fees on HOLD so far.

${n2(fees.vaultSol)} SOL to the vault, ${n2(fees.burnSol)} SOL to buy and burn, ${n2(fees.backersSol)} SOL to backers. The creator takes 0%.

Split by the program, every collection.`,
  },
  {
    name: "stats-platform",
    alt: `Holdfast on mainnet: ${n0(stats.totalVolumeSol)} SOL volume, ${n0(stats.agentTrades)} vault agent trades`,
    html: page(
      "Holdfast · mainnet",
      `<div class="disp big">${n0(stats.totalVolumeSol)} SOL traded<br>across <em>${stats.totalLaunches} launches</em>.</div>
<div class="split">${col(n0(stats.agentTrades), "vault agent trades")}${col(n1(stats.vaultSol), "SOL in vaults", true)}${col(n0(stats.vaultWithdrawnSol), "SOL withdrawn")}</div>`,
      "api.holdfast.fun/api/stats",
    ),
    text: `Holdfast on mainnet: ${n0(stats.totalVolumeSol)} SOL traded across ${stats.totalLaunches} launches.

${n0(stats.agentTrades)} vault agent trades, ${n1(stats.vaultSol)} SOL sitting in vaults, ${n0(stats.vaultWithdrawnSol)} SOL withdrawn from any of them.

holdfast.fun`,
  },
];

render(
  now,
  cards.map(({ name, html }) => ({ name, html })),
  cards.map(({ name, alt, text }) => ({ images: [name], alt: [alt], text })),
  { launch: LAUNCH },
);
