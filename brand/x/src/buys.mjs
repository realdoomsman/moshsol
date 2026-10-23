// "The vault is buying" post: every vault agent buy on a launch (count, SOL spent, tokens bought, one bar per buy on
// a time axis) next to what it sold and what the vault holds, read from the indexer in one pass.
//   node brand/x/src/buys.mjs [launch address]   # default: the HOLD launch
import { DIM, HOLD_LAUNCH, LINE, ORANGE, PAPER, agentTrades, col, get, n0, n1, page, render, sol } from "./stat-card.mjs";

const LAUNCH = process.argv[2] ?? HOLD_LAUNCH;

// The launch account's counters and the trade list come from two reads; retry until they agree on the buy count.
let l, buys;
for (let attempt = 0; ; attempt++) {
  l = await get(`/api/launches/${LAUNCH}`);
  buys = (await agentTrades(LAUNCH)).filter((t) => t.isBuy);
  if (buys.length === l.agentBuys) break;
  if (attempt >= 5) throw new Error(`launch counts ${l.agentBuys} agent buys, trades list ${buys.length}`);
  await new Promise((r) => setTimeout(r, 3000));
}
if (!buys.length) throw new Error("no vault buys yet");

const now = Math.floor(Date.now() / 1000);
const tag = `$${l.symbol}`;
const spent = sol(l.agentSolSpent);
const sold = sol(l.agentSolReceived);
const vault = sol(l.vaultSol);
const bought = buys.reduce((acc, t) => acc + Number(t.tokenAmount) / 1e6, 0);
const first = buys[0].timestamp, last = buys[buys.length - 1].timestamp;
const mins = Math.max(1, Math.ceil((now - first) / 60));
const biggest = Math.max(...buys.map((t) => sol(t.solAmount)));

// One column per buy (the latest 20 if there are more), in order: SOL spent above the bar, minutes since the first
// buy below it, bar height ∝ SOL.
const shown = buys.slice(-20);
const clock = (secs) => `+${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
const chart = `<style>
.chart{position:absolute;left:96px;right:96px;top:548px;height:200px;display:grid;grid-template-columns:repeat(${shown.length},1fr);gap:14px;align-items:end;border-bottom:1px solid ${LINE}}
.chart div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.chart b{font-family:JBM,monospace;font-weight:400;font-size:24px;color:${PAPER};margin-bottom:8px}
.chart i{display:block;width:100%;max-width:64px;background:${ORANGE}}
.axis{position:absolute;left:96px;right:96px;top:758px;display:grid;grid-template-columns:repeat(${shown.length},1fr);gap:14px;text-align:center;font-family:JBM,monospace;font-size:22px;color:${DIM}}
</style>
<div class="chart">${shown.map((t) => `<div><b>${n1(sol(t.solAmount))}</b><i style="height:${Math.max(4, (sol(t.solAmount) / biggest) * 130).toFixed(0)}px"></i></div>`).join("")}</div>
<div class="axis">${shown.map((t) => `<span>${clock(t.timestamp - first)}</span>`).join("")}</div>`;

const cards = [
  {
    name: "buys",
    html: page(
      `${tag} · vault buys`,
      `<div class="disp big" style="top:196px">The vault <em>is buying.</em></div>
<style>.split{top:330px}.split .n{font-size:110px}</style>
<div class="split">${col(n0(buys.length), "buys")}${col(n1(spent), "SOL spent", true)}${col(`${n1(bought / 1e6)}M`, `${tag} back in the vault`)}</div>
${chart}`,
      `SOL per buy · minutes after the first buy · vault now ${n1(vault)} SOL`,
    ),
  },
];

const text = `${tag} vault is buying.

• ${n0(buys.length)} buys, ${n1(spent)} SOL spent in the last ${mins} min
• ${n1(bought / 1e6)}M ${tag} back in the vault
• Paid from its sells into strength: ${n1(sold)} SOL sold, ${n1(vault)} SOL still in the vault
• ${n0(l.vaultWithdrawnSol)} SOL withdrawn

Sold the rips. Buying the dips.`;

render(now, cards, [
  {
    images: ["buys"],
    alt: [`${tag} vault buys: ${n0(buys.length)} buys, ${n1(spent)} SOL spent, ${n1(bought / 1e6)}M ${tag} bought back; one bar per buy`],
    text,
  },
], { launch: LAUNCH, buys: buys.map((t) => ({ at: t.timestamp, sol: sol(t.solAmount), tokens: Number(t.tokenAmount) / 1e6, signature: t.signature })) });
