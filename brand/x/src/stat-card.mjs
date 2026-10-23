// Shared pieces of the live-data posts (stats.mjs, wallets.mjs, …): the kit's fonts, logo and colours, a 1600×900
// page, number formats, the indexer and RPC fetches, and the headless-Chrome card and video renders into
// brand/x/stats/<unix time>/.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

export const API = "https://api.holdfast.fun";
export const HOLD_LAUNCH = "FkmhHSFs4oGey5tbtQ6t6w378qiZs6K2C4w1NsfMfQod";

const here = dirname(fileURLToPath(import.meta.url));
const night = readFileSync(join(here, "announce-night.html"), "utf8").split("\n");
/** The kit's @font-face rules (MonaDisplay, Mona, JBM), fonts inlined. */
export const fonts = night.slice(1, 5).join("\n");
const logo = night.find((l) => l.startsWith('<div style="position:absolute;left:96px;top:84px'));
if (!fonts.includes("@font-face") || !logo) throw new Error("announce-night.html layout changed");

export const get = async (p) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + p);
    if (res.ok) return res.json();
    if (![429, 502, 503].includes(res.status) || attempt >= 5) throw new Error(`${p}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
};
/** USD, compact: $13.7K / $483K / $1.24M (self-contained, so pages can inline it with `money.toString()`). */
export const money = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${Math.round(v / 1e3)}K` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`;

// Chain reads: RPC_URL, else .mainnet/config.json → rpcUrl (the indexer's /rpc proxy only serves the site's methods).
let rpcUrl;
export const rpc = async (method, params) => {
  rpcUrl ??= process.env.RPC_URL ?? JSON.parse(readFileSync(new URL("../../../.mainnet/config.json", import.meta.url), "utf8")).rpcUrl;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = res.ok ? await res.json() : null;
    if (body && !body.error) return body.result;
    const limited = res.status === 429 || /rate|limit/i.test(body?.error?.message ?? "");
    if (!limited || attempt >= 7) throw new Error(`${method}: ${body?.error?.message ?? res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
};
export const sol = (lamports) => Number(lamports) / 1e9;
export const n0 = (x) => Math.round(x).toLocaleString("en-US");
export const n1 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const n2 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Post length the way X counts it: any URL or *.fun / *.so link is 23, everything else by code point. */
export const xlen = (s) => [...s.replace(/https?:\/\/\S+|\b[\w.-]+\.(?:fun|so)(?:\/\S*)?/g, "x".repeat(23))].length;

export const INK = "#0F100E", PAPER = "#F2F1EC", MUTED = "#A9A89F", DIM = "#85857C", LINE = "#2A2B27", ORANGE = "#FF5B1A";
const css = `${fonts}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1600px;height:900px;background:${INK};overflow:hidden;position:relative;color:${PAPER};font-family:Mona,sans-serif}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95}
.label{font-weight:600;font-size:30px;letter-spacing:0.06em;text-transform:uppercase;color:${DIM}}
.tag{position:absolute;right:96px;top:98px;display:flex;align-items:center;gap:12px}
.tag i{width:12px;height:12px;border-radius:12px;background:${ORANGE};display:inline-block}
.big{position:absolute;left:92px;right:96px;top:230px;font-size:104px;color:${PAPER}}
.big em{font-style:normal;color:${ORANGE}}
.sup{position:absolute;left:96px;right:96px;font-size:38px;line-height:1.35;color:${MUTED}}
.sup b{font-weight:600;color:${PAPER}}
.foot{position:absolute;left:96px;bottom:44px;font-size:30px;color:${DIM};font-family:JBM,monospace;white-space:nowrap}
.sig{position:absolute;right:96px;bottom:42px;font-size:30px;color:${DIM}}
.split{position:absolute;left:96px;right:96px;top:470px;display:grid;grid-template-columns:repeat(3,1fr);gap:48px}
.split .c{border-top:1px solid ${LINE};padding-top:26px}
.split .n{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:0.95;font-size:120px;color:${PAPER}}
.split .n.o{color:${ORANGE}}
.split .l{font-size:36px;color:${MUTED};margin-top:18px}
.bar{position:absolute;left:96px;right:96px;top:560px;height:28px;border:1px solid ${LINE}}
.bar i{display:block;height:100%;background:${ORANGE}}
.ticks{position:absolute;left:96px;right:96px;top:606px;height:40px;font-family:JBM,monospace;font-size:30px;color:${DIM}}
.ticks span{position:absolute;top:0;white-space:nowrap}
.mark{position:absolute;top:548px;width:3px;height:52px;background:${PAPER}}
.rows{position:absolute;left:96px;right:96px;top:178px;font-family:JBM,monospace;font-size:26px;line-height:38px;color:${PAPER}}
.rows div{display:grid;grid-template-columns:52px 1fr 150px 170px 120px;white-space:nowrap}
.rows div.h{color:${DIM};font-size:22px;letter-spacing:0.06em;text-transform:uppercase}
.rows .i{color:${ORANGE}}
.rows .r{text-align:right;color:${MUTED}}
`;
export const page = (tag, body, foot) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>\n${css}</style></head><body>\n${logo}\n</div>\n<div class="label tag"><i></i>${tag}</div>\n${body}\n<div class="foot">${foot}</div><div class="sig">Hold fast.</div></body></html>`;
export const col = (n, label, o = false) => `<div class="c"><div class="n${o ? " o" : ""}">${n}</div><div class="l">${label}</div></div>`;

/**
 * Every vault agent trade on a launch, oldest first. `before` is exclusive by second, so each page steps back to its
 * oldest second plus one and dedupes: no trade sharing a page-boundary second is skipped.
 */
export async function agentTrades(launch) {
  const trades = new Map();
  for (let before; ; ) {
    const page_ = (await get(`/api/launches/${launch}/trades?agent=1&limit=100${before ? `&before=${before}` : ""}`)).trades;
    const fresh = page_.filter((t) => !trades.has(t.signature));
    for (const t of fresh) trades.set(t.signature, t);
    if (page_.length < 100 || fresh.length === 0) break;
    before = page_[page_.length - 1].timestamp + 1;
  }
  return [...trades.values()].sort((a, b) => a.timestamp - b.timestamp || a.slot - b.slot);
}

/** brand/x/stats/<now>/, created. */
export function outDir(now) {
  const out = resolve(here, "..", "stats", String(now));
  mkdirSync(out, { recursive: true });
  return out;
}

/**
 * Renders `cards` ({ name, html }) to brand/x/stats/<now>/<name>.png at device scale 2, writes `posts`
 * ({ images: card names or file names with an extension in that folder, alt: one per image, text }) as posts.json
 * with absolute media paths and X lengths.
 */
export function render(now, cards, posts, meta = {}) {
  const out = outDir(now);
  const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  for (const c of cards) {
    const src = join(out, `${c.name}.html`);
    writeFileSync(src, c.html);
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=1600,900",
      `--screenshot=${join(out, `${c.name}.png`)}`, `file:///${src.replace(/\\/g, "/")}`,
    ], { stdio: "ignore" });
  }
  const written = posts.map((p) => ({
    images: p.images.map((name) => join(out, name.includes(".") ? name : `${name}.png`)),
    alt: p.alt,
    text: p.text,
    length: xlen(p.text),
  }));
  writeFileSync(join(out, "posts.json"), JSON.stringify({ at: now, ...meta, posts: written }, null, 2));
  console.log(JSON.stringify({ out, posts: written }, null, 2));
}

