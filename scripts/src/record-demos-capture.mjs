#!/usr/bin/env node
/**
 * Screen capture for the product loops prepared by `record-demos.ts` (see its header for the whole
 * procedure). Drives a dedicated headless Chrome over CDP: 1600×1000 CSS px at DPR 2 (`--mobile`:
 * 390×844, touch), a synthetic cursor that eases between targets (the headless page draws none),
 * `Page.startScreencast` frames written with their timestamps so idle stretches can be cut later.
 *
 *   node scripts/src/record-demos-capture.mjs <scene> --path /launch/<address> --out .localnet/demo/cap/<name>
 *        [--mobile] [--site http://localhost:3310] [--chrome <chrome.exe>] [--run "<command run after start>"]
 *
 * Scenes: back-a-raise (type 0.5, click "Back with 0.5 SOL"), the-bundle (click "Launch now", wait for the
 * pump.fun link), agent-defends (`--run` the dump, wait for the "Agent buy" row), claim (click "Claim all",
 * wait for the "Claimed" toast). Output: `frames/*.jpg`, `timeline.json` ({ frames: [{ file, ts }], marks:
 * { name: ts }, rects: { name: {x,y,w,h} } in CSS px, device }).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const scene = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const MOBILE = args.includes("--mobile");
const SITE = (flag("site", "http://localhost:3310")).replace(/\/+$/, "");
const OUT = path.resolve(flag("out", `.localnet/demo/cap/${scene}${MOBILE ? "-m" : ""}`));
const CHROME = flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const RUN = flag("run", "");
const PORT = Number(flag("port", "9333"));
const BURNER = path.resolve(flag("burner", ".localnet/demo/burner.json"));

const HEIGHTS = { "back-a-raise": 1000, "the-bundle": 2000, "agent-defends": 1900, claim: 1000 };
const VIEW = MOBILE ? { width: 390, height: 844 } : { width: 1600, height: HEIGHTS[scene] ?? 1000 };

// ---------------------------------------------------------------- CDP

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else {
        for (const l of this.listeners) l(msg);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

async function launchChrome() {
  const dir = path.join(os.tmpdir(), "hf-demo-chrome");
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${dir}`,
      "--force-device-scale-factor=2",
      `--window-size=${VIEW.width},${VIEW.height}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--mute-audio",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      return { proc, wsUrl: v.webSocketDebuggerUrl };
    } catch {
      await sleep(100);
    }
  }
  throw new Error("Chrome did not open its debugging port");
}

// ---------------------------------------------------------------- page helpers

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.s = sessionId;
    this.frames = [];
    this.marks = {};
    this.rects = {};
    this.cursor = { x: VIEW.width / 2, y: VIEW.height / 2 };
    this.recording = false;
  }
  send(method, params) {
    return this.cdp.send(method, params, this.s);
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
    return r.result.value;
  }
  mark(name) {
    this.marks[name] = Date.now() / 1000;
    console.log(`  mark ${name} @ ${this.marks[name].toFixed(3)}`);
  }
  async goto(p) {
    await this.send("Page.navigate", { url: `${SITE}${p}` });
    await this.waitFor("document.readyState === 'complete'", 30_000);
    await sleep(600);
  }
  async waitFor(expr, timeoutMs = 20_000, every = 150) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval(`!!(${expr})`)) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${expr}`);
      await sleep(every);
    }
  }
  async waitText(text, timeoutMs) {
    await this.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, timeoutMs);
  }
  /** Center and box (CSS px) of the first element whose text starts with `text`, or of `selector`. */
  async rect(target) {
    const expr = `(() => { const el = ${Page.finder(target)}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
    return this.eval(expr);
  }
  async rectOf(target, timeoutMs = 15_000) {
    const t0 = Date.now();
    for (;;) {
      const r = await this.rect(target);
      if (r) return r;
      if (Date.now() - t0 > timeoutMs) throw new Error(`no element ${target}`);
      await sleep(150);
    }
  }
  /** Box of the section whose aria-label / heading matches, for crops (stored in rects). */
  async remember(name, expr) {
    const r = await this.eval(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (r) this.rects[name] = r;
    return r;
  }

  /** The synthetic cursor: a fixed SVG arrow that follows `moveTo`, plus a click ripple. Survives navigation only if re-injected. */
  async injectCursor() {
    await this.eval(`(() => {
      if (document.getElementById('__cur')) return;
      const d = document.createElement('div');
      d.id = '__cur';
      d.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:36px;pointer-events:none;z-index:2147483647;transform:translate(${this.cursor.x}px,${this.cursor.y}px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));will-change:transform;display:${MOBILE ? "none" : "block"}';
      d.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"><path d="M4 2 L4 28 L10.5 22 L15 32.5 L19.5 30.5 L15 20.5 L24 20.5 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(d);
      const r = document.createElement('div');
      r.id = '__rip';
      r.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2.5px solid #FF4F00;pointer-events:none;z-index:2147483646;opacity:0;transform:scale(.3)';
      document.documentElement.appendChild(r);
    })()`);
  }
  async setCursor(x, y) {
    await this.eval(`(() => { const d = document.getElementById('__cur'); if (d) d.style.transform = 'translate(${x}px,${y}px)'; })()`);
  }
  async ripple(x, y) {
    await this.eval(`(() => { const r = document.getElementById('__rip'); if (!r) return; r.style.transition = 'none'; r.style.left = '${x}px'; r.style.top = '${y}px'; r.style.opacity = '0.9'; r.style.transform = 'scale(.3)'; requestAnimationFrame(() => { r.style.transition = 'opacity .45s ease-out, transform .45s ease-out'; r.style.opacity = '0'; r.style.transform = 'scale(1.1)'; }); })()`);
  }
  /** Eased move of cursor + real mouse (hover states) to (x, y) over `ms`. */
  async moveTo(x, y, ms = 700) {
    const from = { ...this.cursor };
    const steps = Math.max(12, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const cx = from.x + (x - from.x) * e;
      const cy = from.y + (y - from.y) * e;
      await Promise.all([this.setCursor(cx, cy), this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy })]);
      await sleep(ms / steps);
    }
    this.cursor = { x, y };
  }
  async click(x, y) {
    await this.ripple(x, y);
    if (MOBILE) {
      await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await sleep(60);
      await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      return;
    }
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sleep(70);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  /** Element lookup shared by `rect`: a selector, or the first visible button/link/input whose text is `target` (else starts with it). */
  static finder(target) {
    if (target.startsWith("#") || target.startsWith("[")) return `document.querySelector(${JSON.stringify(target)})`;
    const t = JSON.stringify(target);
    return `(() => { const els = [...document.querySelectorAll('button, a, input, [role=button]')].filter((e) => e.getClientRects().length); const txt = (e) => (e.innerText || e.value || '').trim(); return els.find((e) => txt(e) === ${t}) ?? els.find((e) => txt(e).startsWith(${t})); })()`;
  }
  async clickTarget(target, ms = 700) {
    let r = await this.rectOf(target);
    if (r.y < 0 || r.y + r.h > VIEW.height) {
      // Off-screen (mobile pages scroll): smooth-scroll it to the middle, then re-measure.
      await this.eval(`(${Page.finder(target)})?.scrollIntoView({ behavior: 'smooth', block: 'center' })`);
      await sleep(900);
      r = await this.rectOf(target);
    }
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    await this.moveTo(x, y, ms);
    await sleep(160);
    await this.click(x, y);
    return r;
  }
  async type(text, gapMs = 110) {
    for (const ch of text) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(gapMs);
    }
  }

  async startRecording() {
    fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
    this.cdp.on((msg) => {
      if (msg.sessionId !== this.s || msg.method !== "Page.screencastFrame") return;
      const { data, metadata, sessionId } = msg.params;
      if (this.recording) {
        const file = `frames/${String(this.frames.length).padStart(5, "0")}.jpg`;
        fs.writeFileSync(path.join(OUT, file), Buffer.from(data, "base64"));
        this.frames.push({ file, ts: metadata.timestamp });
      }
      void this.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    this.recording = true;
    await this.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 3200, maxHeight: 4000, everyNthFrame: 1 });
    this.mark("start");
  }
  async stopRecording() {
    this.mark("end");
    await this.send("Page.stopScreencast");
    this.recording = false;
    fs.writeFileSync(
      path.join(OUT, "timeline.json"),
      JSON.stringify({ scene, device: MOBILE ? "mobile" : "desktop", view: VIEW, dpr: 2, frames: this.frames, marks: this.marks, rects: this.rects }, null, 1),
    );
    console.log(`  ${this.frames.length} frames over ${(this.marks.end - this.marks.start).toFixed(1)} s → ${OUT}`);
  }

  /** Seed the burner secret, reload, connect the test wallet from the header. */
  async connectTestWallet() {
    const secret = fs.readFileSync(BURNER, "utf8").trim();
    await this.eval(`localStorage.setItem("holdfast:burner-secret", ${JSON.stringify(secret)})`);
    await this.send("Page.reload");
    await this.waitFor("document.readyState === 'complete'", 30_000);
    await sleep(800);
    if (await this.eval(`!!document.querySelector('[aria-label^="Wallet "]')`)) return;
    const connect = await this.rectOf("Connect");
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: connect.x + connect.w / 2, y: connect.y + connect.h / 2, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: connect.x + connect.w / 2, y: connect.y + connect.h / 2, button: "left", clickCount: 1 });
    const row = await this.rectOf("Test wallet (this browser only)");
    await sleep(300);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: row.x + row.w / 2, y: row.y + row.h / 2, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: row.x + row.w / 2, y: row.y + row.h / 2, button: "left", clickCount: 1 });
    await this.waitFor(`!!document.querySelector('[aria-label^="Wallet "]')`, 20_000);
    await sleep(700);
  }
}

function runCommand(cmd) {
  console.log(`  running: ${cmd}`);
  const child = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"], cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..") });
  child.stdout.on("data", (d) => process.stdout.write(`    │ ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`    │ ${d}`));
  return new Promise((resolve) => child.on("close", resolve));
}

