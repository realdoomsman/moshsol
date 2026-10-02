// Builds the X image kit: eight 1600×900 cards (card-*.png, one idea each), the article cover (cover.png), and the
// profile banner (kit/banner.png, 1500×500) and avatar (kit/avatar.png, 1000×1000). Sources go to src/*.html.
// Fonts and the logo lockup are lifted from announce-night.html so everything shares its exact style.
//   node brand/x/src/cards.mjs            # writes the HTML sources
//   node brand/x/src/cards.mjs --render   # also renders the PNGs with headless Chrome at device scale 2
// Tech only: no mint, launch or transaction addresses anywhere. The program id and the admin multisig are the only
// addresses that appear (card-check).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..");
const night = readFileSync(join(here, "announce-night.html"), "utf8").split("\n");
const fonts = night.slice(1, 5).join("\n"); // the three @font-face rules (MonaDisplay, Mona, JBM)
const logo = night.find((l) => l.startsWith('<div style="position:absolute;left:96px;top:84px'));
if (!fonts.includes("@font-face") || !logo) throw new Error("announce-night.html layout changed");
const mark = logo.match(/<svg width="48"[\s\S]*?<\/svg>/)?.[0];
if (!mark) throw new Error("announce-night.html mark changed");

const INK = "#0F100E", PAPER = "#F2F1EC", MUTED = "#A9A89F", DIM = "#85857C", LINE = "#2A2B27", ORANGE = "#FF5B1A";

// One idea per card: a statement in large display type, one supporting line, one checkable detail in the footer.
// Smallest text is 30px at 1600×900 (≈ 11px in X's 600px timeline crop, 28px+ on a phone at 2×).
const css = `${fonts}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1600px;height:900px;background:${INK};overflow:hidden;position:relative;color:${PAPER};font-family:Mona,sans-serif}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95}
.label{font-weight:600;font-size:30px;letter-spacing:0.06em;text-transform:uppercase;color:${DIM}}
.tag{position:absolute;right:96px;top:98px;display:flex;align-items:center;gap:12px}
.tag i{width:12px;height:12px;border-radius:12px;background:${ORANGE};display:inline-block}
.big{position:absolute;left:92px;right:96px;top:250px;font-size:120px;color:${PAPER}}
.big em{font-style:normal;color:${ORANGE}}
.sup{position:absolute;left:96px;right:96px;font-size:38px;line-height:1.35;color:${MUTED}}
.sup b{font-weight:600;color:${PAPER}}
.foot{position:absolute;left:96px;bottom:44px;font-size:30px;color:${DIM};font-family:JBM,monospace;white-space:nowrap}
.sig{position:absolute;right:96px;bottom:42px;font-size:30px;color:${DIM}}
.steps{position:absolute;left:96px;right:96px;top:320px;display:grid;grid-template-columns:1fr 64px 1fr 64px 1fr 64px 1fr;align-items:start}
.steps .s .n{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95;font-size:72px;color:${ORANGE}}
.steps .s .t{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.03em;line-height:1;font-size:54px;color:${PAPER};margin-top:22px;min-height:110px}
.steps .s .d{font-size:32px;line-height:1.3;color:${MUTED};margin-top:18px}
.steps .arr{margin-top:118px;display:flex;justify-content:center}
.blocks{position:absolute;left:96px;right:96px;top:470px;display:grid;grid-template-columns:1fr 72px 1.3fr 72px 1fr;align-items:center}
.blk{border:1px solid ${LINE};padding:34px 36px;min-height:240px}
.blk.v{border-color:${ORANGE}}
.blk .label{margin-bottom:14px}
.blk .t{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.03em;line-height:1;font-size:52px;color:${PAPER}}
.blk .t em{font-style:normal;color:${ORANGE}}
.blk .d{font-size:32px;line-height:1.3;color:${MUTED};margin-top:14px}
.blocks .arr{display:flex;justify-content:center}
.split{position:absolute;left:96px;right:96px;top:300px;display:grid;grid-template-columns:repeat(3,1fr);gap:48px}
.split .c{border-top:1px solid ${LINE};padding-top:26px}
.split .n{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95;font-size:200px;color:${PAPER}}
.split .n.o{color:${ORANGE}}
.split .l{font-size:40px;color:${MUTED};margin-top:18px}
.split .l b{color:${PAPER};font-weight:600}
.list{position:absolute;left:92px;top:250px;font-size:88px;color:${PAPER}}
.list div{display:flex;align-items:baseline;gap:28px}
.list i{font-style:normal;font-family:JBM,monospace;font-size:44px;color:${ORANGE};letter-spacing:0}
.addr{position:absolute;left:96px;right:96px;font-family:JBM,monospace;font-size:34px;line-height:1.45;color:${PAPER}}
.addr span{color:${DIM}}
`;

