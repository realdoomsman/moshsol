#!/usr/bin/env node
/**
 * Builds the three X videos with audio in brand/x/video/final/ (1920×1080 H.264 High yuv420p 30 fps + AAC,
 * a .srt next to each), plus a 1080×1350 4:5 cut of the explainer:
 *
 *   holdfast-explainer.mp4  five beats (title cards from record-demos-cards.mjs) cut with the product
 *                           captures of record-demos-capture.mjs and the money-split motion page
 *   the-bundle.mp4          product demo: 'Launch now' → one instruction creates + buys → vault card → LIVE
 *   vault-agent.mp4         motion-graphics explainer rendered frame by frame from brand/x/video/src/vault-agent.html
 *
 * Voiceover is Gemini TTS, music is Lyria (key in .secrets/gemini-api-key, never printed); both are cached under
 * .localnet/demo/final/audio so re-cuts don't re-generate. Every clip's length follows its voiceover line, so
 * the picture is cut to the read, not the other way round. The 4:5 cut burns the captions in (brand font);
 * the 16:9 files ship with a sidecar .srt for X. Run `record-demos-cards.mjs` first (title cards).
 *
 *   node scripts/src/record-demos-final.mjs explainer|bundle|agent|all [--cap .localnet/demo/cap2] [--fresh-audio]
 *   node scripts/src/record-demos-final.mjs check            → contact sheets, ffprobe and ebur128 reports
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CARDS, INK, LINE, MUTED, ORANGE, PAPER, cardHtml, fontFaces, logoSvg, withChrome } from "./record-demos-cards.mjs";
import { FADE, FPS, duration, joinSegments, renderSegment, run, timeOf } from "./record-demos-encode.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const CAP = path.resolve(ROOT, flag("cap", ".localnet/demo/cap2"));
const WORK = path.resolve(ROOT, ".localnet/demo/final");
const AUDIO = path.join(WORK, "audio");
const OUT = path.resolve(ROOT, "brand/x/video/final");
const CARDS_DIR = path.resolve(ROOT, "brand/x/video/cards");
const FRESH_AUDIO = args.includes("--fresh-audio");
const FRESH_VOICE = FRESH_AUDIO || args.includes("--fresh-voice");
const KEY = fs.readFileSync(path.join(ROOT, ".secrets/gemini-api-key"), "utf8").trim();

const VOICE = "Puck";
const STYLE = "Say this in a calm, confident, natural voice, at a normal speaking speed: ";
const CARD_SECS = 2.2;
const LEAD = 0.5; // voiceover starts this long after its beat's first frame
const TAIL = 0.7; // picture outlives the line by this much
const VO_LUFS = -16;
const MUSIC_LUFS = -25;
const DUCK_DB = -8;

// ---------------------------------------------------------------- scripts (say: for the ear · cap: numerals, for the .srt)

/** Explainer beats: title card (from CARDS) + footage; `fill` segments stretch to the line. ≤ 150 words spoken. */
const EXPLAINER = [
  { id: "open", card: "00-open", cardSecs: 3.0, say: "Back a token before it hits pump dot fun.", cap: "Back a token before it hits pump.fun." },
  {
    id: "back", card: "01-back",
    say: "Backers pool sol before the token exists — at least one sol. Miss the minimum, and everyone is refunded in full.",
    cap: "Backers pool SOL before the token exists, at least 1 SOL. Miss the minimum and everyone is refunded in full.",
    parts: [{ cap: "back-a-raise", from: "start+0.4", fill: true, min: 8, crop: { x: 0, y: 0, w: 1600, h: 900 }, zoom: "in", third: ["Back the raise", "Min 1 SOL · beta caps 50 SOL per launch, 5 SOL per wallet · miss the minimum, 100% refund"] }],
  },
  {
    id: "bundle", card: "02-bundle",
    say: "At launch, one instruction creates the token on pump dot fun and makes the first buy with the pool. Nothing can get in between.",
    cap: "At launch, one instruction creates the token on pump.fun and makes the first buy with the pool. Nothing can get in between.",
    parts: [
      { cap: "the-bundle", from: "start+0.6", to: "live+1.2", crop: { x: 0, y: 60, w: 1600, h: 900 }, zoom: "in", third: ["Launch: create, then buy, in one instruction", "The pooled SOL buys before any public trade can exist"] },
      { cap: "the-bundle", from: "live+1.2", fill: true, min: 4, crop: { rect: "vaultLive", pad: 24, maxH: 560, aspect: 16 / 9 }, zoom: "out", third: ["The bundle is in the vault", "Live on pump.fun · traded only by the vault agent"] },
    ],
  },
  {
    id: "agent", card: "03-agent",
    say: "That bundle sits in a program vault, worked by a rate-limited vault agent. It sells small clips into strength, buys back dips, and every trade passes the program's checks: two percent band, three percent impact, hourly budgets.",
    cap: "That bundle sits in a program vault, worked by a rate-limited vault agent. It sells small clips into strength, buys back dips, and every trade passes the program's checks: 2% band, 3% impact, hourly budgets.",
    parts: [
      { cap: "agent-defends", from: "dump-0.6", to: "dump+4.6", crop: { x: 0, y: 180, w: 1600, h: 900 }, zoom: "in", third: ["A dump hits the chart", "Price drops under the 2% band around the EMA"] },
      { cap: "agent-defends", from: "agent-0.4", to: "agent+3.8", crop: { rect: "activity", pad: 16, maxH: 560, aspect: 16 / 9 }, zoom: "out", third: ["The vault agent buys the dip back", "≥ 2% under the EMA · below its average sell · impact ≤ 3%"] },
      { cap: "agent-defends", from: "narrated-0.2", fill: true, min: 4, crop: { rect: "activity", pad: 16, maxH: 560, aspect: 16 / 9 }, zoom: "in", third: ["Every decision narrated on the launch page", "AI explains the trade · the program checks it · AI never trades"] },
    ],
  },
  {
    id: "money", card: "04-money",
    say: "Creator fees split three ways: seventy-five percent to the vault, fifteen percent buys and burns the Holdfast token, ten percent goes to backers. What the agent sells for stays in the vault.",
    cap: "Creator fees split three ways: 75% to the vault, 15% buys and burns the Holdfast token, 10% goes to backers. What the agent sells for stays in the vault.",
    parts: [{ motion: "money-split", fill: true, min: 7 }],
  },
  {
    id: "paid", card: "05-paid",
    say: "When the vault's liquid sol is five times what went in and the chart is strong, backers are paid back: principal first, then fifteen percent of the vault, at most once per four hours.",
    cap: "When the vault's liquid SOL is 5× what went in and the chart is strong, backers are paid back: principal first, then 15% of the vault, at most once per 4 h.",
    parts: [
      { cap: "payout", from: "vault-2.0", to: "vault+0.6", crop: { rect: "vault", pad: 24, maxH: 560, anchor: "bottom", aspect: 16 / 9 }, zoom: "in", third: ["Payback target: vault liquid SOL at 5× what went in", "Checked on-chain by the payout instruction · a dip always comes first"] },
      { cap: "payout", from: "paid-1.2", to: "paid+3.0", crop: { rect: "activity", pad: 16, maxH: 560, aspect: 16 / 9 }, zoom: "out", third: ["Paid backers", "Principal first · then 15% of the vault · at most once per 4 h"] },
      { cap: "payout", from: "portfolio+0.3", fill: true, min: 4, crop: { x: 0, y: 0, w: 1600, h: 900 }, zoom: "in", third: ["Principal repaid · claim any time", "One claim button · Google sign-in gives a custodial wallet with an exportable key"] },
    ],
  },
  { id: "close", card: "06-close", cardSecs: 3.6, say: "Holdfast dot fun.", cap: "holdfast.fun" },
];

