// "N minutes in" dashboard post: the market (mcap, volume, trades, buyers, holders) and the vault (SOL in at launch
// against liquid SOL + tokens now, the tokens marked at the current price), from one indexer read.
//   node brand/x/src/dashboard.mjs [launch address]   # default: the HOLD launch
import { DIM, HOLD_LAUNCH, LINE, MUTED, ORANGE, PAPER, get, n0, n1, page, render, sol } from "./stat-card.mjs";

const LAUNCH = process.argv[2] ?? HOLD_LAUNCH;
const l = await get(`/api/launches/${LAUNCH}`);
const now = Math.floor(Date.now() / 1000);
const tag = `$${l.symbol}`;

const mins = Math.round((now - l.launchedAt) / 60);
const age = mins < 120 ? `${mins} minutes` : `${(mins / 60).toFixed(1)} hours`;
const vaultIn = sol(l.initialVaultSol);
const liquid = sol(l.vaultSol);
const tokens = Number(l.vaultTokens) / 1e6;
const tokensSol = tokens * l.priceSol;
const total = liquid + tokensSol;
const mult = total / vaultIn;
const market = [
  [n0(l.marketCapSol), "SOL mcap"],
  [n0(sol(l.volumeSol)), "SOL volume"],
  [n0(l.tradeCount), "trades"],
  [n0(l.buyers24h), "buyers"],
];

const style = `<style>
.vrow{position:absolute;left:96px;right:96px;top:430px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:48px}
.vrow .c{border-top:1px solid ${LINE};padding-top:22px}
.vrow .n{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95;font-size:92px;color:${PAPER}}
.vrow .n.o{color:${ORANGE}}
.vrow .l{font-size:32px;color:${MUTED};margin-top:14px}
.mrow{position:absolute;left:96px;right:96px;top:640px;display:grid;grid-template-columns:repeat(4,1fr);gap:40px}
.mrow .c{border-top:1px solid ${LINE};padding-top:18px}
.mrow .n{font-family:JBM,monospace;font-size:52px;color:${PAPER}}
.mrow .l{font-size:28px;color:${DIM};margin-top:8px}
</style>`;
const vcol = (n, label, o) => `<div class="c"><div class="n${o ? " o" : ""}">${n}</div><div class="l">${label}</div></div>`;

const cards = [
  {
    name: "dashboard",
    html: page(
      `${tag} · ${age} in`,
      `${style}
<div class="disp big" style="top:200px;font-size:96px">${n1(vaultIn)} SOL went in.<br>The vault holds <em>~${n0(total)} SOL</em>.</div>
<div class="vrow">${vcol(`${n1(liquid)}`, "SOL, liquid", true)}${vcol(`${n1(tokens / 1e6)}M`, `${tag} ≈ ${n0(tokensSol)} SOL now`)}${vcol(`${mult.toFixed(1)}×`, "of what went in")}</div>
<div class="mrow">${market.map(([n, label]) => `<div class="c"><div class="n">${n}</div><div class="l">${label}</div></div>`).join("")}</div>`,
      `tokens marked at the current price · vault withdrawals: ${n0(l.vaultWithdrawnSol)} SOL`,
    ),
  },
];

const text = `${tag}, ${age} in:

• ${n0(l.marketCapSol)} SOL mcap, ${n0(sol(l.volumeSol))} SOL volume
• ${n0(l.tradeCount)} trades, ${n0(l.buyers24h)} buyers
• Vault: ${n1(vaultIn)} SOL in → ${n1(liquid)} SOL + ${n1(tokens / 1e6)}M ${tag} now (~${n0(total)} SOL at today's price)
• ${n0(l.vaultWithdrawnSol)} SOL withdrawn

It sells the rips and buys the dips. All on chain.`;

render(now, cards, [
  {
    images: ["dashboard"],
    alt: [`${tag} ${age} in: ${n1(vaultIn)} SOL went into the vault, it holds ${n1(liquid)} SOL and ${n1(tokens / 1e6)}M ${tag} (about ${n0(total)} SOL); ${market.map(([n, label]) => `${n} ${label}`).join(", ")}`],
    text,
  },
], { launch: LAUNCH, liquid, tokens, tokensSol, total, priceSol: l.priceSol });
