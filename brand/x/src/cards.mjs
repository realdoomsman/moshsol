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
.box{position:absolute;top:340px;width:380px;height:300px;border:1px solid ${LINE};padding:26px 26px 0}
.box.v{border-color:${ORANGE}}
.box .label{padding-bottom:12px}
.box .t{font-size:28px;line-height:1.3;color:${MUTED}}
.box .t b{color:${PAPER};font-weight:600}
.arrow{position:absolute;overflow:visible}
.alab{position:absolute;font-size:28px;color:${DIM};white-space:nowrap;text-align:center}
`;

const row = (k, v, cls = "") =>
  v === "" ? `<div class="row one"><div class="k">${k}</div></div>` : `<div class="row"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
const stack = (k, v) => `<div class="row addr"><div class="k">${k}</div><div class="v m">${v}</div></div>`;
const page = (tag, title, body, foot = "holdfast.fun") =>
  `<!doctype html><html><head><meta charset="utf-8"><style>\n${css}</style></head><body>\n${logo}\n</div>\n<div class="label tag"><i></i>${tag}</div>\n<div class="disp h">${title}</div>\n${body}\n<div class="foot">${foot}</div><div class="sig">Hold fast.</div></body></html>`;

// A horizontal arrow (x1 → x2 at y) with its caption above; used by the vault state diagram.
const arrow = (x1, x2, y, label) =>
  `<svg class="arrow" style="left:${x1}px;top:${y - 10}px" width="${x2 - x1}" height="20" viewBox="0 0 ${x2 - x1} 20"><path d="M0 10H${x2 - x1 - 14}" stroke="${ORANGE}" stroke-width="3"/><path d="M${x2 - x1 - 16} 2L${x2 - x1} 10L${x2 - x1 - 16} 18Z" fill="${ORANGE}"/></svg>
<div class="alab" style="left:${x1 - 60}px;width:${x2 - x1 + 120}px;top:${y - 56}px">${label}</div>`;

