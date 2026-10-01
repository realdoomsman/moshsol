// Builds the six X image cards (card-*.html → ../card-*.png).
// Fonts and the logo lockup are lifted from announce-night.html so the cards share its exact style.
//   node brand/x/src/cards.mjs            # writes the HTML sources
//   node brand/x/src/cards.mjs --render   # also renders 3200×1800 PNGs with headless Chrome (DPR 2)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..");
const night = readFileSync(join(here, "announce-night.html"), "utf8").split("\n");
const fonts = night.slice(1, 5).join("\n"); // the three @font-face rules (MonaDisplay, Mona, JBM)
const logo = night.find((l) => l.startsWith('<div style="position:absolute;left:96px;top:84px'));
if (!fonts.includes("@font-face") || !logo) throw new Error("announce-night.html layout changed");

const INK = "#0F100E", PAPER = "#F2F1EC", MUTED = "#A9A89F", DIM = "#85857C", LINE = "#2A2B27", ORANGE = "#FF5B1A";

// Every text size is ≥ 28px at 1600×900 so the cards stay legible in X's 600px-wide timeline crop.
const css = `${fonts}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1600px;height:900px;background:${INK};overflow:hidden;position:relative;color:${PAPER};font-family:Mona,sans-serif}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95}
.mono{font-family:JBM,monospace}
.label{font-weight:600;font-size:28px;letter-spacing:0.06em;text-transform:uppercase;color:${DIM}}
.tag{position:absolute;right:96px;top:98px;display:flex;align-items:center;gap:12px}
.tag i{width:12px;height:12px;border-radius:12px;background:${ORANGE};display:inline-block}
.h{position:absolute;left:92px;top:190px;font-size:72px;color:${PAPER};white-space:nowrap}
.sub{position:absolute;left:96px;top:274px;font-size:30px;color:${MUTED};line-height:1.4;white-space:nowrap}
.rows{position:absolute;left:96px;right:96px;top:340px}
.row{display:grid;grid-template-columns:1fr auto;gap:40px;align-items:baseline;border-top:1px solid ${LINE};padding:13px 0 12px}
.row.one{grid-template-columns:1fr}
.row .k{font-size:30px;color:${MUTED};line-height:1.3}
.row .k b{font-weight:600;color:${PAPER}}
.row .v{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.03em;font-size:36px;color:${PAPER};white-space:nowrap;text-align:right}
.row .v.o{color:${ORANGE}}
.row .v.m{font-family:JBM,monospace;font-weight:400;letter-spacing:0;font-size:30px;text-align:left}
.row.addr{grid-template-columns:560px 1fr;align-items:center;padding:12px 0 11px}
.row.addr .k{font-size:28px}
.foot{position:absolute;left:96px;bottom:40px;font-size:28px;color:${DIM};font-family:JBM,monospace;white-space:nowrap}
.sig{position:absolute;right:96px;bottom:38px;font-size:28px;color:${DIM}}
.tiles{position:absolute;left:96px;right:96px;display:grid;gap:48px}
.tile{border-top:1px solid ${LINE};padding-top:18px}
.tile .n{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95;font-size:64px;color:${PAPER};margin-top:12px}
.tile .n.o{color:${ORANGE}}
.col{position:absolute;top:290px;width:656px}
.col .item{border-top:1px solid ${LINE};padding:14px 0 12px;font-size:30px;line-height:1.3;color:${MUTED}}
.col .item b{color:${PAPER};font-weight:600}
.col .label{padding-bottom:12px}
`;