/**
 * Renders a canvas page to `<out>/<name>.mp4` (H.264, yuv420p, no audio) and `<name>-poster.jpg`. The page must
 * set `window.ready` (a promise, e.g. fonts) and `window.shot(seconds)` → a JPEG data URL of that frame; headless
 * Chrome runs it over CDP, one Runtime.evaluate per frame, and ffmpeg encodes the frames.
 */
export async function renderVideo(out, name, html, { w, h, fps, secs, posterAt }) {
  const page = join(out, `${name}.html`);
  writeFileSync(page, html);
  const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const profile = mkdtempSync(join(tmpdir(), "hf-video-"));
  const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", `--window-size=${w},${h}`, `file:///${page.replace(/\\/g, "/")}`], { stdio: "ignore" });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; !existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n"); i++) {
      if (i > 100) throw new Error("Chrome did not start");
      await wait(100);
    }
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    let target;
    for (let i = 0; !(target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page" && t.url.startsWith("file:"))); i++) {
      if (i > 100) throw new Error("page did not open");
      await wait(100);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const evaluate = (expression) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => {
        const r = msg.result;
        if (msg.error || r?.exceptionDetails) reject(new Error(JSON.stringify(msg.error ?? r.exceptionDetails).slice(0, 500)));
        else resolve(r.result.value);
      });
      ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    for (let i = 0; (await evaluate("typeof window.ready")) !== "object"; i++) {
      if (i > 100) throw new Error("page script did not load");
      await wait(100);
    }
    await evaluate("window.ready.then(() => true)");
    const jpeg = (url) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const frames = join(out, `${name}-frames`);
    mkdirSync(frames, { recursive: true });
    for (let f = 0; f < secs * fps; f++) writeFileSync(join(frames, `${String(f).padStart(5, "0")}.jpg`), jpeg(await evaluate(`shot(${f / fps})`)));
    writeFileSync(join(out, `${name}-poster.jpg`), jpeg(await evaluate(`shot(${posterAt})`)));
    ws.close();
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps), "-i", join(frames, "%05d.jpg"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, `${name}.mp4`),
    ], { stdio: "inherit" });
    rmSync(frames, { recursive: true, force: true });
  } finally {
    proc.kill();
    await wait(300);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}
