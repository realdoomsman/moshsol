#!/usr/bin/env node
/**
 * Cuts and encodes the captures of `record-demos-capture.mjs` (see `record-demos.ts` for the procedure).
 * Each scene is a list of segments (times relative to the capture's marks, optional crop in CSS px) that
 * are rendered from the timestamped frames (ffconcat durations → constant 30 fps), joined with short
 * cross-fades into one master per output size, and encoded:
 *
 *   node scripts/src/record-demos-encode.mjs site  <capture dir> <name>   → apps/web/public/videos/<name>.{mp4,webm,jpg}
 *                                                                          (1280×800; `-m` captures 780×1688)
 *   node scripts/src/record-demos-encode.mjs x     <capture dir> <name>   → brand/x/video/<name>.mp4 (1920×1200 H.264 + silent AAC)
 *   node scripts/src/record-demos-encode.mjs hero  <out.mp4> <cards .png and clips .mp4 in order>
 *                                                                          → 1920×1080 compilation, 1.5 s title cards, fades
 *   node scripts/src/record-demos-encode.mjs manifest <name>=<capture dir>… → updates apps/web/public/videos/manifest.json
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const FADE = 0.35;
const FPS = 30;

/**
 * Segment plans per scene: `[from, to, crop?]`, times as "mark±seconds" (past the last frame holds it).
 * Crops are CSS px boxes, or `rect` (a box the capture remembered) padded and fitted on the page colour.
 */
const PLANS = {
  "back-a-raise": {
    desktop: [["start+0.4", "landed+3.2"]],
    mobile: [["start+0.4", "landed+3.2"]],
  },
  "the-bundle": {
    // The click and the status flip in the top of the page, then the vault card as it fills.
    desktop: [
      ["start+0.6", "live+2.4", { x: 0, y: 0, w: 1600, h: 1000 }],
      ["live+2.4", "end+1.2", { rect: "vaultLive", pad: 24, fit: true }],
    ],
    mobile: [["start+0.6", "end+0.6"]],
  },
  "agent-defends": {
    // The dump hits and the agent buys: stats row, chart and the first trade rows, then the vault card.
    desktop: [
      ["dump-0.8", "landed+2.6", { x: 0, y: 180, w: 1600, h: 1000 }],
      ["landed+2.6", "end+1.8", { rect: "vault", pad: 24, fit: true }],
    ],
    mobile: [["landed-2.2", "end+0.4"]],
  },
  claim: {
    desktop: [["start+0.4", "end+1.2"]],
    mobile: [["start+0.4", "end+1.2"]],
  },
};

const run = (args, opts = {}) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"], ...opts });
const probe = (file, what) => execFileSync("ffprobe", ["-v", "error", "-show_entries", what, "-of", "csv=p=0", file]).toString().trim();
const duration = (file) => Number(probe(file, "format=duration"));

function timeOf(expr, marks) {
  const m = /^(\w+)([+-][\d.]+)?$/.exec(expr);
  if (!m || marks[m[1]] === undefined) throw new Error(`bad time ${expr}`);
  return marks[m[1]] + Number(m[2] ?? 0);
}

/** Crop box in device px for a segment's crop spec (frame-relative, even-sized). */
function cropBox(spec, t) {
  const dpr = t.dpr;
  const fw = t.view.width * dpr;
  const fh = t.view.height * dpr;
  if (!spec) return { x: 0, y: 0, w: fw, h: fh };
  let box;
  if (spec.rect) {
    const r = t.rects[spec.rect];
    if (!r) throw new Error(`capture has no rect ${spec.rect}`);
    const pad = spec.pad ?? 0;
    let w = r.w + pad * 2;
    let h = r.h + pad * 2;
    // Grow to the requested aspect around the rect, clamped to the page.
    if (spec.aspect) {
      if (w / h < spec.aspect) w = h * spec.aspect;
      else h = w / spec.aspect;
    }
    let x = r.x + r.w / 2 - w / 2;
    let y = r.y + r.h / 2 - h / 2;
    x = Math.max(0, Math.min(t.view.width - w, x));
    y = Math.max(0, Math.min(t.view.height - h, y));
    box = { x, y, w, h };
  } else {
    box = spec;
  }
  const even = (v) => Math.floor(v / 2) * 2;
  return { x: even(box.x * dpr), y: even(box.y * dpr), w: even(Math.min(box.w * dpr, fw)), h: even(Math.min(box.h * dpr, fh)) };
}

