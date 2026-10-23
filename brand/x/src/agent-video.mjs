// "The vault agent, trade by trade" video: the launch's 1-minute candles drawn left to right from launch to now with
// a rising 20-minute average, every vault agent trade popping in as it happened (sells above, buys below), a live
// market cap / sold / bought panel and trade tape, then an end card. All amounts in USD at the current SOL price.
// Audio: the kit's music bed plus a tick on every vault trade as its marker pops (sell ping, buy thump), see audio.mjs.
// 1920×1080, 30 fps, H.264 + AAC.
//   node brand/x/src/agent-video.mjs [launch address]   # default: the HOLD launch
// Frames: renderVideo in stat-card.mjs (canvas page in headless Chrome over CDP, encoded with ffmpeg).
import { rmSync } from "node:fs";
import { join } from "node:path";
import { bed, mix, mux, ticks } from "./audio.mjs";
import { DIM, HOLD_LAUNCH, INK, LINE, MUTED, ORANGE, PAPER, agentTrades, fonts, get, money, n0, outDir, render, renderVideo, sol } from "./stat-card.mjs";

// `--dip <minutes>`: only the last N minutes, the window's low marked with a line to now, no trend line, dip copy.
const args = process.argv.slice(2);
const dipAt = args.indexOf("--dip");
const DIP = dipAt >= 0 ? Number(args[dipAt + 1] ?? 30) : null;
const LAUNCH = args.find((a, i) => !a.startsWith("--") && i !== dipAt + 1) ?? HOLD_LAUNCH;
const W = 1920, H = 1080, FPS = 30;

// Launch counters and the trade list are two reads that can be a few seconds apart while the vault is trading;
// retry a few times for them to agree, then go with the trade list (every count and sum below comes from it).
let l, trades;
for (let attempt = 0; ; attempt++) {
  l = await get(`/api/launches/${LAUNCH}`);
  trades = await agentTrades(LAUNCH);
  const nb = trades.filter((t) => t.isBuy).length;
  if ((nb === l.agentBuys && trades.length - nb === l.agentSells) || attempt >= 4) break;
  await new Promise((r) => setTimeout(r, 4000));
}
const [{ candles }, { solUsd }] = await Promise.all([get(`/api/launches/${LAUNCH}/candles?tf=60`), get("/api/stats")]);
if (!solUsd) throw new Error("no SOL/USD price from the indexer");
const now = Math.floor(Date.now() / 1000);
const tag = `$${l.symbol}`;
const usd = (s) => s * solUsd;

const k = l.marketCapSol / l.priceSol; // price → market cap in SOL
const startMcap = usd(candles[0].open * k), nowMcap = usd(l.marketCapSol);
const mins = Math.round((now - l.launchedAt) / 60);
const age = mins < 60 ? `${mins} minutes` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

// The window drawn: launch to now, or the last DIP minutes.
const from = DIP ? Math.max(l.launchedAt, now - DIP * 60) : l.launchedAt;
const shown = candles.filter((c) => c.time + 60 > from);
const inWindow = trades.filter((t) => t.timestamp >= from);
const sells = inWindow.filter((t) => !t.isBuy), buys = inWindow.filter((t) => t.isBuy);
const soldUsd = usd(sells.reduce((a, t) => a + sol(t.solAmount), 0));
const boughtUsd = usd(buys.reduce((a, t) => a + sol(t.solAmount), 0));
const lowCandle = shown.reduce((a, c) => (c.low < a.low ? c : a));
const low = { t: lowCandle.time + 30, mcap: usd(lowCandle.low * k) };
const sinceLow = Math.max(1, Math.round((now - low.t) / 60));
const buysAfterHigh = buys.filter((t) => t.timestamp >= shown.reduce((a, c) => (c.high > a.high ? c : a)).time);
const dipBoughtUsd = usd(buysAfterHigh.reduce((a, t) => a + sol(t.solAmount), 0));

