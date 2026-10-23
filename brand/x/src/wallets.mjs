// "Who are the wallets selling?" post: the 15 agent wallets (platform.agent_executors) that execute the vault agent's
// trades, with each one's sells on a launch, its SOL fee float and its token balance, read once from the indexer and
// the chain. Two cards in one post: the explanation and the full list.
//   node brand/x/src/wallets.mjs [launch address]   # default: the HOLD launch
// RPC: see `rpc` in stat-card.mjs.
import { HOLD_LAUNCH, agentTrades, col, get, n0, n1, n2, page, render, rpc, sol } from "./stat-card.mjs";

const LAUNCH = process.argv[2] ?? HOLD_LAUNCH;

const [platform, l] = await Promise.all([get("/api/platform"), get(`/api/launches/${LAUNCH}`)]);
const wallets = platform.agentExecutors;
if (wallets.length !== 15) throw new Error(`expected 15 agent wallets, platform lists ${wallets.length}`);

const trades = await agentTrades(LAUNCH);
const strangers = trades.filter((t) => !wallets.includes(t.trader));
if (strangers.length) throw new Error(`agent trades by unregistered wallets: ${strangers.map((t) => t.signature).join(", ")}`);
const sells = trades.filter((t) => !t.isBuy);
const buys = trades.filter((t) => t.isBuy);
const soldSol = sells.reduce((acc, t) => acc + sol(t.solAmount), 0);

const balances = (await rpc("getMultipleAccounts", [wallets, { encoding: "base64" }])).value.map((a) => sol(a?.lamports ?? 0));
const held = [];
for (const w of wallets) {
  const accounts = (await rpc("getTokenAccountsByOwner", [w, { mint: l.mint }, { encoding: "jsonParsed" }])).value;
  held.push(accounts.reduce((acc, a) => acc + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0));
  await new Promise((r) => setTimeout(r, 250));
}
const rows = wallets.map((w, i) => ({
  w,
  sells: sells.filter((t) => t.trader === w).length,
  buys: buys.filter((t) => t.trader === w).length,
  sol: balances[i],
  held: held[i],
}));
const used = rows.filter((r) => r.sells + r.buys > 0).length;
const maxFloat = Math.max(...balances);
const totalHeld = held.reduce((a, b) => a + b, 0);
const now = Math.floor(Date.now() / 1000);
const sym = l.symbol;
const vaultIn = sol(l.initialVaultSol);
const vault = sol(l.vaultSol);
const tradeWord = buys.length ? `${n0(sells.length)} sells and ${n0(buys.length)} buys` : `${n0(sells.length)} sells`;

const cards = [
  {
    name: "wallets-who",
    html: page(
      `${sym} · agent wallets`,
      `<div class="disp big" style="font-size:96px">${used === 15 ? "15 wallets." : `${used} of 15 wallets.`}<br><em>One vault agent.</em></div>
<div class="sup" style="top:452px;font-size:34px">They sign the vault's trades and keep nothing: <b>the program checks every wallet ends each trade with exactly the SOL it started with.</b></div>
<div class="split" style="top:580px">${col(n0(sells.length), `${sym} sells`)}${col(n1(soldSol), "SOL back to the vault", true)}${col(n0(totalHeld), `${sym} held by them`)}</div>`,
      "platform account → agent_executors",
    ),
  },
  {
    name: "wallets-list",
    html: page(
      "All 15, from the platform account",
      `<div class="rows"><div class="h"><span>#</span><span>wallet</span><span class="r">${sym} sells</span><span class="r">SOL float</span><span class="r">${sym}</span></div>
${rows.map((r, i) => `<div><span class="i">${String(i + 1).padStart(2, "0")}</span><span>${r.w}</span><span class="r">${r.sells}</span><span class="r">${r.sol.toFixed(4)}</span><span class="r">${n0(r.held)}</span></div>`).join("\n")}
</div>`,
      "holdfast.fun/agents · read from chain",
    ),
  },
];

const text = `The ${used} wallets selling ${sym} are Holdfast's agent wallets: the vault agent executes its trades through them.

${tradeWord}, ${n1(soldSol)} SOL, every lamport back in the vault (${n1(vaultIn)} → ${n1(vault)} SOL).

Each holds ~${n2(maxFloat)} SOL for fees and ${n0(totalHeld)} ${sym}. All 15: holdfast.fun/agents`;

render(now, cards, [
  {
    images: cards.map((c) => c.name),
    alt: [
      `15 agent wallets, one vault agent: ${n0(sells.length)} ${sym} sells, ${n1(soldSol)} SOL back to the vault, ${n0(totalHeld)} ${sym} held`,
      `The 15 Holdfast agent wallets with their ${sym} sells, SOL fee float and ${sym} balance`,
    ],
    text,
  },
], { launch: LAUNCH, wallets: rows });