const arrow = `<svg width="40" height="24" viewBox="0 0 40 24"><path d="M0 12H26" stroke="${ORANGE}" stroke-width="3"/><path d="M24 2L40 12L24 22Z" fill="${ORANGE}"/></svg>`;
const page = (tag, body, foot = "holdfast.fun") =>
  `<!doctype html><html><head><meta charset="utf-8"><style>\n${css}</style></head><body>\n${logo}\n</div>\n<div class="label tag"><i></i>${tag}</div>\n${body}\n<div class="foot">${foot}</div><div class="sig">Hold fast.</div></body></html>`;
const step = (n, t, d) => `<div class="s"><div class="n">${n}</div><div class="t">${t}</div><div class="d">${d}</div></div>`;
const arr = `<div class="arr">${arrow}</div>`;

// Numbers: README "Vault economics" / "Guarantees enforced in code" / "Vault agent", programs/moshsol/src/constants.rs
// (defaults and hard caps: creator fees 7500/1500/rest, payout 50000 bps / 1500 bps / 14400 s, floor 0.1 SOL), the
// platform account (launchFeeBps 100, createFeeLamports 20000000, maxRaise 50 SOL, maxWallet 5 SOL, minRaise 1 SOL,
// agent 1000/500 bps per 3600 s window, band 200, impact 300, EMA 1800 s) and previewPumpBundle (packages/sdk/src/math.ts)
// for the docs' 10 SOL example (30% reserve, no bundle cap — the bundle follows the raise, up to 75% of supply:
// 6.792 SOL bundle → 196,085,371 tokens = 19.6% of supply, 3.087 SOL reserve, 9.8796 SOL went in).
const cards = {
  "card-how": page(
    "How a launch works",
    `<div class="steps">
${step(1, "Raise", "Backers pool SOL before the token exists.")}
${arr}
${step(2, "Launch", "One instruction creates the token and makes the first buy with the pool.")}
${arr}
${step(3, "Vault agent", "Sells into strength, buys back dips. Everything stays in the vault.")}
${arr}
${step(4, "Paid back", "Once the vault is 5× liquid and the chart is strong.")}
</div>`,
    "beta: 1 SOL minimum raise · 50 SOL per launch · 5 SOL per wallet",
  ),

  "card-bundle": page(
    "The bundle",
    `<div class="disp big" style="top:230px;font-size:110px">Create, then Buy.<br>Nothing between.</div>
<div class="blocks" style="top:476px">
<div class="blk"><div class="label">In</div><div class="t">Backers' pool</div><div class="d">10 SOL raised</div></div>
${arr}
<div class="blk v"><div class="label" style="color:${ORANGE}">One instruction</div><div class="t">Create <em>→</em> Buy</div><div class="d">The token's first trade: 6.792 SOL → 19.6% of supply</div></div>
${arr}
<div class="blk"><div class="label">Out</div><div class="t">The vault</div><div class="d">Tokens + 3.087 SOL reserve. No wallet holds a key.</div></div>
</div>`,
    "bundle follows the raise, ≤ 75% of supply · never completes the curve",
  ),

  "card-vault": page(
    "The vault agent",
    `<div class="disp big">Sells into strength.<br>Buys back dips.</div>
<div class="sup" style="top:530px">Everything it sells for stays in the vault as SOL, and that SOL buys the next dip. <b>No profit split.</b> When the chart is quiet it makes small, spaced buys instead.</div>`,
    "≤ 3% price impact per trade · every decision at holdfast.fun/agents",
  ),

  "card-agent-rules": page(
    "Checked by the program on every trade",
    `<div class="disp big">Never sells at a loss.<br>Never buys high.</div>
<div class="sup" style="top:530px">A sell must fill <b>2% over the EMA</b> and <b>over the vault's average cost</b>. A buy must fill <b>2% under the EMA</b> and <b>at or below cost</b>. Any trade that fails a check fails on-chain.</div>`,
    "hourly: ≤ 10% of SOL, ≤ 5% of tokens · ≤ 3% impact · 0.1 SOL floor",
  ),

  "card-money": page(
    "pump.fun's creator fee, on every trade",
    `<div class="split">
<div class="c"><div class="n o">75%</div><div class="l"><b>Vault</b> · stays as SOL</div></div>
<div class="c"><div class="n">15%</div><div class="l"><b>Burn</b> · the Holdfast token</div></div>
<div class="c"><div class="n">10%</div><div class="l"><b>Backers</b> · claimable any time</div></div>
</div>
<div class="sup" style="top:690px">The creator's share is <b>0%</b>. Holdfast earns <b>1% of the raise + 0.02 SOL</b>, once, and none of the trading fees.</div>`,
    "frozen into every launch at creation",
  ),

  "card-payback": page(
    "When backers get paid back",
    `<div class="disp big">Paid back at <em>5×</em>.</div>
<div class="sup" style="top:420px">Once the vault's liquid SOL is <b>5× what went in</b> at launch and the chart is strong: <b>principal first</b>, then <b>15% of the vault</b>, at most <b>once per 4 h</b>.</div>
<div class="sup" style="top:600px">A dip always comes first. A due payout in a weak chart is skipped. Not a promise: many tokens never get there.</div>`,
    "10 SOL raise · 9.8796 SOL went in · payouts from 49.398 SOL liquid",
  ),

  "card-not": page(
    "Read before you back",
    `<div class="disp list" style="top:236px">
<div><i>01</i>Doesn't hold a price.</div>
<div><i>02</i>Doesn't promise a payout.</div>
<div><i>03</i>Doesn't lock the vault.</div>
<div><i>04</i>Doesn't let AI trade.</div>
</div>
<div class="sup" style="top:640px;font-size:34px">The admin (a 2-of-3 Squads multisig) and a single dev key can withdraw a vault; every withdrawal is an on-chain event on the launch page. No external audit yet.</div>`,
    "holdfast.fun/docs/risks",
  ),

  "card-check": page(
    "Mainnet · read it with any RPC",
    `<div class="disp big">Check it yourself.</div>
<div class="sup" style="top:410px">Open any launch page → <b>Verify on-chain</b>: no mint authority, no freeze, fixed supply, the vault's balance, read live. Its launch transaction is one instruction: Create, then Buy.</div>
<div class="addr" style="top:600px"><span>program</span>  EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ<br><span>admin  </span>  29dhkpFcpteUaEZkdooNCFdoGy8z4HBXPpjdAVG3bsT1<br><span>         Squads multisig, 2 of 3 · it and one dev key can withdraw a vault</span></div>`,
    "holdfast.fun/docs/verify",
  ),

  // Article cover: title + subtitle only.
  cover: page(
    "X article",
    `<div class="disp big" style="top:300px;font-size:150px">How Holdfast<br>works.</div>
<div class="sup" style="top:640px">Backers buy first, a vault agent works the chart, and every rule is an account you can open.</div>`,
    "holdfast.fun",
  ),
};

