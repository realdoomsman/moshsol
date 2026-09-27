"use client";

import { useState } from "react";
import { hashString, TOKEN_TILE_INK, TOKEN_TILE_TONES } from "@/lib/theme";
import { cn } from "./cn";

/**
 * Token image (§3.7): rounded square ("tokens are square") — 8px radius up to 48px, 12px from 56px
 * — with a 1px inset `line` border. Images fade in over `sunken`. Missing/broken images fall back to
 * a deterministic two-tone tile from the mint hash with the ticker initials; no emoji, no "?".
 */
export function TokenAvatar({
  src,
  symbol,
  mint,
  size = 40,
  className,
}: {
  src: string | null | undefined;
  symbol: string;
  /** Seeds the fallback tile so a token keeps the same tile everywhere. */
  mint: string;
  size?: number;
  className?: string;
}) {
  const [state, setState] = useState<{ src: string | null | undefined; loaded: boolean; failed: boolean }>({
    src,
    loaded: false,
    failed: false,
  });
  if (state.src !== src) setState({ src, loaded: false, failed: false });
  const radius = size >= 56 ? "rounded-md" : "rounded-sm";
  const showImage = !!src && !state.failed;
  const h = hashString(mint);
  const a = TOKEN_TILE_TONES[h % TOKEN_TILE_TONES.length];
  const b = TOKEN_TILE_TONES[(h >>> 8) % TOKEN_TILE_TONES.length];

  return (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden bg-sunken", radius, className)}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        // Indexer-hosted user uploads; next/image would need a per-deployment remote allowlist.
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // Cached images can finish before hydration attaches onLoad.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0 && !state.loaded) setState((s) => ({ ...s, loaded: true }));
          }}
          onLoad={() => setState((s) => ({ ...s, loaded: true }))}
          onError={() => setState((s) => ({ ...s, failed: true }))}
          className={cn(
            "size-full object-cover transition-opacity duration-(--dur-3)",
            state.loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <span
          aria-hidden
          className="label flex size-full items-center justify-center"
          style={{
            color: TOKEN_TILE_INK,
            background: `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`,
            fontSize: Math.max(9, Math.round(size * 0.28)),
            letterSpacing: "0.04em",
          }}
        >
          {symbol.replace(/^\$/, "").slice(0, 2)}
        </span>
      )}
      <span aria-hidden className={cn("pointer-events-none absolute inset-0 ring-1 ring-line ring-inset", radius)} />
    </span>
  );
}