// ---------------------------------------------------------------- scenes

const SCENES = {
  async "back-a-raise"(p) {
    await p.goto(flag("path"));
    await p.connectTestWallet();
    await p.injectCursor();
    await p.remember("panel", `document.querySelector('#back')`);
    await p.remember("progress", `document.querySelector('[role=progressbar]')`);
    const before = await p.eval(`document.body.innerText`);
    await p.startRecording();
    await sleep(900);
    if (MOBILE) {
      await p.clickTarget("Back this launch", 500);
      await sleep(700);
    }
    const input = await p.rectOf(MOBILE ? "#back-amount-sheet" : "#back-amount");
    await p.moveTo(input.x + Math.min(90, input.w * 0.3), input.y + input.h / 2, 800);
    await sleep(150);
    await p.click(p.cursor.x, p.cursor.y);
    await sleep(350);
    await p.type("0.5");
    p.mark("typed");
    await sleep(500);
    await p.clickTarget("Back with 0.5 SOL", 750);
    p.mark("click");
    // The deposit landed: the panel shows the burner's deposit row and the progress text changed.
    await p.waitFor(`document.body.innerText.includes('Deposited 0.5 SOL')`, 45_000);
    p.mark("landed");
    await sleep(3_200);
    await p.stopRecording();
  },

  async "the-bundle"(p) {
    await p.goto(flag("path"));
    await p.connectTestWallet();
    await p.injectCursor();
    await p.remember("vault", `[...document.querySelectorAll('section, article, div')].find((e) => e.getAttribute('aria-label') === 'Vault' || (e.querySelector(':scope > h2, :scope > header h2, :scope > div > h2')?.innerText || '').trim() === 'Vault')`);
    await p.startRecording();
    await sleep(1_000);
    await p.clickTarget("Launch now", 800);
    p.mark("click");
    await p.waitFor(`[...document.querySelectorAll('a')].some((a) => a.innerText.startsWith('Trade $'))`, 90_000);
    p.mark("live");
    await sleep(1_500);
    await p.remember("vaultLive", `[...document.querySelectorAll('section, article, div')].find((e) => e.getAttribute('aria-label') === 'Vault' || (e.querySelector(':scope > h2, :scope > header h2, :scope > div > h2')?.innerText || '').trim() === 'Vault')`);
    await p.remember("pumpLink", `[...document.querySelectorAll('a')].find((a) => a.innerText.startsWith('Trade $'))`);
    await p.remember("position", `[...document.querySelectorAll('section, article, div')].find((e) => (e.querySelector(':scope > h2, :scope > header h2, :scope > div > h2')?.innerText || '').trim() === 'Your position')`);
    await sleep(3_500);
    await p.stopRecording();
  },

  async "agent-defends"(p) {
    await p.goto(flag("path"));
    await p.connectTestWallet();
    await p.injectCursor();
    await p.setCursor(VIEW.width - 60, VIEW.height - 60);
    await p.remember("chart", `document.querySelector('[aria-label*="chart" i], [data-chart], .tv-lightweight-charts')?.closest('section') ?? document.querySelector('.tv-lightweight-charts')`);
    await p.remember("trades", `[...document.querySelectorAll('table')].find((t) => t.innerText.includes('Type') || t.innerText.includes('Trader'))`);
    await p.remember("vault", `[...document.querySelectorAll('section, article, div')].find((e) => e.getAttribute('aria-label') === 'Vault' || (e.querySelector(':scope > h2, :scope > header h2, :scope > div > h2')?.innerText || '').trim() === 'Vault')`);
    // The trades table stays in the DOM when a phone section hides it, so count on textContent.
    const agentBuysBefore = await p.eval(`(document.body.textContent.match(/Agent buy/g) || []).length`);
    await p.startRecording();
    await sleep(1_200);
    p.mark("dump");
    const run = RUN ? runCommand(RUN) : Promise.resolve(0);
    await p.waitFor(`(document.body.textContent.match(/Agent buy/g) || []).length > ${agentBuysBefore}`, 150_000, 250);
    p.mark("landed");
    if (MOBILE) {
      // The chart marker is in view; tap the phone sections for the "Agent buy" row, then the vault card.
      await sleep(2_200);
      await p.clickTarget("Trades", 500);
      p.mark("trades");
      await sleep(2_800);
      await p.clickTarget("Vault", 500);
      p.mark("vault");
      await sleep(3_200);
    } else {
      await sleep(4_000);
    }
    await p.stopRecording();
    await run;
  },

  async claim(p) {
    await p.goto(flag("path", "/portfolio"));
    await p.connectTestWallet();
    await p.injectCursor();
    await p.setCursor(VIEW.width * 0.55, VIEW.height * 0.7);
    await p.rectOf("Claim all");
    await p.startRecording();
    await sleep(1_400);
    const claimBefore = await p.eval(`document.body.innerText`);
    await p.clickTarget("Claim all", 850);
    p.mark("click");
    await p.waitFor(`document.body.innerText.includes('Claimed ') && document.body.innerText !== ${JSON.stringify(claimBefore)}`, 60_000);
    p.mark("landed");
    await p.remember("toast", `[...document.querySelectorAll('[data-sonner-toast], [role=status], li')].find((e) => e.innerText.includes('Claimed '))`);
    await sleep(3_500);
    await p.stopRecording();
  },
};

async function main() {
  if (!scene || !SCENES[scene]) throw new Error(`scene must be one of ${Object.keys(SCENES).join(", ")}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, wsUrl } = await launchChrome();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const cdp = new Cdp(ws);
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const p = new Page(cdp, sessionId);
    await p.send("Page.enable");
    await p.send("Runtime.enable");
    await p.send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 2, mobile: MOBILE });
    if (MOBILE) {
      await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      await p.send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
    }
    await p.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    console.log(`${scene} (${MOBILE ? "mobile" : "desktop"} ${VIEW.width}×${VIEW.height} @2x)`);
    await SCENES[scene](p);
  } finally {
    ws.close();
    proc.kill();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