// Timeline (seconds of video): 0–1 intro, 1–12 sweep, 12.6 end card, 17 end.
const SECS = 17, sweepEnd = 12, endStart = 12.6;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Video second at which the sweep reaches chain time `t` (inverse of the page's eased cursor, by bisection). */
const videoAt = (t) => {
  const u = (t - from) / (now - from);
  let a = 0, b = 1;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; ease(m) < u ? (a = m) : (b = m); }
  return 1 + a * (sweepEnd - 1);
};

const data = {
  tag,
  launch: l.launchedAt,
  start: from,
  end: now,
  sweepEnd,
  endStart,
  k: k * solUsd, // price → market cap in USD
  nowMcap,
  trend: !DIP,
  low: DIP ? low : null,
  title: DIP ? "The dip, and who bought it." : "The vault agent, trade by trade.",
  tagText: `${tag} · ${DIP ? "the dip" : "vault agent"} · live`.toUpperCase(),
  legend: DIP ? "▼ vault sells into strength   ▲ vault buys the dip   - - window low" : "▼ vault sells into strength   ▲ vault buys the dip   — 20-min trend",
  end1: DIP ? `${money(low.mcap)} → ${money(nowMcap)}` : `${money(startMcap)} → ${money(nowMcap)}`,
  end2: DIP ? `market cap, low to now · ${sinceLow} minutes` : `market cap, launch to now · ${age}`,
  end3: DIP
    ? `${buysAfterHigh.length} vault buys into the dip · ${money(dipBoughtUsd)} · ${n0(l.vaultWithdrawnSol)} SOL withdrawn`
    : `${sells.length} sells into strength · ${buys.length} dip buys · ${n0(l.vaultWithdrawnSol)} SOL withdrawn`,
  candles: shown.map((c) => [c.time, c.open, c.high, c.low, c.close]),
  trades: inWindow.map((t) => [t.timestamp, t.isBuy ? 1 : 0, usd(sol(t.solAmount)), t.priceSol]),
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
html,body{margin:0;background:${INK};overflow:hidden}canvas{display:block}</style></head><body>
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
const D = ${JSON.stringify(data)};
const C = { INK: "${INK}", PAPER: "${PAPER}", MUTED: "${MUTED}", DIM: "${DIM}", LINE: "${LINE}", ORANGE: "${ORANGE}" };
const W = ${W}, H = ${H};
const cv = document.getElementById("c"), x = cv.getContext("2d");
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const out = (t) => 1 - Math.pow(1 - t, 3);
const money = ${money.toString()};
const mark = [new Path2D("M3 3h10v5H8v16h5v5H3z"), new Path2D("M29 3H19v5h5v16h-5v5h10z")];

// Chart geometry: time → x, log market cap → y.
const CX0 = 236, CX1 = 1290, CY0 = 300, CY1 = 900;
const lo = Math.min(...D.candles.map((c) => c[3]), ...D.trades.map((t) => t[3])) * D.k * 0.8;
const hi = Math.max(...D.candles.map((c) => c[2]), ...D.trades.map((t) => t[3])) * D.k * 1.25;
const tx = (t) => CX0 + ((t - D.start) / (D.end - D.start)) * (CX1 - CX0);
const my = (m) => CY1 - ((Math.log(m) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (CY1 - CY0);
const py = (p) => my(p * D.k);
const cw = Math.max(4, ((CX1 - CX0) / D.candles.length) * 0.62);
// 20-minute EMA of the closes, one point per candle.
const ema = (() => { const a = 2 / 21; let e = D.candles[0][1]; return D.candles.map((c) => (e = e + a * (c[4] - e), [c[0] + 60, e])); })();

function text(s, px, py_, font, color, align = "left", alpha = 1) {
  x.globalAlpha = alpha; x.font = font; x.fillStyle = color; x.textAlign = align; x.textBaseline = "alphabetic";
  x.fillText(s, px, py_); x.globalAlpha = 1;
}

function frame(s) {
  x.fillStyle = C.INK; x.fillRect(0, 0, W, H);
  const intro = out(clamp(s / 1.0));
  const sweep = ease(clamp((s - 1.0) / (D.sweepEnd - 1.0)));
  const endIn = out(clamp((s - D.endStart) / 0.8));
  const cursor = D.start + sweep * (D.end - D.start);
  const secsPerVideoSec = (D.end - D.start) / (D.sweepEnd - 1.0);

  // Header.
  x.save(); x.translate(96, 64); x.scale(1.5, 1.5); x.fillStyle = C.PAPER; mark.forEach((p) => x.fill(p));
  x.fillStyle = C.ORANGE; x.beginPath(); x.arc(16, 16, 5.5, 0, Math.PI * 2); x.fill(); x.restore();
  text("holdfast", 162, 105, "640 46px MonaDisplay", C.PAPER);
  const tagText = D.tagText;
  x.font = "600 26px Mona";
  x.fillStyle = C.ORANGE; x.beginPath(); x.arc(1824 - x.measureText(tagText).width - 20, 89, 7, 0, Math.PI * 2); x.fill();
  text(tagText, 1824, 98, "600 26px Mona", C.DIM, "right");
  text(D.title, 92, 220, "640 72px MonaDisplay", C.PAPER, "left", intro);

  const a = intro * (1 - 0.85 * endIn);

  // Grid at 1-2-5 market caps in USD, labelled left of the chart.
  text("MARKET CAP", CX0 - 20, CY0 - 18, "600 20px Mona", C.DIM, "right", a);
  x.strokeStyle = C.LINE; x.lineWidth = 1;
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5].map((q) => q * Math.pow(10, e))) {
    const y = my(m);
    if (y < CY0 || y > CY1) continue;
    x.globalAlpha = a; x.beginPath(); x.moveTo(CX0, y); x.lineTo(CX1, y); x.stroke();
    text(money(m), CX0 - 20, y + 8, "22px JBM", C.DIM, "right", a);
  }
  x.globalAlpha = a;

  // Candles up to the cursor; the open one grows with it.
  let mcapNow = D.candles[0][1] * D.k;
  for (const [t, o, h, lw, c] of D.candles) {
    if (t > cursor) break;
    const p = clamp((cursor - t) / 60);
    const close = o + (c - o) * p;
    mcapNow = close * D.k;
    const X = tx(t + 30), up = close >= o;
    x.strokeStyle = up ? "#A3A39A" : "#5C5D55"; x.fillStyle = x.strokeStyle; x.lineWidth = 2;
    x.beginPath(); x.moveTo(X, py(Math.max(h * p + o * (1 - p), o, close))); x.lineTo(X, py(Math.min(lw * p + o * (1 - p), o, close))); x.stroke();
    const y0 = py(Math.max(o, close)), y1 = py(Math.min(o, close));
    x.fillRect(X - cw / 2, y0, cw, Math.max(2, y1 - y0));
  }

  // Trend: the 20-minute average, glowing.
  const ep = D.trend ? ema.filter((p) => p[0] <= cursor) : [];
  if (ep.length > 1) {
    x.shadowColor = "rgba(255,91,26,0.7)"; x.shadowBlur = 14; x.strokeStyle = C.ORANGE; x.lineWidth = 4; x.lineJoin = "round"; x.globalAlpha = a * 0.9;
    x.beginPath(); ep.forEach(([t, v], i) => (i ? x.lineTo(tx(t), py(v)) : x.moveTo(tx(t), py(v)))); x.stroke(); x.shadowBlur = 0;
  }
  x.globalAlpha = a;

  // Vault trades: sells as orange triangles above the fill, buys as white triangles below; each pops when it lands.
  let sold = 0, bought = 0, nS = 0, nB = 0;
  const tape = [];
  for (const [t, isBuy, amt, price] of D.trades) {
    if (t > cursor) break;
    if (isBuy) { bought += amt; nB++; } else { sold += amt; nS++; }
    tape.push([t, isBuy, amt]);
    const age = (cursor - t) / secsPerVideoSec;
    const r = 6 + Math.sqrt(amt / 120) * 1.6;
    const X = tx(t), Y = py(price) + (isBuy ? r + 10 : -(r + 10));
    const pop = out(clamp(age / 0.25));
    x.fillStyle = isBuy ? C.PAPER : C.ORANGE;
    x.beginPath();
    if (isBuy) { x.moveTo(X, Y - r * pop); x.lineTo(X + r * pop, Y + r * pop * 0.8); x.lineTo(X - r * pop, Y + r * pop * 0.8); }
    else { x.moveTo(X, Y + r * pop); x.lineTo(X + r * pop, Y - r * pop * 0.8); x.lineTo(X - r * pop, Y - r * pop * 0.8); }
    x.closePath(); x.fill();
    if (age < 0.6) {
      x.strokeStyle = x.fillStyle; x.lineWidth = 3; x.globalAlpha = a * (1 - age / 0.6);
      x.beginPath(); x.arc(X, Y, r + age * 70, 0, Math.PI * 2); x.stroke(); x.globalAlpha = a;
    }
  }
  if (sweep >= 1) mcapNow = D.nowMcap;

  // Window low: a dashed line from the low to the right edge, labelled, once the sweep passes it.
  if (D.low && cursor >= D.low.t) {
    const la = a * out(clamp((cursor - D.low.t) / (secsPerVideoSec * 0.4)));
    const ly = my(D.low.mcap);
    x.globalAlpha = la; x.strokeStyle = C.PAPER; x.lineWidth = 2; x.setLineDash([10, 8]);
    x.beginPath(); x.moveTo(tx(D.low.t), ly); x.lineTo(CX1, ly); x.stroke(); x.setLineDash([]);
    text("low " + money(D.low.mcap), tx(D.low.t) + 14, ly + 34, "600 28px JBM", C.PAPER, "left", la);
  }

  // Cursor.
  if (sweep > 0 && sweep < 1) {
    x.strokeStyle = C.MUTED; x.lineWidth = 1; x.setLineDash([6, 8]);
    x.beginPath(); x.moveTo(tx(cursor), CY0); x.lineTo(tx(cursor), CY1); x.stroke(); x.setLineDash([]);
  }
  const m = Math.floor((cursor - D.launch) / 60);
  text(Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m after launch", CX1, CY0 - 18, "24px JBM", C.DIM, "right", a);
  text(D.legend, CX0, CY1 + 44, "24px JBM", C.MUTED, "left", a);

  // Panel.
  const PX = 1360;
  text("MARKET CAP", PX, 330, "600 24px Mona", C.DIM, "left", a);
  text(money(mcapNow), PX, 412, "640 84px MonaDisplay", C.ORANGE, "left", a);
  text("SOLD INTO STRENGTH", PX, 478, "600 24px Mona", C.DIM, "left", a);
  text(money(sold) + " · " + nS + " sells", PX, 522, "640 38px MonaDisplay", C.PAPER, "left", a);
  text("BOUGHT THE DIPS", PX, 586, "600 24px Mona", C.DIM, "left", a);
  text(money(bought) + " · " + nB + " buys", PX, 630, "640 38px MonaDisplay", C.PAPER, "left", a);
  x.strokeStyle = C.LINE; x.beginPath(); x.moveTo(PX, 666); x.lineTo(1824, 666); x.stroke();
  tape.slice(-6).reverse().forEach(([t, isBuy, amt], i) => {
    const mm = Math.floor((t - D.launch) / 60), ss = (t - D.launch) % 60;
    const y = 712 + i * 38, al = a * (i === 0 ? 1 : 0.85 - i * 0.1);
    text(isBuy ? "BUY " : "SELL", PX, y, "26px JBM", isBuy ? C.PAPER : C.ORANGE, "left", al);
    text(money(amt), PX + 110, y, "26px JBM", C.PAPER, "left", al);
    text("+" + mm + ":" + String(ss).padStart(2, "0"), 1824, y, "26px JBM", C.DIM, "right", al);
  });
  x.globalAlpha = 1;

  text("every marker = one on-chain vault trade · USD at today's SOL price · holdfast.fun/agents", 96, 1030, "24px JBM", C.DIM, "left", intro * (1 - endIn));
  text("Hold fast.", 1824, 1030, "26px Mona", C.DIM, "right", intro);

  // End card.
  if (endIn > 0) {
    const b = (q) => out(clamp((s - D.endStart - q * 0.35) / 0.6));
    x.fillStyle = "rgba(15,16,14," + (0.9 * endIn) + ")"; x.fillRect(0, 0, W, 1000);
    text(D.end1, 92, 470, "640 150px MonaDisplay", C.ORANGE, "left", b(0));
    text(D.end2, 96, 560, "500 50px Mona", C.PAPER, "left", b(1));
    text(D.end3, 96, 650, "500 40px Mona", C.MUTED, "left", b(2));
    text("holdfast.fun", 96, 830, "640 60px MonaDisplay", C.PAPER, "left", b(3));
  }
}
window.ready = Promise.all(["640 40px MonaDisplay", "600 24px Mona", "500 24px Mona", "24px JBM"].map((f) => document.fonts.load(f)));
window.shot = (s) => { frame(s); return cv.toDataURL("image/jpeg", 0.93); };
</script></body></html>`;

const out = outDir(now);
await renderVideo(out, "agent-video", html, { w: W, h: H, fps: FPS, secs: SECS, posterAt: sweepEnd });
const tickWav = ticks(inWindow.map((t) => ({ at: videoAt(t.timestamp), kind: t.isBuy ? "buy" : "sell" })), SECS, join(out, "agent-video-ticks.wav"));
const mixWav = mix({ music: bed("bundle"), ticksWav: tickWav, total: SECS, out: join(out, "agent-video-mix.wav") });
mux(join(out, "agent-video.mp4"), mixWav);
rmSync(tickWav);
rmSync(mixWav);

if (DIP && !buysAfterHigh.length) throw new Error("no vault buys since the window's high: the dip copy would be false");
const text = DIP
  ? `${tag} dipped hard. The vault was buying.

• Low: ${money(low.mcap)}. Now: ${money(nowMcap)}, ${sinceLow} min later
• ${buysAfterHigh.length} vault buys into the dip: ${money(dipBoughtUsd)}
• ${n0(l.buyers24h)} buyers vs ${n0(l.sellers24h)} sellers today
• ${n0(l.vaultWithdrawnSol)} SOL withdrawn

Every marker is an on-chain trade.`
  : `Watch the ${tag} vault agent trade.

${money(startMcap)} market cap at launch, ${money(nowMcap)} now, ${age} in.

• ${sells.length} sells into strength: ${money(soldUsd)}
• ${buys.length} dip buys: ${money(boughtUsd)}
• ${n0(l.vaultWithdrawnSol)} SOL withdrawn from the vault

Every marker is an on-chain trade.`;

render(now, [], [
  {
    images: ["agent-video.mp4"],
    alt: [DIP
      ? `${tag} candles for the last ${DIP} minutes with every vault agent trade: low ${money(low.mcap)}, ${money(nowMcap)} now, ${buysAfterHigh.length} vault buys into the dip`
      : `${tag} candles from launch to now with every vault agent trade: ${sells.length} sells, ${buys.length} buys; market cap ${money(startMcap)} at launch, ${money(nowMcap)} now`],
    text,
  },
], { launch: LAUNCH, solUsd, startMcap, nowMcap, dip: DIP, low, buysIntoDip: buysAfterHigh.length });
