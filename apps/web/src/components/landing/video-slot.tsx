import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { CLUSTER_NAME, type Cluster } from "@/lib/env";
import { cn } from "../ui/cn";
import { DemoVideo, type DemoSource } from "./demo-video";

/** The product-loop recordings (§3.9), set up by `scripts/src/record-demos.ts` (`pnpm record:demos`), plus the hero's launch recording. */
export type DemoName = "launch-in-a-minute" | "back-a-raise" | "the-bundle" | "agent-defends" | "payout";

const DIR = join(process.cwd(), "public", "videos");

/** Where each recording was made (`public/videos/manifest.json`, written when the loops are recorded). */
interface RecordingInfo {
  cluster: Cluster;
  recordedAt: string;
  durationSec: number;
}

function readManifest(): Partial<Record<DemoName, RecordingInfo>> {
  try {
    return JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as Partial<Record<DemoName, RecordingInfo>>;
  } catch {
    return {};
  }
}

/** "Recorded on …" wording per cluster; a localnet capture is not a devnet one. */
const RECORDED_ON: Record<Cluster, string> = {
  localnet: "a local Solana validator",
  devnet: "devnet",
  "mainnet-beta": "mainnet",
};

/** Per-file memo keyed on mtime, so a re-recorded file is picked up without re-reading it on every render. */
const fileMemo = new Map<string, { mtimeMs: number; value: unknown }>();
function memoByMtime<T>(file: string, read: () => T): T {
  const { mtimeMs } = statSync(file);
  const hit = fileMemo.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;
  const value = read();
  fileMemo.set(file, { mtimeMs, value });
  return value;
}

/** Seconds from an MP4's `mvhd` box (movie header), or null when it can't be read. */
function mp4Duration(file: string): number | null {
  try {
    return memoByMtime(file, () => {
      const buf = readFileSync(file);
      const at = buf.indexOf("mvhd");
      if (at < 0) return null;
      const v1 = buf[at + 4] === 1;
      const timescale = buf.readUInt32BE(at + (v1 ? 24 : 16));
      const duration = v1 ? Number(buf.readBigUInt64BE(at + 28)) : buf.readUInt32BE(at + 20);
      return timescale > 0 ? duration / timescale : null;
    });
  } catch {
    return null;
  }
}

/** Pixel size from a JPEG's SOFn header (first 64 KB), or null when it can't be read. */
function jpegSize(file: string): { width: number; height: number } | null {
  try {
    return memoByMtime(file, () => {
      const fd = openSync(file, "r");
      const buf = Buffer.alloc(65536);
      const len = readSync(fd, buf, 0, buf.length, 0);
      closeSync(fd);
      let at = 2;
      while (at + 9 < len && buf[at] === 0xff) {
        const marker = buf[at + 1]!;
        // SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but don't.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
        }
        at += 2 + buf.readUInt16BE(at + 2);
      }
      return null;
    });
  } catch {
    return null;
  }
}

/** The files present for one recording (desktop or `-m` mobile cut); null when none exist. */
function findSource(base: string): DemoSource | null {
  // Literal extensions keep these paths statically traceable (a computed one makes the build trace the whole repo).
  const webm = statSync(join(DIR, `${base}.webm`), { throwIfNoEntry: false });
  const mp4 = statSync(join(DIR, `${base}.mp4`), { throwIfNoEntry: false });
  // Smallest encode first: the browser plays the first type it supports, and both play everywhere we ship.
  const sources = [
    ...(webm ? [{ src: `/videos/${base}.webm`, type: "video/webm", bytes: webm.size }] : []),
    ...(mp4 ? [{ src: `/videos/${base}.mp4`, type: "video/mp4", bytes: mp4.size }] : []),
  ].sort((a, b) => a.bytes - b.bytes);
  if (!sources.length) return null;
  const poster = join(DIR, `${base}.jpg`);
  const size = existsSync(poster) ? jpegSize(poster) : null;
  return {
    sources: sources.map(({ src, type }) => ({ src, type })),
    poster: size ? { src: `/videos/${base}.jpg`, ...size } : null,
  };
}

/**
 * A product-loop slot (§3.9): if `/public/videos/<name>.{mp4,webm}` exist at render time it plays
 * the recording (with the `-m` cut below 768px when present, poster, in-view autoplay); until then
 * it renders `fallback`, a live component bound to live cluster data — never a broken video. Framed as a
 * 12px `surface` panel with a 32px caption row.
 */
export function VideoSlot({
  name,
  label,
  fallback,
  fallbackCaption,
  className,
}: {
  name: DemoName;
  /** Accessible description of the recording. */
  label: string;
  fallback: ReactNode;
  /** Caption under the live fallback, e.g. "Live from devnet · $MOSH" (cluster from `CLUSTER_NAME`). */
  fallbackCaption: ReactNode;
  className?: string;
}) {
  const desktop = findSource(name);
  const mobile = findSource(`${name}-m`);
  const src = desktop ?? mobile;
  const info = src ? readManifest()[name] : undefined;
  const mp4 = src ? join(DIR, `${desktop ? name : `${name}-m`}.mp4`) : null;
  // Round once, then split: rounding only the seconds part turns 59.6s into "0:60".
  const seconds = Math.round(info?.durationSec ?? (mp4 && existsSync(mp4) ? mp4Duration(mp4) : null) ?? 0);
  const caption = src
    ? `Recorded on ${info ? RECORDED_ON[info.cluster] : CLUSTER_NAME}${seconds ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}`
    : fallbackCaption;
  return (
    <figure className={cn("w-full", className)}>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        {src ? <DemoVideo desktop={desktop} mobile={mobile} label={label} /> : fallback}
      </div>
      <figcaption className="micro flex h-8 items-center text-ink-3">{caption}</figcaption>
    </figure>
  );
}