const row = (k, v, cls = "") =>
  v === "" ? `<div class="row one"><div class="k">${k}</div></div>` : `<div class="row"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
const stack = (k, v) => `<div class="row addr"><div class="k">${k}</div><div class="v m">${v}</div></div>`;
const page = (tag, title, body, foot = "holdfast.fun") =>
  `<!doctype html><html><head><meta charset="utf-8"><style>\n${css}</style></head><body>\n${logo}\n</div>\n<div class="label tag"><i></i>${tag}</div>\n<div class="disp h">${title}</div>\n${body}\n<div class="foot">${foot}</div><div class="sig">Hold fast.</div></body></html>`;

// Numbers: platform account 449KHjhaaW58syfaWstZDzcUwTW613XbVB7S6Zp1gpZe via https://api.holdfast.fun/api/platform
// (launchFeeBps 100, createFeeLamports 20000000, burnShareBps 2500, maxRaise 50 SOL, maxWallet 5 SOL, minRaise 1 SOL,
// agentBuyBpsPerWindow 1000, agentSellBpsPerWindow 500, agentMaxImpactBps 300, agentBandBps 200, agentWindowSecs 3600,
// emaPeriodSecs 1800), programs/moshsol/src/constants.rs (hard caps, wind-down), apps/agent/src/strategy.ts DEFAULT_PARAMS,
// previewPumpBundle (packages/sdk/src/math.ts) for a 50 SOL raise with the create wizard's default 30% reserve / 15% bundle,
// and mainnet RPC reads of the $HFPUMP accounts on 2026-10-01.
const cards = {
  "card-money": page(
    "Mainnet · read from the platform account",
    "Where the money goes",
    `<div class="sub">Every launch is a pump.fun token; Holdfast only routes what reaches the launch.</div>
<div class="rows">
${row("Vault agent's realized profit (sell fill − average cost)", "75% backers · 25% buyback-and-burn", "o")}
${row("pump.fun's creator fee, every trade", "75% vault SOL · 25% buyback-and-burn")}
${row("Creator's share of fees", "0%")}
${row("Holdfast's share of trading fees", "0%")}
${row("Holdfast earns, once per launch", "1% of the raise + 0.02 SOL create fee")}
${row("Minimum missed, or raise cancelled", "100% refund, no fee")}
</div>`,
    "api.holdfast.fun/api/platform · burnShareBps 2500 · launchFeeBps 100",
  ),

  "card-bundle-math": page(
    "Beta caps · 50 SOL per launch · 5 SOL per wallet",
    "Bundle math at the beta cap",
    `<div class="sub">A 50 SOL raise on the default terms: 30% reserve, bundle capped at 15% of supply.</div>
<div class="rows">
${row("Raised", "50 SOL")}
${row("Launch fee, 1%, to Holdfast", "−0.5 SOL")}
${row("pump.fun create rent", "−0.0204 SOL")}
${row("The bundle: the first buy on pump.fun, <b>hits the 15% cap</b>", "4.936 SOL → 150,000,000 tokens", "o")}
${row("Stays in the vault as SOL for dip buys", "44.543 SOL")}
${row("Vault's average cost · market cap after the bundle", "3.29 × 10⁻⁸ SOL/token · ≈ 37.8 SOL")}
</div>`,
    "previewPumpBundle · a 10 SOL raise buys the same 150M and keeps 4.943",
  ),

  "card-agent-rules": page(
    "Checked by the program on every trade",
    "Two checks on every vault agent trade",
    `<div class="col" style="left:96px">
<div class="label">Sell, into a rally</div>
<div class="item">Fill ≥ <b>2% above the EMA</b> of the venue price</div>
<div class="item">Fill ≥ <b>2% above the vault's average cost</b>: it never realizes a loss</div>
<div class="item">≤ <b>5% of vault tokens</b> per 1 h window</div>
<div class="item">≤ <b>3% price impact</b> per trade</div>
</div>
<div class="col" style="left:848px">
<div class="label">Buy, into a dip</div>
<div class="item">Fill ≥ <b>2% under the EMA</b></div>
<div class="item">Fill ≤ <b>average cost</b>, or a buy-back ≥ 2% under its average sell, paid from its own sales</div>
<div class="item">≤ <b>10% of vault SOL</b> per 1 h window</div>
<div class="item">≤ <b>3% price impact</b> per trade</div>
</div>
<div class="rows" style="top:676px">
${row("Agent policy on top: near the launch price with little volume it sells <b>≤ 1 SOL per hour</b>. The allowance grows only with market cap and traded volume, ×6.63 into strong buy flow", "")}
</div>`,
    "EMA += (spot − EMA) · dt/(dt+1800s) · hard caps 20%/window, 10% impact",
  ),

  "card-not": page(
    "Read before you back",
    "What Holdfast doesn't do",
    `<div class="rows" style="top:292px">
