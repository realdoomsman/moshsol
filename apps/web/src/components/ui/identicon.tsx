import { hashString, IDENTICON_TONES } from "@/lib/theme";
import { cn } from "./cn";

/** mulberry32: a tiny deterministic PRNG seeded from the address hash. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wallet identicon (§3.7): a deterministic 5×5 mirrored pixel pattern from the pubkey in two tones,
 * clipped to a circle ("people are round"). Pass `src` to show a profile avatar instead.
 */
export function Identicon({
  address,
  size = 24,
  src,
  className,
}: {
  address: string;
  size?: number;
  /** Profile avatar URL; replaces the pattern when set. */
  src?: string | null;
  className?: string;
}) {
  if (src) {
    return (
      // Indexer-hosted uploads; next/image would need a per-deployment remote allowlist.
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full bg-sunken object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const rand = prng(hashString(address));
  const bg = Math.floor(rand() * IDENTICON_TONES.length);
  const fg = (bg + 1 + Math.floor(rand() * (IDENTICON_TONES.length - 1))) % IDENTICON_TONES.length;
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (rand() < 0.5) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  return (
    <svg
      viewBox="0 0 5 5"
      width={size}
      height={size}
      aria-hidden
      shapeRendering="crispEdges"
      className={cn("shrink-0 rounded-full", className)}
      // Background: a wash of the second tone over the page colour, so the pattern reads on the dark ground.
      style={{ background: `color-mix(in oklab, ${IDENTICON_TONES[bg]} 30%, var(--color-paper))` }}
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={IDENTICON_TONES[fg]} />
      ))}
    </svg>
  );
}