/** Renders one segment to an intermediate MP4 at `out` size (lanczos, 30 fps, visually lossless). */
function renderSegment(capDir, t, seg, size, file) {
  const [fromExpr, toExpr, crop] = seg;
  const from = timeOf(fromExpr, t.marks);
  const to = timeOf(toExpr, t.marks);
  if (to <= from) throw new Error(`empty segment ${fromExpr}..${toExpr}`);
  const frames = t.frames;
  let first = frames.findIndex((f) => f.ts >= from);
  if (first < 0) first = frames.length - 1;
  if (first > 0 && frames[first].ts > from) first -= 1;
  const lines = ["ffconcat version 1.0"];
  for (let i = first; i < frames.length && frames[i].ts < to; i++) {
    const start = Math.max(frames[i].ts, from);
    const next = frames[i + 1] ? Math.min(frames[i + 1].ts, to) : to;
    const d = Math.max(0.001, next - start);
    lines.push(`file '${path.resolve(capDir, frames[i].file).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`, `duration ${d.toFixed(4)}`);
  }
  const last = frames.findLast((f) => f.ts < to) ?? frames.at(-1);
  lines.push(`file '${path.resolve(capDir, last.file).replace(/\\/g, "/")}'`);
  const list = `${file}.ffconcat`;
  fs.writeFileSync(list, lines.join("\n"));
  const box = cropBox(crop, t);
  // The screencast JPEGs are full-range (yuvj); `out_range=tv` makes a plain limited-range yuv420p stream.
  const fit = crop?.fit
    ? `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:flags=lanczos:out_range=tv,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:color=0x0F0F0D`
    : `scale=${size.w}:${size.h}:flags=lanczos:out_range=tv`;
  const vf = `crop=${box.w}:${box.h}:${box.x}:${box.y},${fit},fps=${FPS},format=yuv420p`;
  run(["-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-an", file]);
  return file;
}