const BUNDLE = [
  { id: "open", cardDef: { file: "b0", kicker: "The bundle", title: "One instruction: create, then buy", sub: "The pooled SOL buys first. Nothing can get in between." }, cardSecs: 2.6, say: "Until launch, nothing trades.", cap: "Until launch, nothing trades." },
  {
    id: "launch",
    say: "Then one instruction does two things: it creates the token on pump dot fun, and it makes the first buy with the backers' pool. Create, then buy. Nothing can get in between.",
    cap: "Then one instruction does two things: it creates the token on pump.fun, and it makes the first buy with the backers' pool. Create, then buy. Nothing can get in between.",
    parts: [
      { cap: "the-bundle", from: "start+0.6", to: "live+1.0", crop: { x: 0, y: 60, w: 1600, h: 900 }, zoom: "in", third: ["Launch now", "One instruction: pump.fun Create, then the bundle Buy · nothing between"] },
      { cap: "the-bundle", from: "live+1.0", fill: true, min: 5, crop: { x: 0, y: 560, w: 1600, h: 900 }, zoom: "out", third: ["Live on pump.fun · no trade before the bundle", "The first public trade prices from where the bundle bought"] },
    ],
  },
  {
    id: "vault",
    say: "The bundle lands in the program vault, and the token is live.",
    cap: "The bundle lands in the program vault, and the token is live.",
    parts: [{ cap: "the-bundle", from: "live+1.0", fill: true, min: 5, crop: { rect: "vaultLive", pad: 24, maxH: 560, aspect: 16 / 9 }, zoom: "out", third: ["The bundle is in the vault · LIVE", "Only the vault agent trades it · everything it sells for stays in the vault"] }],
  },
  { id: "close", card: "06-close", cardSecs: 2.8, say: "Holdfast dot fun.", cap: "holdfast.fun" },
];

