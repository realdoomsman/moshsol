"use client";

import { useEffect, useMemo, useState } from "react";
import { useMounted } from "./hooks";

type Rgb = [number, number, number];

/** Background every accent is checked against (the page `--color-bg`). */
const BG: Rgb = [6, 7, 8];
const SAMPLE = 40;
const BINS = 24;

const extracted = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60 : max === gg ? ((bb - rr) / d + 2) * 60 : ((rr - gg) / d + 4) * 60;
  return [h, s, l];
}

/**
 * Vivid, legible accent from a hue family: saturation and lightness are clamped, then lightness is
 * raised until text in this colour clears 5:1 on the page background (so it can colour prices).
 */
function accent(rgb: Rgb): string {
  const [h, s, l] = toHsl(rgb);
  const sat = Math.min(0.92, Math.max(0.62, s));
  let light = Math.min(0.7, Math.max(0.56, l));
  let out = hsl(h, sat, light);
  while (contrast(out, BG) < 5 && light < 0.85) {
    light += 0.02;
    out = hsl(h, sat, light);
  }
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Deterministic fallback accent from the mint address (FNV-1a hash → hue). */
export function mintAccent(mint: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < mint.length; i++) {
    h ^= mint.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return accent(hsl((h >>> 0) % 360, 0.8, 0.62));
}

/**
 * Dominant vivid colour of an image: pixels are binned by hue and weighted by saturation, brightness
 * and alpha; the heaviest neighbourhood of bins wins. Greyscale art returns null.
 */
async function sample(src: string): Promise<string | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
  const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.5) continue;
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const val = max / 255;
    if (sat < 0.25 || val < 0.22) continue;
    const [h] = toHsl(rgb);
    const w = sat * sat * val * a;
    const bin = bins[Math.floor(h / (360 / BINS)) % BINS];
    bin.w += w;
    bin.r += rgb[0] * w;
    bin.g += rgb[1] * w;
    bin.b += rgb[2] * w;
    total += w;
  }
  // Only trust a hue that covers a meaningful share of the logo.
  if (total < SAMPLE * SAMPLE * 0.04) return null;
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < BINS; i++) {
    const w = bins[(i + BINS - 1) % BINS].w + bins[i].w * 2 + bins[(i + 1) % BINS].w;
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  const b = bins[best];
  return b.w > 0 ? accent([b.r / b.w, b.g / b.w, b.b / b.w].map(Math.round) as Rgb) : null;
}

function load(src: string): Promise<string | null> {
  let p = inflight.get(src);
  if (!p) {
    p = sample(src)
      .catch(() => null)
      .then((c) => {
        extracted.set(src, c);
        return c;
      });
    inflight.set(src, p);
  }
  return p;
}

/**
 * Accent colour for a token: sampled client-side from its logo, with a stable mint-derived fallback
 * that the server renders (and hydration reuses) until the sample is ready.
 */
export function useTokenColor(src: string | null | undefined, mint: string): string {
  const fallback = useMemo(() => mintAccent(mint), [mint]);
  const mounted = useMounted();
  const [sampled, setSampled] = useState<{ src: string; color: string | null } | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void load(src).then((color) => {
      if (alive) setSampled({ src, color });
    });
    return () => {
      alive = false;
    };
  }, [src]);
  if (!src) return fallback;
  // Cached samples apply immediately on client navigations, never during hydration.
  const color = sampled?.src === src ? sampled.color : mounted ? extracted.get(src) : undefined;
  return color ?? fallback;
}
