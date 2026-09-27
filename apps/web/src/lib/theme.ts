/**
 * Theme facts that live outside CSS. Colour tokens themselves are in app/globals.css (§7.1); this
 * file only holds values the browser chrome or generated artwork needs as literals.
 */

export type Theme = "paper" | "night";

/** `<meta name="theme-color">` per surface (= the `paper` token of each theme). */
export const THEME_COLOR: Record<Theme, string> = {
  paper: "#F6F5F1",
  night: "#0F100E",
};

/**
 * Wallet identicon tones (§3.7): 12 warm/neutral hues derived from the ink and accent families,
 * as OKLCH so every tone sits at the same perceived lightness on Paper and Night.
 */
export const IDENTICON_TONES: readonly string[] = [
  "oklch(0.66 0.17 41)", // accent orange
  "oklch(0.58 0.12 28)", // brick
  "oklch(0.72 0.12 70)", // ochre
  "oklch(0.64 0.08 95)", // olive
  "oklch(0.60 0.07 135)", // moss
  "oklch(0.58 0.06 175)", // sea green
  "oklch(0.60 0.06 220)", // slate blue
  "oklch(0.56 0.07 265)", // dusk
  "oklch(0.58 0.08 320)", // mauve
  "oklch(0.52 0.02 110)", // ink-2 grey
  "oklch(0.78 0.05 80)", // sand
  "oklch(0.42 0.04 60)", // umber
];

/** Background tones for the token-image fallback tile (two per tile, picked from the mint hash). */
export const TOKEN_TILE_TONES: readonly string[] = [
  "oklch(0.86 0.05 60)",
  "oklch(0.80 0.06 45)",
  "oklch(0.84 0.04 95)",
  "oklch(0.78 0.03 120)",
  "oklch(0.82 0.03 200)",
  "oklch(0.76 0.04 30)",
  "oklch(0.88 0.02 90)",
  "oklch(0.74 0.05 75)",
];

/** Initials on the fallback tile: the tones are light in both themes, so the ink is fixed. */
export const TOKEN_TILE_INK = "rgb(14 15 12 / 0.78)";

/** Stable 32-bit hash (FNV-1a) of an address, for deterministic identicons and fallback tiles. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