/** Joins segment files with cross-fades into `out`. */
function joinSegments(files, out) {
  if (files.length === 1) {
    fs.copyFileSync(files[0], out);
    return;
  }
  const durs = files.map(duration);
  const inputs = files.flatMap((f) => ["-i", f]);
  let filter = "";
  let prev = "[0:v]";
  let offset = 0;
  for (let i = 1; i < files.length; i++) {
    offset += durs[i - 1] - FADE;
    const label = i === files.length - 1 ? "[v]" : `[x${i}]`;
    filter += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`;
    prev = label;
  }
  run([...inputs, "-filter_complex", filter.slice(0, -1), "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-an", out]);
}

function master(capDir, size) {
  const t = JSON.parse(fs.readFileSync(path.join(capDir, "timeline.json"), "utf8"));
  const plan = PLANS[t.scene]?.[t.device];
  if (!plan) throw new Error(`no plan for ${t.scene}/${t.device}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hf-enc-"));
  const segs = plan.map((seg, i) => renderSegment(capDir, t, seg, size, path.join(tmp, `seg${i}.mp4`)));
  const out = path.join(tmp, "master.mp4");
  joinSegments(segs, out);
  return { out, tmp, t };
}

/**
 * Site encodes: MP4 (crf stepped up until it fits the budget: 1.5 MB per loop, 6 MB for the 1280×720
 * hero), VP9 WebM, JPG poster ≤ 120 KB. `source` is a capture dir, or a finished MP4 (the hero) that is
 * scaled to 1280 wide; the poster is the first frame after the opening title card for the hero.
 */
function encodeSite(source, name) {
  const mobile = name.endsWith("-m");
  const size = mobile ? { w: 780, h: 1688 } : { w: 1280, h: 800 };
  const hero = /\.mp4$/i.test(source);
  const { out, tmp } = hero ? { out: source, tmp: null } : master(source, size);
  const budget = (hero ? 6 : 1.5) * 1024 * 1024;
  const scale = hero ? ["-vf", "scale=1280:-2:flags=lanczos"] : [];
  const dir = path.join(ROOT, "apps/web/public/videos");
  const mp4 = path.join(dir, `${name}.mp4`);
  for (const crf of [23, 26, 28, 30, 33]) {
    run(["-i", out, ...scale, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
    if (fs.statSync(mp4).size <= budget) break;
  }
  const webm = path.join(dir, `${name}.webm`);
  for (const crf of [34, 37, 40, 44]) {
    run(["-i", out, ...scale, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", "-pix_fmt", "yuv420p", "-an", webm]);
    if (fs.statSync(webm).size <= budget * 0.8) break;
  }
  const jpg = path.join(dir, `${name}.jpg`);
  for (const q of [3, 5, 7, 9, 12]) {
    run(["-i", out, ...(hero ? ["-ss", "1.6"] : []), ...scale, "-frames:v", "1", "-q:v", String(q), jpg]);
    if (fs.statSync(jpg).size <= 120 * 1024) break;
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  report([mp4, webm, jpg]);
  return duration(mp4);
}

/** X encode: 1920×1200 H.264 high profile + silent AAC. */
function encodeX(capDir, name) {
  const { out, tmp } = master(capDir, { w: 1920, h: 1200 });
  const dir = path.join(ROOT, "brand/x/video");
  fs.mkdirSync(dir, { recursive: true });
  const mp4 = path.join(dir, `${name}.mp4`);
  withSilence(out, mp4, 17);
  fs.rmSync(tmp, { recursive: true, force: true });
  report([mp4]);
}

function withSilence(input, out, crf) {
  run([
    "-i", input, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out,
  ]);
}

/** Hero: title cards (PNG, 1.5 s each, fade-in) and clips (scaled/padded to 1920×1080) in the given order, joined with fades. */
function encodeHero(out, parts) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hf-hero-"));
  const files = parts.map((part, i) => {
    const file = path.join(tmp, `part${i}.mp4`);
    if (/\.png$/i.test(part)) {
      run(["-loop", "1", "-framerate", String(FPS), "-t", "1.5", "-i", part, "-vf", "scale=1920:1080:flags=lanczos:out_range=tv,format=yuv420p,fade=t=in:st=0:d=0.25", "-c:v", "libx264", "-crf", "10", "-an", file]);
    } else {
      run(["-i", part, "-vf", `scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0F100E,fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-crf", "10", "-an", file]);
    }
    return file;
  });
  const joined = path.join(tmp, "joined.mp4");
  joinSegments(files, joined);
  withSilence(joined, out, 18);
  fs.rmSync(tmp, { recursive: true, force: true });
  report([out]);
}

/** `name=<capture dir>` (recordedAt from the capture's start mark) or `name=<ISO time>` (the hero: the earliest loop's); durationSec from the encoded site MP4. */
function updateManifest(entries) {
  const file = path.join(ROOT, "apps/web/public/videos/manifest.json");
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  for (const e of entries) {
    const [name, src] = e.split("=");
    const t = /^\d{4}-\d{2}-\d{2}T/.test(src)
      ? { marks: { start: Date.parse(src) / 1000 } }
      : JSON.parse(fs.readFileSync(path.join(path.resolve(src), "timeline.json"), "utf8"));
    const secs = duration(path.join(ROOT, "apps/web/public/videos", `${name}.mp4`));
    manifest[name] = {
      cluster: "localnet",
      recordedAt: new Date(Math.round(t.marks.start) * 1000).toISOString(),
      durationSec: Math.round(secs * 10) / 10,
    };
  }
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(fs.readFileSync(file, "utf8"));
}

function report(files) {
  for (const f of files) {
    const info = probe(f, "stream=codec_name,width,height:format=duration").split("\n").join(" ");
    console.log(`${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB  ${info}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "site": {
    const secs = encodeSite(path.resolve(rest[0]), rest[1]);
    console.log(`duration ${secs.toFixed(2)} s`);
    break;
  }
  case "x":
    encodeX(path.resolve(rest[0]), rest[1]);
    break;
  case "hero":
    encodeHero(path.resolve(rest[0]), rest.slice(1));
    break;
  case "manifest":
    updateManifest(rest);
    break;
  default:
    throw new Error("usage: record-demos-encode.mjs site|x|hero|manifest …");
}