// Profile banner (1500×500) and avatar (1000×1000) for the new account.
const bannerHtml = `<!doctype html><html><head><meta charset="utf-8"><style>\n${fonts}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1500px;height:500px;background:${INK};overflow:hidden;position:relative;color:${PAPER};font-family:Mona,sans-serif}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95}
</style></head><body>
<div style="position:absolute;left:96px;top:140px;display:flex;align-items:center;gap:22px">${mark.replace('width="48" height="48"', 'width="72" height="72"')}</div>
<div class="disp" style="position:absolute;left:92px;top:236px;font-size:96px;color:${PAPER}">Backers buy first.</div>
<div style="position:absolute;right:96px;bottom:60px;font-family:JBM,monospace;font-size:28px;color:${DIM}">holdfast.fun</div>
</body></html>`;
const avatarHtml = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0}html,body{width:1000px;height:1000px;background:${INK};overflow:hidden}</style></head><body><div style="width:1000px;height:1000px;display:flex;align-items:center;justify-content:center"><svg width="660" height="660" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h10v5H8v16h5v5H3z" fill="${PAPER}"/><path d="M29 3H19v5h5v16h-5v5h10z" fill="${PAPER}"/><circle cx="16" cy="16" r="5.5" fill="${ORANGE}"/></svg></div></body></html>`;

const renders = [
  ...Object.entries(cards).map(([name, html]) => ({ src: `${name}.html`, png: `${name}.png`, html, w: 1600, h: 900 })),
  { src: "kit-banner.html", png: "kit/banner.png", html: bannerHtml, w: 1500, h: 500 },
  { src: "kit-avatar.html", png: "kit/avatar.png", html: avatarHtml, w: 1000, h: 1000, dpr: 1 },
];
for (const r of renders) writeFileSync(join(here, r.src), r.html);
console.log(`wrote ${renders.length} sources to ${here}`);

if (process.argv.includes("--render")) {
  const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  mkdirSync(join(out, "kit"), { recursive: true });
  for (const r of renders) {
    const png = join(out, r.png);
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${r.dpr ?? 2}`, `--window-size=${r.w},${r.h}`,
      `--screenshot=${png}`, `file:///${join(here, r.src).replace(/\\/g, "/")}`,
    ], { stdio: "ignore" });
    console.log(`rendered ${png}`);
  }
}