/** Vault-agent scenes map 1:1 to the motion page's scenes; durations stretch to the lines. ≤ 100 words spoken. */
const AGENT = [
  { id: "intro", min: 2.4, say: "The vault agent.", cap: "The vault agent." },
  { id: "sell", min: 9.5, say: "It never trades inside a two percent band around the moving average. Into strength, it sells small clips: only above cost, never more than three percent impact.", cap: "It never trades inside a 2% band around the moving average. Into strength, it sells small clips: only above cost, never more than 3% impact." },
  { id: "buy", min: 7.5, say: "Into a dip, it buys back: at or below cost, or under its own average sell.", cap: "Into a dip, it buys back: at or below cost, or under its own average sell." },
  { id: "budget", min: 8.0, say: "Per hour: ten percent of the vault's sol, five percent of its tokens. A zero point one sol floor always stays.", cap: "Per hour: 10% of the vault's SOL, 5% of its tokens. A 0.1 SOL floor always stays." },
  { id: "payout", min: 9.5, say: "At five times what went in, with a strong chart, backers are paid back: principal first, then fifteen percent of the vault.", cap: "At 5× what went in, with a strong chart, backers are paid back: principal first, then 15% of the vault." },
  { id: "outro", min: 2.5, say: "Holdfast dot fun.", cap: "holdfast.fun" },
];

const MUSIC = {
  explainer: "Minimal dark electronic instrumental, 88 bpm, warm sub bass, soft arpeggio, light hi-hat pulse, no drum drops, steady and calm, no vocals, loopable, understated bed for a narrated product explainer.",
  bundle: "Minimal electronic instrumental, 100 bpm, tight soft pulse, warm sub bass, sparse synth stabs, no vocals, no drops, calm forward momentum, understated bed for narration.",
  agent: "Ambient electronic instrumental, 80 bpm, slow arpeggio, warm pads, gentle pulse, no vocals, no drum drops, contemplative and steady, understated bed for narration.",
};

// ---------------------------------------------------------------- audio generation (cached)

/** One generateContent call; returns the inline audio part. Retries 503s and empty generations (Lyria occasionally returns no candidate). */
async function geminiAudio(model, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (r.ok && part) return Buffer.from(part.inlineData.data, "base64");
    if ((r.status === 503 || (r.ok && !part)) && attempt < 4) {
      console.log(`${model}: ${r.ok ? `no audio (${JSON.stringify(j).slice(0, 200)})` : "503"}, retrying`);
      await new Promise((res) => setTimeout(res, 4000));
      continue;
    }
    throw new Error(`${model}: ${JSON.stringify(j).slice(0, 300)}`);
  }
}

