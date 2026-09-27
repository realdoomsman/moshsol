import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { CLUSTER_NAME, type Cluster } from "@/lib/env";
import { cn } from "../ui/cn";
import { DemoVideo, type DemoSource } from "./demo-video";

/** The four product-loop recordings (§3.9), set up by `scripts/src/record-demos.ts` (`pnpm record:demos`). */
export type DemoName = "back-a-raise" | "the-lock" | "agent-defends" | "claim";

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

/** Seconds from an MP4's `mvhd` box (movie header), or null when it can't be read. */
function mp4Duration(file: string): number | null {
  try {
    const buf = readFileSync(file);
    const at = buf.indexOf("mvhd");
    if (at < 0) return null;
    const v1 = buf[at + 4] === 1;
    const timescale = buf.readUInt32BE(at + (v1 ? 24 : 16));
    const duration = v1 ? Number(buf.readBigUInt64BE(at + 28)) : buf.readUInt32BE(at + 20);
    return timescale > 0 ? duration / timescale : null;
  } catch {
    return null;
  }
}

/** The files present for one recording (desktop or `-m` mobile cut); null when none exist. */
function findSource(base: string): DemoSource | null {
  const mp4 = existsSync(join(DIR, `${base}.mp4`));
  const webm = existsSync(join(DIR, `${base}.webm`));
  if (!mp4 && !webm) return null;
  return {
    webm: webm ? `/videos/${base}.webm` : null,
    mp4: mp4 ? `/videos/${base}.mp4` : null,
    poster: existsSync(join(DIR, `${base}.jpg`)) ? `/videos/${base}.jpg` : null,
    seconds: mp4 ? mp4Duration(join(DIR, `${base}.mp4`)) : null,
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
  const seconds = info?.durationSec ?? src?.seconds;
  const caption = src
    ? `Recorded on ${info ? RECORDED_ON[info.cluster] : CLUSTER_NAME}${seconds ? ` · ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : ""}`
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
