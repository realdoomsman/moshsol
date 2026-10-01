#!/usr/bin/env node
/**
 * Title cards for `brand/x/video/final/holdfast-explainer.mp4`: 1920×1080 PNGs in the night brand card's
 * styling (fonts and palette read from brand/x/src/announce-night.html so nothing is duplicated),
 * rendered with the same headless Chrome as the captures. The five beats mirror the voiceover of
 * `record-demos-final.mjs`, which imports the Chrome helpers from here for its lower-thirds and motion pages.
 *
 *   node scripts/src/record-demos-cards.mjs [--out brand/x/video/cards] [--chrome <chrome.exe>]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const OUT = path.resolve(ROOT, flag("out", "brand/x/video/cards"));
const CHROME = flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const PORT = Number(flag("port", "9334"));

export const INK = "#0F100E";
export const PAPER = "#F2F1EC";
export const MUTED = "#85857C";
export const ORANGE = "#FF5B1A";
export const LINE = "#2A2B27";

/** Card copy (owner-approved voice): sentence case, numbers over adjectives, no price promises, "paid back" always conditional. */
export const CARDS = [
  { file: "00-open", kicker: "Holdfast", title: "Back a token before it hits pump.fun", sub: "Your SOL makes the first buy. At 5×, backers are paid back." },
  { file: "01-back", kicker: "01", title: "Back the raise", sub: "Pool SOL before the token exists. Miss the minimum, full refund." },
  { file: "02-bundle", kicker: "02", title: "One instruction: create, then buy", sub: "The pooled SOL buys first. Nothing can get in between." },
  { file: "03-agent", kicker: "03", title: "The vault agent works the chart", sub: "Sells into strength, buys back dips, inside the program's limits." },
  { file: "04-money", kicker: "04", title: "Where the money goes", sub: "75% vault · 15% burn · 10% backers. What the agent sells for stays in the vault." },
  { file: "05-paid", kicker: "05", title: "Paid back at 5×", sub: "Principal first, then 15% of the vault, at most once per 4 h." },
  { file: "06-close", kicker: "holdfast.fun", title: "Hold fast.", sub: "holdfast.fun · program EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ · admin: 2-of-3 Squads multisig" },
];

export function fontFaces() {
  const src = fs.readFileSync(path.join(ROOT, "brand/x/src/announce-night.html"), "utf8");
  return src.split("\n").filter((l) => l.startsWith("@font-face")).join("\n");
}

export function logoSvg() {
  const src = fs.readFileSync(path.join(ROOT, "brand/x/src/announce-night.html"), "utf8");
  const m = /<div style="position:absolute;left:96px;top:84px;display:flex;align-items:center;gap:14px">([\s\S]*?)<\/div>/.exec(src);
  return m ? m[1] : "";
}

export function cardHtml(card) {
  const open = card.file.startsWith("00") || card.file.startsWith("06");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;background:${INK};overflow:hidden;position:relative;color:${PAPER}}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95}
.ui{font-family:Mona,sans-serif}.mono{font-family:JBM,monospace}
.label{font-family:Mona,sans-serif;font-weight:600;font-size:32px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}}
</style></head><body>
<div style="position:absolute;left:120px;top:100px;display:flex;align-items:center;gap:16px;transform:scale(1.2);transform-origin:left top">${logoSvg()}</div>
<div class="label" style="position:absolute;right:120px;top:112px;display:flex;align-items:center;gap:14px"><span style="width:12px;height:12px;border-radius:12px;background:${ORANGE}"></span>${open ? "Live on Solana" : "holdfast.fun"}</div>
<div style="position:absolute;left:120px;right:120px;top:${open ? 380 : 360}px">
  <div class="${card.kicker.length <= 2 ? "disp" : "label"}" style="${card.kicker.length <= 2 ? `font-size:48px;color:${ORANGE}` : `font-size:32px;color:${ORANGE}`};margin-bottom:28px">${card.kicker}</div>
  <div class="disp" style="font-size:${card.title.length > 30 ? 96 : open ? 128 : 112}px;color:${PAPER};max-width:1680px">${card.title}</div>
  <div class="ui" style="font-size:40px;color:#A9A89F;max-width:1400px;line-height:1.4;margin-top:40px;${card.file.startsWith("06") ? `font-family:JBM,monospace;font-size:32px;color:${MUTED};max-width:1680px` : ""}">${card.sub}</div>
</div>
<div style="position:absolute;left:120px;right:120px;bottom:120px;border-top:1px solid ${LINE};padding-top:26px;display:flex;justify-content:space-between">
  <div class="mono" style="font-size:32px;color:${MUTED}">holdfast.fun</div>
  <div class="ui" style="font-size:32px;color:${MUTED}">Backers buy first. The vault agent works the chart.</div>
</div>
</body></html>`;
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === "Runtime.exceptionThrown") this.exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
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

/**
 * Runs `fn(page)` against a fresh headless Chrome tab sized `width`×`height`; `page.shoot(file, html)`
 * writes an HTML string and screenshots it (transparent background when `transparent`), `page.navigate`
 * / `page.eval` / `page.screenshot` expose the raw steps for frame-stepped renders.
 */
export async function withChrome({ width = 1920, height = 1080, chrome = CHROME, port = PORT, transparent = false }, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hf-chrome-"));
  const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tmp, "profile")}`, `--window-size=${width},${height}`, "--hide-scrollbars", "--no-first-run", "--disable-gpu-vsync", "about:blank"], { stdio: "ignore" });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
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
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
    let n = 0;
    const page = {
      async navigate(html) {
        const file = path.join(tmp, `page${n++}.html`);
        fs.writeFileSync(file, html);
        cdp.exceptions.length = 0;
        await cdp.send("Page.navigate", { url: pathToFileURL(file).href }, sessionId);
        await sleep(500);
        await cdp.send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true }, sessionId);
        if (cdp.exceptions.length) throw new Error(`page threw: ${cdp.exceptions.join("\n")}`);
      },
      async eval(expression) {
        const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        return result.value;
      },
      async screenshot(file, format = "png") {
        const { data } = await cdp.send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality: 95 } : {}), captureBeyondViewport: false }, sessionId);
        fs.writeFileSync(file, Buffer.from(data, "base64"));
      },
      async shoot(file, html) {
        await page.navigate(html);
        await page.screenshot(file);
      },
    };
    return await fn(page);
  } finally {
    ws.close();
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill();
    await exited;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await withChrome({}, async (page) => {
    for (const card of CARDS) {
      const out = path.join(OUT, `${card.file}.png`);
      await page.shoot(out, cardHtml(card));
      console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
    }
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
