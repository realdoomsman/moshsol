"use client";

import { useEffect, useRef } from "react";
import { useMediaQuery } from "@/lib/hooks";

export interface DemoSource {
  webm: string | null;
  mp4: string | null;
  poster: string | null;
  seconds: number | null;
}

/**
 * A recorded product loop (§3.9): `muted playsinline loop preload="none"`, plays while ≥ 50% in view
 * and pauses otherwise; reduced motion shows the poster only. The `-m` cut is used below 768px.
 */
export function DemoVideo({ desktop, mobile, label }: { desktop: DemoSource | null; mobile: DemoSource | null; label: string }) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const src = (narrow ? (mobile ?? desktop) : (desktop ?? mobile)) as DemoSource;
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(video);
    return () => {
      io.disconnect();
      video.pause();
    };
  }, [reduced, src]);

  return (
    <video
      key={src.mp4 ?? src.webm}
      ref={ref}
      muted
      playsInline
      loop
      preload="none"
      poster={src.poster ?? undefined}
      aria-label={label}
      className="block h-auto w-full"
    >
      {src.webm ? <source src={src.webm} type="video/webm" /> : null}
      {src.mp4 ? <source src={src.mp4} type="video/mp4" /> : null}
    </video>
  );
}
