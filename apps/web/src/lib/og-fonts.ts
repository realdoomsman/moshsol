import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Brand fonts for `next/og` ImageResponse routes (Satori needs TTF, not the woff2 next/font serves).
 * Static Latin subsets of Mona Sans (400 / 600 at wdth 100, and the 640 / wdth 112.5 display cut) and
 * JetBrains Mono 400 live in `apps/web/assets/fonts`. Families: "Mona Sans" (400, 600),
 * "Mona Sans Display" (use weight 600) and "JetBrains Mono" (400).
 *
 *   new ImageResponse(<… style={{ fontFamily: "Mona Sans" }} />, { ...size, fonts: await ogFonts() })
 */
type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" };

const FILES: [name: string, file: string, weight: 400 | 600][] = [
  ["Mona Sans", "MonaSans-Regular.ttf", 400],
  ["Mona Sans", "MonaSans-SemiBold.ttf", 600],
  ["Mona Sans Display", "MonaSans-Display.ttf", 600],
  ["JetBrains Mono", "JetBrainsMono-Regular.ttf", 400],
];

let cache: Promise<OgFont[]> | null = null;

export function ogFonts(): Promise<OgFont[]> {
  cache ??= Promise.all(
    FILES.map(async ([name, file, weight]) => {
      const buf = await readFile(join(process.cwd(), "assets/fonts", file));
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return { name, data, weight, style: "normal" as const };
    }),
  );
  return cache;
}
