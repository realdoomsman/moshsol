// "N× since launch" post: market cap from the first 1-minute candle's open to now as a log-scale area chart, the
// market (volume, trades, buyers vs sellers, holders) and the vault's dip buys and holdings, from one indexer read.
//   node brand/x/src/momentum.mjs [launch address]   # default: the HOLD launch
import { DIM, HOLD_LAUNCH, LINE, MUTED, ORANGE, PAPER, get, n0, n1, page, render, sol } from "./stat-card.mjs";

const LAUNCH = process.argv[2] ?? HOLD_LAUNCH;
const [l, { candles }, { solUsd }] = await Promise.all([
  get(`/api/launches/${LAUNCH}`),
  get(`/api/launches/${LAUNCH}/candles?tf=60`),
  get("/api/stats"),
]);
const now = Math.floor(Date.now() / 1000);
const tag = `$${l.symbol}`;
const mcapPerPrice = l.marketCapSol / l.priceSol;

const mins = Math.round((now - l.launchedAt) / 60);
const age = mins < 120 ? `${mins} minutes` : `${(mins / 60).toFixed(1)} hours`;
const startMcap = candles[0].open * mcapPerPrice;
const mult = l.marketCapSol / startMcap;
const vaultTokens = Number(l.vaultTokens) / 1e6;

// Log-scale area chart of closes (first point = the first candle's open), 1408×230 at (96, 360).
const CW = 1408, CH = 230;
const pts = [[candles[0].time, candles[0].open], ...candles.map((c) => [c.time + 60, c.close])];
pts[pts.length - 1] = [now, l.priceSol];
const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
const lo = Math.log(Math.min(...pts.map((p) => p[1]))), hi = Math.log(Math.max(...pts.map((p) => p[1])));
const xy = pts.map(([t, p]) => [((t - t0) / (t1 - t0)) * CW, CH - ((Math.log(p) - lo) / (hi - lo)) * (CH - 20) - 10]);
const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
const [ex, ey] = xy[xy.length - 1];
const chart = `<svg style="position:absolute;left:96px;top:356px" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.35"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/></linearGradient></defs>
<path d="${line}L${CW},${CH}L0,${CH}Z" fill="url(#g)"/>
<path d="${line}" fill="none" stroke="${ORANGE}" stroke-width="4" stroke-linejoin="round"/>
<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="9" fill="${ORANGE}"/>
<line x1="0" y1="${CH}" x2="${CW}" y2="${CH}" stroke="${LINE}"/>
</svg>
<div style="position:absolute;left:96px;top:596px;font-family:JBM,monospace;font-size:24px;color:${DIM}">launch · ${n0(startMcap)} SOL mcap</div>
<div style="position:absolute;right:96px;top:596px;font-family:JBM,monospace;font-size:24px;color:${PAPER}">now · ${n0(l.marketCapSol)} SOL mcap</div>`;

const stats = [
  [n0(sol(l.volumeSol)), "SOL volume"],
  [n0(l.buyers24h), "buyers"],
  [n0(l.holders), "holders"],
  [n0(l.agentBuys), "vault dip buys"],
];
const row = `<style>
.mrow{position:absolute;left:96px;right:96px;top:654px;display:grid;grid-template-columns:repeat(4,1fr);gap:40px}
.mrow .c{border-top:1px solid ${LINE};padding-top:18px}
.mrow .n{font-family:JBM,monospace;font-size:50px;color:${PAPER}}
.mrow .l{font-size:28px;color:${MUTED};margin-top:8px}
</style>
<div class="mrow">${stats.map(([n, label]) => `<div class="c"><div class="n">${n}</div><div class="l">${label}</div></div>`).join("")}</div>`;

const cards = [
  {
    name: "momentum",
    html: page(
      `${tag} · ${age} in`,
      `<div class="disp big" style="top:196px;font-size:120px"><em>${Math.floor(mult)}×</em> since launch.</div>
${chart}
${row}`,
      `vault: ${n1(sol(l.vaultSol))} SOL + ${n1(vaultTokens / 1e6)}M ${tag} · withdrawn: ${n0(l.vaultWithdrawnSol)} SOL`,
    ),
  },
];

const usd = solUsd ? ` (~$${n0((l.marketCapSol * solUsd) / 1000)}K)` : "";
const text = `${tag}: ${Math.floor(mult)}× since launch, ${age} in.

• ${n0(l.marketCapSol)} SOL mcap${usd}
• ${n0(sol(l.volumeSol))} SOL volume, ${n0(l.tradeCount)} trades
• ${n0(l.buyers24h)} buyers vs ${n0(l.sellers24h)} sellers
• The vault bought ${n0(l.agentBuys)} dips (${n0(sol(l.agentSolSpent))} SOL) and holds ${n1(vaultTokens / 1e6)}M ${tag} in reserve
• ${n0(l.vaultWithdrawnSol)} SOL withdrawn

Sells the rips. Buys the dips.`;

render(now, cards, [
  {
    images: ["momentum"],
    alt: [`${tag} market cap from ${n0(startMcap)} SOL at launch to ${n0(l.marketCapSol)} SOL now, ${Math.floor(mult)}× in ${age}; ${stats.map(([n, label]) => `${n} ${label}`).join(", ")}`],
    text,
  },
], { launch: LAUNCH, startMcap, mcap: l.marketCapSol, mult });