/** One voiceover line → 24 kHz mono WAV (cached by video + beat id). */
async function voice(video, beat) {
  fs.mkdirSync(AUDIO, { recursive: true });
  const wav = path.join(AUDIO, `vo-${video}-${beat.id}-${createHash("sha1").update(VOICE + STYLE + beat.say).digest("hex").slice(0, 8)}.wav`);
  if (!fs.existsSync(wav) || FRESH_VOICE) {
    const pcm = `${wav}.pcm`;
    fs.writeFileSync(pcm, await geminiAudio("gemini-2.5-flash-preview-tts", {
      contents: [{ parts: [{ text: STYLE + beat.say }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
    }));
    // Trim silence at both ends so the line's measured length is the spoken length.
    run(["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm, "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse", wav]);
    fs.rmSync(pcm);
  }
  return { file: wav, secs: duration(wav) };
}

/** Lyria bed for a video: three candidates, the steadiest (lowest loudness range) is used. Cached. */
async function music(video) {
  fs.mkdirSync(AUDIO, { recursive: true });
  const pick = path.join(AUDIO, `music-${video}.mp3`);
  if (fs.existsSync(pick) && !FRESH_AUDIO) return pick;
  const candidates = [];
  for (let i = 0; i < 3; i++) {
    const file = path.join(AUDIO, `music-${video}-${i}.mp3`);
    if (!fs.existsSync(file) || FRESH_AUDIO) fs.writeFileSync(file, await geminiAudio("lyria-3-pro-preview", { contents: [{ parts: [{ text: MUSIC[video] }] }] }));
    const { lra } = measure(file);
    candidates.push({ file, lra });
    console.log(`${path.relative(ROOT, file)}  LRA ${lra} LU`);
  }
  candidates.sort((a, b) => a.lra - b.lra);
  fs.copyFileSync(candidates[0].file, pick);
  return pick;
}

/** ebur128 summary of a file (or a window of it): integrated loudness, LRA, true peak. */
function measure(file, ss, t) {
  const text = ffmpegStderr([...(ss !== undefined ? ["-ss", String(ss)] : []), ...(t !== undefined ? ["-t", String(t)] : []), "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = text.slice(text.lastIndexOf("Summary:")); // per-frame lines above it carry their own I/LRA
  const num = (re) => Number((re.exec(summary) ?? [])[1]);
  return { i: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}
/** ffmpeg's reports (ebur128, loudnorm) go to stderr. */
function ffmpegStderr(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-800)}`);
  return r.stderr;
}

/**
 * Mixes the lines (placed at their start times) over the bed: speech at −16 LUFS (measured on the lines
 * butted together, so the gaps between them don't make the read hot), music at −25 LUFS ducked 8 dB under
 * every line, then a limiter at −1.5 dBFS sample peak. A whole-file loudnorm is deliberately not applied: the silences
 * between lines would drag the integrated value down and push the voice to about −13 LUFS.
 * Writes the stems too (for the listen check).
 */
function mixAudio(name, lines, bed, total) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  const inputs = lines.flatMap((l) => ["-i", l.file]);
  const speech = path.join(dir, "speech-only.wav");
  run([...inputs, "-filter_complex", `${lines.map((_, i) => `[${i}:a]`).join("")}concat=n=${lines.length}:v=0:a=1[s]`, "-map", "[s]", "-c:a", "pcm_s16le", speech]);
  const voGain = VO_LUFS - measure(speech).i;
  fs.rmSync(speech);
  const vo = path.join(dir, "vo-stem.wav");
  const chains = lines.map((l, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(l.start * 1000)}:all=1[v${i}]`).join(";");
  run([...inputs, "-filter_complex", `${chains};${lines.map((_, i) => `[v${i}]`).join("")}amix=inputs=${lines.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)},volume=${voGain.toFixed(2)}dB,alimiter=limit=0.84:level=false[vo]`, "-map", "[vo]", "-c:a", "pcm_s16le", vo]);
  // Music: trimmed, faded, levelled, then ducked by an envelope built from the line times (0.5 s ramps).
  const mu = path.join(dir, "music-stem.wav");
  run(["-t", total.toFixed(3), "-i", bed, "-af", `aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=1.5,afade=t=out:st=${(total - 2.5).toFixed(3)}:d=2.5`, "-c:a", "pcm_s16le", mu]);
  const muGain = MUSIC_LUFS - measure(mu).i;
  const R = 0.5;
  const env = lines.map((l) => `(clip((t-${(l.start - 0.2 - R).toFixed(3)})/${R},0,1)*clip((${(l.start + l.secs + 0.3 + R).toFixed(3)}-t)/${R},0,1))`).reduce((a, b) => `max(${a},${b})`);
  const duck = Math.pow(10, DUCK_DB / 20);
  run(["-i", mu, "-af", `volume=${muGain.toFixed(2)}dB,volume=volume='1-(1-${duck.toFixed(4)})*${env}':eval=frame`, "-c:a", "pcm_s16le", `${mu}.tmp.wav`]);
  fs.renameSync(`${mu}.tmp.wav`, mu);
  const mix = path.join(dir, "mix.wav");
  run(["-i", vo, "-i", mu, "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.84:level=false[m]", "-map", "[m]", "-ar", "48000", "-c:a", "pcm_s16le", mix]);
  return { mix, vo, mu };
}

// ---------------------------------------------------------------- picture

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Title card PNG → clip: fade in, hold. */
function cardClip(png, secs, out) {
  run(["-loop", "1", "-framerate", String(FPS), "-t", secs.toFixed(3), "-i", png, "-vf", "scale=1920:1080:flags=lanczos:out_range=tv,format=yuv420p,fade=t=in:st=0:d=0.3", "-c:v", "libx264", "-crf", "10", "-an", out]);
  return out;
}

const thirdHtml = ([title, sub]) => `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;background:transparent;overflow:hidden;position:relative}
.disp{font-family:MonaDisplay,Mona,sans-serif;font-stretch:112.5%;font-weight:640;letter-spacing:-0.04em;line-height:1}
.ui{font-family:Mona,sans-serif}
</style></head><body>
<div style="position:absolute;left:96px;bottom:84px;display:flex;align-items:stretch;gap:22px;max-width:1500px">
  <div style="width:6px;border-radius:3px;background:${ORANGE};flex:none"></div>
  <div style="background:rgba(15,16,14,0.9);border:1px solid ${LINE};border-radius:10px;padding:20px 28px 22px">
    <div class="disp" style="font-size:48px;color:${PAPER}">${title}</div>
    <div class="ui" style="font-size:32px;color:#A9A89F;margin-top:10px;line-height:1.3">${sub}</div>
  </div>
</div>
</body></html>`;

/**
 * Slow push (in or out, 4%) and the lower-third fading in after 0.5 s and out 0.7 s before the end. The push is
 * a per-frame `perspective` crop (cubic): a dynamic `scale` crashes ffmpeg 9 when the size shrinks frame to frame.
 */
function dress(input, secs, { zoom, thirdPng }, out) {
  const n = Math.round(secs * FPS);
  const z = zoom === "out" ? `(1.04-0.04*on/${n})` : `(1+0.04*on/${n})`;
  const x0 = `(W-W/${z})/2`, y0 = `(H-H/${z})/2`;
  const push = zoom ? `perspective=x0='${x0}':y0='${y0}':x1='W-${x0}':y1='${y0}':x2='${x0}':y2='H-${y0}':x3='W-${x0}':y3='H-${y0}':interpolation=cubic:eval=frame,` : "";
  if (!thirdPng) {
    run(["-i", input, "-vf", `${push}format=yuv420p`, "-c:v", "libx264", "-crf", "10", "-an", out]);
    return out;
  }
  run(["-i", input, "-loop", "1", "-i", thirdPng, "-filter_complex", `[0:v]${push}format=yuv420p[v];[1:v]format=rgba,fade=t=in:st=0.5:d=0.4:alpha=1,fade=t=out:st=${(secs - 0.7).toFixed(3)}:d=0.4:alpha=1[lt];[v][lt]overlay=shortest=1:format=auto,format=yuv420p[o]`, "-map", "[o]", "-c:v", "libx264", "-crf", "10", "-an", out]);
  return out;
}

/** Footage clip from a capture (renderSegment: crop, lanczos, 30 fps) of exactly `secs`, then dressed. */
function footageClip(part, secs, thirdPng, out) {
  const capDir = path.join(CAP, part.cap);
  const t = JSON.parse(fs.readFileSync(path.join(capDir, "timeline.json"), "utf8"));
  const from = timeOf(part.from, t.marks);
  const raw = `${out}.raw.mp4`;
  renderSegment(capDir, t, [from, from + secs, part.crop], { w: 1920, h: 1080 }, raw);
  dress(raw, secs, { zoom: part.zoom, thirdPng }, out);
  fs.rmSync(raw);
  fs.rmSync(`${raw}.ffconcat`, { force: true });
  return out;
}

/** Frame-stepped render of a motion page: `render(t)` per frame, screenshots, encode. */
async function motionClip(page, configure, out, label) {
  const src = fs.readFileSync(path.join(ROOT, "brand/x/video/src", `${page}.html`), "utf8").replace("/*FONTS*/", fontFaces()).replaceAll("<!--LOGO-->", logoSvg());
  const frames = tmpDir("hf-motion-");
  let n = 0;
  await withChrome({ port: 9341 }, async (tab) => {
    await tab.navigate(src);
    await tab.eval(`window.configure(${JSON.stringify(configure)})`);
    const total = await tab.eval("window.ready()");
    n = Math.round(total * FPS);
    for (let i = 0; i < n; i++) {
      await tab.eval(`(async () => { window.render(${(i / FPS).toFixed(4)}); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
      await tab.screenshot(path.join(frames, `f${String(i).padStart(5, "0")}.png`));
      if (i % 150 === 0) console.log(`${label}: frame ${i}/${n}`);
    }
  });
  run(["-framerate", String(FPS), "-i", path.join(frames, "f%05d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "10", "-an", out]);
  fs.rmSync(frames, { recursive: true, force: true });
  return { out, secs: n / FPS };
}

/** Final mux: H.264 High 4.2 (crf stepped until ≤ 100 MB), AAC 192 kbps, faststart. */
function mux(video, audio, out) {
  for (const crf of [18, 20, 23]) {
    run([
      "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest", out,
    ]);
    if (fs.statSync(out).size <= 100 * 1024 * 1024) break;
  }
}

/**
 * 4:5 feed cut (1080×1350): the 16:9 picture on ink, the wordmark in the top band and the captions burned
 * into the bottom band in the brand font (libass reads the TTF that the brand HTML embeds).
 */
async function muxTall(video, audio, cues, dir, out) {
  const fonts = path.join(dir, "fonts");
  fs.mkdirSync(fonts, { recursive: true });
  const face = fontFaces().split("\n").find((l) => l.includes("font-family:Mona;") && l.includes("font-weight:400"));
  fs.writeFileSync(path.join(fonts, "mona.ttf"), Buffer.from(/base64,([^)]+)\)/.exec(face)[1], "base64"));
  const assTime = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  const ass = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1350", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cap,Mona Sans ExtraLight,42,&H00ECF1F2,&H00ECF1F2,&H000E100F,&H000E100F,0,0,0,0,100,100,0,0,1,0,0,2,72,72,150,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`),
  ].join("\n");
  fs.writeFileSync(path.join(dir, "captions.ass"), ass + "\n");
  const frame = path.join(dir, "frame-4x5.png");
  await withChrome({ port: 9340, width: 1080, height: 1350, transparent: true }, (tab) => tab.shoot(frame, `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}
*{margin:0;padding:0}html,body{width:1080px;height:1350px;background:transparent;overflow:hidden;position:relative}
.label{font-family:Mona,sans-serif;font-weight:600;font-size:32px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}}</style></head><body>
<div style="position:absolute;left:72px;top:160px;display:flex;align-items:center;gap:14px">${logoSvg()}</div>
<div class="label" style="position:absolute;right:72px;top:168px;display:flex;align-items:center;gap:14px"><span style="width:12px;height:12px;border-radius:12px;background:${ORANGE}"></span>holdfast.fun</div>
</body></html>`));
  for (const crf of [18, 20, 23]) {
    run([
      "-i", video, "-i", audio, "-i", frame, "-filter_complex",
      "[0:v]scale=1080:-2:flags=lanczos,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=0x0F100E[p];[p][2:v]overlay=0:0[q];[q]subtitles=captions.ass:fontsdir=fonts,format=yuv420p[v]",
      "-map", "[v]", "-map", "1:a:0",
      "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest", out,
    ], { cwd: dir });
    if (fs.statSync(out).size <= 100 * 1024 * 1024) break;
  }
}

// ---------------------------------------------------------------- captions

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (v, n = 2) => String(v).padStart(n, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
/** Splits each line into cues of ≤ 2 rows × 42 chars, wrapped at the narrowest width that keeps the row count (no orphan words; a number stays with its unit), timed by character share of the spoken length. */
function cuesOf(lines) {
  const wrap = (text, width) => {
    const rows = [];
    let row = "";
    for (const w of text.split(" ")) {
      const next = `${row} ${w}`.trim();
      if (row && next.length > width) {
        rows.push(row);
        row = w;
      } else row = next;
    }
    rows.push(row);
    return rows;
  };
  const cues = [];
  for (const l of lines) {
    const text = l.cap.replace(/(\d[\d.,×%]*) (SOL|h)\b/g, "$1\u00A0$2");
    let rows = wrap(text, 42);
    for (let width = 41; width >= 26; width--) {
      const tighter = wrap(text, width);
      if (tighter.length !== rows.length) break;
      rows = tighter;
    }
    const chunks = [];
    for (let i = 0; i < rows.length; i += 2) chunks.push(rows.slice(i, i + 2).join("\n").replaceAll("\u00A0", " "));
    const chars = chunks.reduce((a, c) => a + c.length, 0);
    let t = l.start;
    for (const c of chunks) {
      const d = (l.secs * c.length) / chars;
      cues.push({ start: t, end: t + d + (c === chunks.at(-1) ? 0.4 : 0), text: c });
      t += d;
    }
  }
  return cues;
}
function srt(cues, out) {
  fs.writeFileSync(out, cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n") + "\n");
  return out;
}

// ---------------------------------------------------------------- assembly

/** Beat timeline: per beat, card then parts; `fill` parts stretch so the beat holds LEAD + line + TAIL. Returns parts to render and VO placements. */
async function planBeats(video, beats) {
  const plan = [];
  const segSecs = (p) => {
    const t = JSON.parse(fs.readFileSync(path.join(CAP, p.cap, "timeline.json"), "utf8"));
    return timeOf(p.to, t.marks) - timeOf(p.from, t.marks);
  };
  for (const b of beats) {
    const vo = await voice(video, b);
    const need = LEAD + vo.secs + TAIL + FADE; // the next beat's card starts fading in FADE before this beat's last frame
    const parts = (b.parts ?? []).map((p) => ({ ...p, secs: p.fill ? 0 : segSecs(p) }));
    let cardSecs = b.cardSecs ?? (b.card || b.cardDef ? CARD_SECS : 0);
    if (!parts.length) cardSecs = Math.max(cardSecs, need); // a card-only beat holds for its line
    const joins = (cardSecs ? 1 : 0) + parts.length - 1; // cross-fades inside the beat eat FADE each
    const fill = parts.find((p) => p.fill);
    const have = cardSecs + parts.reduce((a, p) => a + p.secs, 0) - joins * FADE;
    if (fill) fill.secs = Math.max(fill.min ?? 3, need - have);
    plan.push({ ...b, vo, cardSecs, parts });
  }
  return plan;
}

async function buildBeats(name, video, beats) {
  const plan = await planBeats(video, beats);
  const dir = path.join(WORK, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Lower-thirds and ad-hoc cards in one Chrome session.
  const thirds = new Map();
  const cards = new Map();
  await withChrome({ port: 9340, transparent: true }, async (tab) => {
    for (const b of plan) for (const p of b.parts) if (p.third) {
      const png = path.join(dir, `third-${b.id}-${b.parts.indexOf(p)}.png`);
      await tab.shoot(png, thirdHtml(p.third));
      thirds.set(p, png);
    }
  });
  if (plan.some((b) => b.cardDef)) await withChrome({ port: 9340 }, async (tab) => {
    for (const b of plan) if (b.cardDef) {
      const png = path.join(dir, `card-${b.id}.png`);
      await tab.shoot(png, cardHtml(b.cardDef));
      cards.set(b, png);
    }
  });
  // Clips in order.
  const files = [];
  const starts = []; // beat start in the joined timeline
  let cursor = 0;
  for (const b of plan) {
    starts.push(cursor);
    const push = (file, secs) => {
      files.push(file);
      cursor += secs - (files.length > 1 ? FADE : 0);
    };
    if (b.cardSecs) {
      const png = cards.get(b) ?? path.join(CARDS_DIR, `${b.card}.png`);
      push(cardClip(png, b.cardSecs, path.join(dir, `clip-${files.length}.mp4`)), b.cardSecs);
    }
    for (const p of b.parts) {
      const out = path.join(dir, `clip-${files.length}.mp4`);
      if (p.motion) {
        const { secs } = await motionClip(p.motion, { total: p.secs }, out, p.motion);
        push(out, secs);
      } else {
        footageClip(p, p.secs, thirds.get(p), out);
        push(out, p.secs);
      }
      console.log(`${name}: ${b.id} part ${p.cap ?? p.motion} ${p.secs.toFixed(2)} s`);
    }
  }
  const joined = path.join(dir, "joined.mp4");
  joinSegments(files, joined);
  const total = duration(joined);
  const lines = plan.map((b, i) => ({ ...b.vo, start: starts[i] + LEAD, cap: b.cap }));
  const bed = await music(video);
  const { mix } = mixAudio(name, lines, bed, total);
  fs.mkdirSync(OUT, { recursive: true });
  const mp4 = path.join(OUT, `${name}.mp4`);
  mux(joined, mix, mp4);
  const cues = cuesOf(lines);
  srt(cues, path.join(OUT, `${name}.srt`));
  if (name === "holdfast-explainer") await muxTall(joined, mix, cues, dir, path.join(OUT, `${name}-4x5.mp4`));
  report(name, plan.map((b) => `${b.id}: ${b.cap}`));
}

async function buildAgent() {
  const name = "vault-agent";
  const dir = path.join(WORK, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const durations = {};
  const vos = [];
  for (const s of AGENT) {
    const vo = await voice("agent", s);
    durations[s.id] = Math.max(s.min, LEAD + vo.secs + TAIL);
    vos.push(vo);
  }
  const raw = path.join(dir, "motion.mp4");
  const { secs: total } = await motionClip("vault-agent", durations, raw, name);
  let t = 0;
  const lines = AGENT.map((s, i) => {
    const line = { ...vos[i], start: t + LEAD, cap: s.cap };
    t += durations[s.id];
    return line;
  });
  const bed = await music("agent");
  const { mix } = mixAudio(name, lines, bed, total);
  fs.mkdirSync(OUT, { recursive: true });
  mux(raw, mix, path.join(OUT, `${name}.mp4`));
  srt(cuesOf(lines), path.join(OUT, `${name}.srt`));
  report(name, AGENT.map((s) => `${s.id}: ${s.cap}`));
}

// ---------------------------------------------------------------- checks

function report(name, captions) {
  const mp4 = path.join(OUT, `${name}.mp4`);
  const info = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels:format=duration,size", "-of", "default=noprint_wrappers=1", mp4]).toString().trim();
  const secs = duration(mp4);
  const sheet = path.join(WORK, `sheet-${name}.jpg`);
  run(["-i", mp4, "-vf", `fps=1/2,scale=320:-1,tile=6x${Math.ceil(secs / 2 / 6)}`, "-frames:v", "1", "-q:v", "3", sheet]);
  // Listen check: a 10 s window in the middle of a line, on the final file and on the two stems.
  const dir = path.join(WORK, name);
  const ss = Math.max(0, Math.min(secs - 10, secs * 0.35));
  const lines = [`# ${name}`, info, "", `ebur128 over ${ss.toFixed(1)}–${(ss + 10).toFixed(1)} s`];
  for (const [label, file] of [["final mix", mp4], ["vo stem", path.join(dir, "vo-stem.wav")], ["music stem (ducked)", path.join(dir, "music-stem.wav")]]) {
    const m = measure(file, ss, 10);
    lines.push(`${label}: I ${m.i} LUFS · LRA ${m.lra} LU · true peak ${m.tp} dBFS`);
  }
  const whole = measure(mp4);
  lines.push(`whole file: I ${whole.i} LUFS · LRA ${whole.lra} LU · true peak ${whole.tp} dBFS`);
  const tall = path.join(OUT, `${name}-4x5.mp4`);
  if (fs.existsSync(tall)) lines.push("", `4:5 cut: ${execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration,size", "-of", "csv=p=0", tall]).toString().trim().split("\n").join(" · ")}`);
  lines.push("", "captions:", ...captions);
  fs.writeFileSync(path.join(WORK, `report-${name}.txt`), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`contact sheet: ${path.relative(ROOT, sheet)}`);
}

const [cmd] = args;
const jobs = {
  explainer: () => buildBeats("holdfast-explainer", "explainer", EXPLAINER),
  bundle: () => buildBeats("the-bundle", "bundle", BUNDLE),
  agent: buildAgent,
};
(async () => {
  if (cmd === "all") {
    for (const job of Object.values(jobs)) await job();
  } else if (cmd === "check") {
    for (const n of ["holdfast-explainer", "the-bundle", "vault-agent"]) if (fs.existsSync(path.join(OUT, `${n}.mp4`))) report(n, []);
  } else if (jobs[cmd]) {
    await jobs[cmd]();
  } else {
    throw new Error("usage: record-demos-final.mjs explainer|bundle|agent|all|check");
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