// Numbers: README "Vault economics" / "Guarantees enforced in code" / "Vault agent", programs/moshsol/src/constants.rs
// (defaults and hard caps: creator fees 7500/1500/rest, payout 50000 bps / 1500 bps / 14400 s, floor 0.1 SOL, dead holders
// 500 bps, wind-down 3 d / 24 h), the platform account 449KHjhaaW58syfaWstZDzcUwTW613XbVB7S6Zp1gpZe (launchFeeBps 100,
// createFeeLamports 20000000, maxRaise 50 SOL, maxWallet 5 SOL, minRaise 1 SOL, agent 1000/500 bps per 3600 s window,
// band 200, impact 300, EMA 1800 s), apps/agent/src/strategy.ts DEFAULT_PARAMS + PAYOUT_GATE (sell ramp, support mode,
// payout market gate), previewPumpBundle (packages/sdk/src/math.ts) for the docs' 10 SOL example (30% reserve, 15% bundle
// cap: 4.936 SOL bundle, 4.943 SOL reserve, initial_vault_sol 9.8796 SOL, 5× = 49.398 SOL) and mainnet reads of the
// $HFPUMP accounts on 2026-10-01 (api.holdfast.fun/api/launches/Yw9a3…, still showing the pre-upgrade layout).
const cards = {
  "card-money": page(
    "Frozen into every launch at creation",
    "Where the money goes",
    `<div class="sub">Every launch is a pump.fun token; Holdfast only routes what reaches the launch.</div>
<div class="rows">
${row("pump.fun's creator fee", "75% vault SOL · 15% buyback-and-burn · 10% backers", "o")}
${row("What the vault agent sells for", "100% stays in the vault")}
${row("Creator's share of fees", "0%")}
${row("Holdfast's share of trading fees", "0%")}
${row("Holdfast earns, once per launch", "1% of the raise + 0.02 SOL create fee")}
${row("Minimum missed, or raise cancelled", "100% refund, no fee")}
</div>`,
    "collect_pump_fees · creator_fee_vault_bps 7500 · burn_share_bps 1500",
  ),

  "card-vault": page(
    "One vault per launch · SOL + tokens",
    "What the vault agent does",
    `<div class="sub">The bundle is the vault's inventory. Everything it sells stays in the vault; backers are paid out of it only at 5×.</div>
<div class="box" style="left:96px"><div class="label">Chart strong</div>
<div class="t"><b>Sells slowly into strength.</b> More as the market-cap multiple and real buy volume grow; never more than 3% impact per trade.</div></div>
${arrow(486, 600, 490, "SOL in")}
<div class="box v" style="left:610px"><div class="label" style="color:${ORANGE}">The vault</div>
<div class="t"><b>Keeps all it sells for.</b> No profit split. Pays backers only once liquid SOL is 5× what went in. Keeps a 0.1 SOL floor.</div></div>
${arrow(1000, 1114, 490, "tokens in")}
<div class="alab" style="left:940px;width:234px;top:506px">SOL out</div>
<div class="box" style="left:1124px"><div class="label">Dip, or quiet</div>
<div class="t"><b>Buys the dip back</b> under the EMA band, at or below cost or under its average sell. Small, spaced buys when the chart is quiet.</div></div>
<svg class="arrow" style="left:286px;top:640px" width="1028" height="60" viewBox="0 0 1028 60"><path d="M1028 0V36H0V18" stroke="${LINE}" stroke-width="3" fill="none"/><path d="M-8 22L0 0L8 22Z" fill="${DIM}"/></svg>
<div class="alab" style="left:286px;width:1028px;top:688px">Repeats as long as the token trades · the vault is meant to grow</div>`,
    "agent_sell_pump · agent_buy_pump · payout_backers · holdfast.fun/agents",
  ),

  "card-payback": page(
    "On-chain rule · payout_backers",
    "When backers get paid back",
    `<div class="sub">Opportunistic, not a promise: the vault must have grown first, and the chart must be strong at the check.</div>
<div class="tiles" style="top:340px;grid-template-columns:repeat(4,1fr)">
<div class="tile"><div class="label">Liquid vault SOL</div><div class="n o">5×</div></div>
<div class="tile"><div class="label">First payout</div><div class="n">Principal</div></div>
<div class="tile"><div class="label">Then, per payout</div><div class="n">15%</div></div>
<div class="tile"><div class="label">Between payouts</div><div class="n">≥ 4 h</div></div>
</div>
<div class="rows" style="top:528px">
${row("Only the vault agent may crank it, only into a strong chart: <b>above the EMA band, net buying on strong volume, above the 30 min VWAP and the launch price, within 20% of the 24 h high</b>", "")}
${row("<b>A dip comes first.</b> A due payout in a weak chart is skipped and the SOL buys the dip. Tokens never count toward the 5×", "")}
${row("The vault keeps a <b>0.1 SOL floor</b> no payout or buy may go below", "")}
</div>`,
    "10 SOL raise · 9.8796 SOL went in · payouts from 49.398 SOL liquid",
  ),

  "card-agent-rules": page(
    "Checked by the program on every trade",
    "What every vault agent trade must pass",
    `<div class="col" style="left:96px">
<div class="label">Sell, into a rally</div>
<div class="item">Fill ≥ <b>2% over the EMA</b> of the venue price</div>
<div class="item">Fill ≥ <b>2% over the vault's average cost</b></div>
<div class="item">≤ <b>5% of vault tokens</b> per 1 h · ≤ <b>3% impact</b></div>
<div class="item">The whole fill <b>stays in the vault</b> as SOL</div>
</div>
<div class="col" style="left:848px">
<div class="label">Buy, into a dip</div>
<div class="item">Fill ≥ <b>2% under the EMA</b></div>
<div class="item">Fill ≤ <b>average cost</b>, or a buy-back ≥ 2% under its average sell</div>
<div class="item">≤ <b>10% of vault SOL</b> per 1 h · ≤ <b>3% impact</b></div>
<div class="item">Never below the <b>0.1 SOL vault floor</b></div>
</div>
<div class="rows" style="top:664px">
${row("One key may trade, crank <b>payout_backers</b> and <b>buyback_burn</b>, nothing else: it can't withdraw. On the Holdfast curve a vault trade can't share a slot with a public trade; on pump.fun its slippage floor is checked on the measured fill", "")}
</div>`,
    "EMA += (spot − EMA) · dt/(dt+1800s) · hard caps 20%/window, 10% impact",
  ),

  "card-not": page(
    "Read before you back",
    "What Holdfast doesn't do",
    `<div class="rows" style="top:292px">
${row("<b>Hold a price.</b> Anyone else can sell at any time. The vault agent buys only under the EMA band, at or below its cost or under its average sell, inside an hourly budget", "")}
${row("<b>Promise a payout.</b> Backers are paid only once the vault's liquid SOL is 5× what went in and the chart is strong. Many tokens never get there", "")}
${row("<b>Lock the vault.</b> The admin, a 2-of-3 Squads multisig, can withdraw a vault. Every withdrawal is an on-chain event, listed on the launch page", "")}
${row("<b>Have an external audit.</b> The program is unaudited, and upgradeable by the same multisig", "")}
${row("<b>Let AI trade.</b> The AI only narrates decisions and re-tunes knobs inside bounds the program caps", "")}
${row("<b>Burn yet.</b> The 15% buyback pool accrues until the Holdfast token mint is set", "")}
</div>`,
    "holdfast.fun/docs/risks · every withdrawal is a VaultWithdrawn event",
  ),

  "card-check": page(
    "Mainnet · read it with any RPC",
    "Check it yourself",
    `<div class="rows" style="top:282px">
${stack("Program · executable · upgrade authority is the admin's Squads vault", "EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ")}
${stack("$HFPUMP mint · supply 1,000,000,000 · <b>mint authority none · freeze none</b>", "GyHYt6bjNkXVmECCuzKsMuZLXW8T8L6g8oTH7hhyxnPy")}
${stack("$HFPUMP launch · terms frozen: 2% band · 1 h window · 10% / 5% budgets · 3% impact", "Yw9a3uqxNVDhfD7FBmcbAeZAn81nRuG3Q1K3GDLJfYs")}
${stack("$HFPUMP launch tx · one LaunchPump instruction: pump.fun's <b>Create + the bundle Buy</b>", "TnjK9WUN…yyYPnkN")}
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