${row("<b>Hold a price.</b> Anyone else can sell at any time. The vault agent only buys below its own cost, inside its hourly budget", "")}
${row("<b>Lock the vault.</b> The admin, a 2-of-3 Squads multisig, can withdraw a vault. It did once, on $HFPUMP: 0.351 SOL + 21.95M tokens, listed on the launch page", "")}
${row("<b>Have an external audit.</b> The program is unaudited, and upgradeable by the same multisig", "")}
${row("<b>Run the agent on-chain.</b> It's an off-chain service. The rules it must pass are in the program", "")}
${row("<b>Set pump.fun's fees.</b> The trade fee and the creator share on every trade are pump.fun's", "")}
${row("<b>Burn yet.</b> The 25% buyback pool accrues until the Holdfast token mint is set", "")}
</div>`,
    "holdfast.fun/docs/risks · every withdrawal is a VaultWithdrawn event",
  ),

  "card-refund-winddown": page(
    "Two ways SOL goes back to backers",
    "Miss the minimum, or go quiet",
    `<div class="col" style="left:96px">
<div class="label">Raise misses its minimum</div>
<div class="item">Deadline passes under the minimum, or the creator cancels before launch</div>
<div class="item">Every backer refunds <b>100%</b>. No fee, no deadline, rent returned</div>
<div class="item">Pausing the platform never blocks refunds</div>
</div>
<div class="col" style="left:848px">
<div class="label">Launch goes quiet</div>
<div class="item">Live ≥ <b>3 days</b> · no vault trade for <b>24 h</b> · nothing held outside pump.fun's curve and the vault</div>
<div class="item"><b>Anyone</b> can call wind_down_pump</div>
<div class="item">Vault tokens sold into the venue; <b>all vault SOL</b> to backers pro-rata. Trading stops for good</div>
</div>
<div class="tiles" style="top:664px;grid-template-columns:repeat(3,1fr)">
<div class="tile"><div class="label">Refund</div><div class="n o">100%</div></div>
<div class="tile"><div class="label">Wind-down after</div><div class="n">3 days</div></div>
<div class="tile"><div class="label">Idle for</div><div class="n">24 h</div></div>
</div>`,
    "WIND_DOWN_MIN_AGE_SECS 259200 · WIND_DOWN_IDLE_SECS 86400",
  ),

  "card-check": page(
    "Mainnet · read it with any RPC",
    "Check it yourself",
    `<div class="rows" style="top:282px">
${stack("Program · executable · upgrade authority is the admin's Squads vault", "EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ")}
${stack("$HFPUMP mint · supply 1,000,000,000 · <b>mint authority none · freeze none</b>", "GyHYt6bjNkXVmECCuzKsMuZLXW8T8L6g8oTH7hhyxnPy")}
${stack("$HFPUMP launch · terms frozen: 2% band · 1 h window · 10% / 5% budgets · 3% impact", "Yw9a3uqxNVDhfD7FBmcbAeZAn81nRuG3Q1K3GDLJfYs")}
${stack("$HFPUMP vault · token account of the launch's pump-authority PDA · admin can withdraw", "55xnr1fcoQbuzobTpQTMZPPguYyf8YnLVKDAkzcd12yj")}
${stack("Platform admin · Squads v4 multisig, 2 of 3 · the only key allowed to withdraw a vault", "29dhkpFcpteUaEZkdooNCFdoGy8z4HBXPpjdAVG3bsT1")}
</div>`,
    "holdfast.fun/docs/verify · getAccountInfo via api.holdfast.fun/rpc",
  ),
};

for (const [name, html] of Object.entries(cards)) writeFileSync(join(here, `${name}.html`), html);
console.log(`wrote ${Object.keys(cards).length} card sources to ${here}`);

if (process.argv.includes("--render")) {
  const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  for (const name of Object.keys(cards)) {
    const png = join(out, `${name}.png`);
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=1600,900",
      `--screenshot=${png}`, `file:///${join(here, `${name}.html`).replace(/\\/g, "/")}`,
    ], { stdio: "ignore" });
    console.log(`rendered ${png}`);
  }
}
