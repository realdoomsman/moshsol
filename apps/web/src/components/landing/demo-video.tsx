"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMediaQuery } from "@/lib/hooks";
import { IconButton } from "../ui/button";

export interface DemoSource {
  /** Encodes in preference order (smallest first). */
  sources: { src: string; type: string }[];
  poster: { src: string; width: number; height: number } | null;
}

/**
 * A recorded product loop (§3.9): `muted playsinline loop preload="none"`, plays while ≥ 50% in view
 * and pauses otherwise; reduced motion shows the poster only. The `-m` cut is used below 768px.
 * The poster is a lazy `<picture>` under the video (the browser picks the `-m` still by media query,
 * and off-screen stills aren't fetched), in a box sized from the poster so nothing shifts when it
 * loads. Playback (and so the video download) waits for the page's `load` event. A pause/play
 * button stops the loop (WCAG 2.2.2) or, under reduced motion, starts it on request.
 */
export function DemoVideo({ desktop, mobile, label }: { desktop: DemoSource | null; mobile: DemoSource | null; label: string }) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  /** The visitor's explicit choice; until then the loop follows the motion preference. */
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? reduced;
  const src = (narrow ? (mobile ?? desktop) : (desktop ?? mobile)) as DemoSource;
  const wide = desktop?.poster ?? mobile?.poster ?? null;
  const small = mobile?.poster ?? wide;
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) {
      video.pause();
      return;
    }
    let io: IntersectionObserver | undefined;
    const observe = () => {
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) void video.play().catch(() => undefined);
          else video.pause();
        },
        { threshold: 0.5 },
      );
      io.observe(video);
    };
    if (document.readyState === "complete") observe();
    else window.addEventListener("load", observe, { once: true });
    return () => {
      window.removeEventListener("load", observe);
      io?.disconnect();
      video.pause();
    };
  }, [paused, src]);

  const box = {
    "--demo-ar": wide ? `${wide.width} / ${wide.height}` : undefined,
    "--demo-ar-m": small ? `${small.width} / ${small.height}` : undefined,
  } as CSSProperties;

  return (
    <div className="relative aspect-(--demo-ar-m) md:aspect-(--demo-ar)" style={box}>
      {wide ? (
        <picture>
          {small && small.src !== wide.src ? <source media="(max-width: 767px)" srcSet={small.src} width={small.width} height={small.height} /> : null}
          <img
            src={wide.src}
            width={wide.width}
            height={wide.height}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
      ) : null}
      <video
        key={src.sources[0]?.src}
        ref={ref}
        muted
        playsInline
        loop
        preload="none"
        aria-label={label}
        className="relative block size-full object-cover"
      >
        {src.sources.map((s) => (
          <source key={s.src} src={s.src} type={s.type} />
        ))}
      </video>
      <IconButton
        label={paused ? "Play video" : "Pause video"}
        size="sm"
        onClick={() => setUserPaused(!paused)}
        className="absolute right-2 bottom-2 bg-paper/70 backdrop-blur-[6px]"
      >
        {paused ? <Play className="size-4" strokeWidth={1.5} aria-hidden /> : <Pause className="size-4" strokeWidth={1.5} aria-hidden />}
      </IconButton>
    </div>
  );
}
