#!/usr/bin/env node
/**
 * Title cards for `brand/x/video/launch-in-a-minute.mp4`: 1920×1080 PNGs in the night brand card's
 * styling (fonts and palette read from brand/x/src/announce-night.html so nothing is duplicated),
 * rendered with the same headless Chrome as the captures.
 *
 *   node scripts/src/record-demos-cards.mjs [--out brand/x/video/cards] [--chrome <chrome.exe>]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const OUT = path.resolve(ROOT, flag("out", "brand/x/video/cards"));
const CHROME = flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const PORT = Number(flag("port", "9334"));

const INK = "#0F100E";
const PAPER = "#F2F1EC";
const MUTED = "#85857C";
const ORANGE = "#FF5B1A";
const LINE = "#2A2B27";

/** Card copy (owner-approved): sentence case, numbers over adjectives, no price promises, never "profit share". */
const CARDS = [
  { file: "00-open", kicker: "Launch in a minute", title: "Back a token before it hits pump.fun", sub: "Backers fund the first buy. A rate-limited vault agent works the chart. Once the vault is 5× its start and the chart is strong, backers get paid back." },
  { file: "01-back", kicker: "01", title: "Back the raise", sub: "Pool SOL before the token exists. Miss the minimum and everyone is refunded in full." },
  { file: "02-bundle", kicker: "02", title: "The bundle is the first buy", sub: "Same transaction as the create: the token is made on pump.fun and the pooled SOL buys before any public trade can exist." },
  { file: "03-agent", kicker: "03", title: "The vault agent works the chart", sub: "Sells into strength, buys back dips. Every trade passes the program's band, cost and impact checks." },
  { file: "04-earn", kicker: "04", title: "Vault at 5× + strong chart → backers get paid", sub: "Principal first, then 15% of the vault every 4 h. Buying back a dip always comes first." },
  { file: "05-close", kicker: "holdfast.fun", title: "Hold fast.", sub: "holdfast.fun · program EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ · pump.fun venue · Squads multisig admin" },
];

function fontFaces() {
  const src = fs.readFileSync(path.join(ROOT, "brand/x/src/announce-night.html"), "utf8");
  return src.split("\n").filter((l) => l.startsWith("@font-face")).join("\n");
}

function logoSvg() {
  const src = fs.readFileSync(path.join(ROOT, "brand/x/src/announce-night.html"), "utf8");
  const m = /<div style="position:absolute;left:96px;top:84px;display:flex;align-items:center;gap:14px">([\s\S]*?)<\/div>/.exec(src);
  return m ? m[1] : "";
}

function html(card) {
  const open = card.file.startsWith("00") || card.file.startsWith("05");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;background:${INK};overflow:hidden;position:relative;color:${PAPER}}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95}
.ui{font-family:Mona,sans-serif}.mono{font-family:JBM,monospace}
.label{font-family:Mona,sans-serif;font-weight:600;font-size:22px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}}
</style></head><body>
<div style="position:absolute;left:120px;top:100px;display:flex;align-items:center;gap:16px;transform:scale(1.2);transform-origin:left top">${logoSvg()}</div>
<div class="label" style="position:absolute;right:120px;top:118px;display:flex;align-items:center;gap:12px"><span style="width:11px;height:11px;border-radius:11px;background:${ORANGE}"></span>${open ? "Live on Solana" : "holdfast.fun"}</div>
<div style="position:absolute;left:120px;right:120px;top:${open ? 380 : 360}px">
  <div class="${card.kicker.length <= 2 ? "disp" : "label"}" style="${card.kicker.length <= 2 ? `font-size:44px;color:${ORANGE}` : `font-size:24px;color:${ORANGE}`};margin-bottom:28px">${card.kicker}</div>
  <div class="disp" style="font-size:${card.title.length > 30 ? 96 : open ? 128 : 112}px;color:${PAPER};max-width:1680px">${card.title}</div>
  <div class="ui" style="font-size:36px;color:#A9A89F;max-width:1320px;line-height:1.4;margin-top:40px;${card.file.startsWith("05") ? `font-family:JBM,monospace;font-size:24px;color:${MUTED};max-width:1680px` : ""}">${card.sub}</div>
</div>
<div style="position:absolute;left:120px;right:120px;bottom:120px;border-top:1px solid ${LINE};padding-top:26px;display:flex;justify-content:space-between">
  <div class="mono" style="font-size:24px;color:${MUTED}">holdfast.fun</div>
  <div class="ui" style="font-size:24px;color:${MUTED}">Backers buy first. The vault agent works the chart.</div>
</div>
</body></html>`;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hf-cards-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, "profile")}`, "--window-size=1920,1080", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {
      await sleep(100);
    }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const cdp = new Cdp(ws);
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);
    for (const card of CARDS) {
      const file = path.join(tmp, `${card.file}.html`);
      fs.writeFileSync(file, html(card));
      await cdp.send("Page.navigate", { url: `file:///${file.replace(/\\/g, "/")}` }, sessionId);
      await sleep(700);
      await cdp.send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true }, sessionId);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
      const out = path.join(OUT, `${card.file}.png`);
      fs.writeFileSync(out, Buffer.from(data, "base64"));
      console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
    }
  } finally {
    ws.close();
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill();
    await exited;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
