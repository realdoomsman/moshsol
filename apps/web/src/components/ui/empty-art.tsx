import type { ReactNode } from "react";
import { cn } from "./cn";

export type EmptyArtKind =
  | "launches"
  | "search"
  | "offline"
  | "trades"
  | "deposits"
  | "people"
  | "agent"
  | "vault"
  | "wallet";

/** Line-art palette: strong/light strokes on a faint fill, one lime accent per drawing. */
const S = "rgb(255 255 255 / 0.42)";
const L = "rgb(255 255 255 / 0.18)";
const F = "rgb(255 255 255 / 0.045)";
const A = "#c6ff3d";
const V = "#9d6bff";
const C = "#3de3ff";
const P = "#ff7ac3";
const BG = "#0b0d10";

const ART: Record<EmptyArtKind, ReactNode> = {
  launches: (
    <>
      <ellipse cx="60" cy="46" rx="44" ry="30" stroke={L} strokeDasharray="2 5" />
      <path d="M60 14c9 7 13 17 13 29v12H47V43c0-12 4-22 13-29z" fill={BG} stroke={S} />
      <circle cx="60" cy="36" r="5" stroke={A} strokeWidth="2" />
      <path d="M47 46l-8 9v7l8-3M73 46l8 9v7l-8-3" fill={F} stroke={S} />
      <path d="M55 59c0 7 5 10 5 15 0-5 5-8 5-15" stroke={A} strokeWidth="2" />
      <path d="M20 18v6M17 21h6M100 60v6M97 63h6" stroke={V} />
      <circle cx="96" cy="20" r="1.6" fill={C} />
      <circle cx="24" cy="66" r="1.6" fill={C} />
    </>
  ),
  search: (
    <>
      <rect x="18" y="14" width="58" height="56" rx="9" fill={F} stroke={L} />
      <path d="M29 29h32M29 40h22M29 51h27" stroke={L} strokeWidth="2.5" />
      <circle cx="76" cy="52" r="16" fill={BG} stroke={S} strokeWidth="2" />
      <path d="M88 64l12 12" stroke={S} strokeWidth="5" />
      <path d="M70 46l12 12M82 46L70 58" stroke={A} strokeWidth="2" />
    </>
  ),
  offline: (
    <>
      <path d="M6 58h20c5 0 8-3 8-8" stroke={L} strokeWidth="2" />
      <rect x="34" y="38" width="18" height="24" rx="5" fill={F} stroke={S} />
      <path d="M52 44h8M52 56h8" stroke={S} strokeWidth="3" />
      <rect x="72" y="36" width="20" height="28" rx="6" fill={F} stroke={S} />
      <path d="M72 44h-3M72 56h-3" stroke={S} strokeWidth="3" />
      <path d="M92 50h22" stroke={L} strokeWidth="2" />
      <path d="M66 22l-4 8h6l-4 8" stroke={A} strokeWidth="2" />
      <path d="M56 26l-3-3M76 26l3-3" stroke={A} />
    </>
  ),
  trades: (
    <>
      <path d="M12 76h96" stroke={L} />
      <path d="M12 58h96M12 40h96M12 22h96" stroke={L} strokeDasharray="2 6" opacity="0.6" />
      <path d="M26 34v34M40 42v26M54 28v34M68 38v26" stroke={L} />
      <rect x="22" y="42" width="8" height="18" rx="2" fill={F} stroke={S} />
      <rect x="36" y="48" width="8" height="12" rx="2" fill={F} stroke={S} />
      <rect x="50" y="34" width="8" height="20" rx="2" fill={F} stroke={S} />
      <rect x="64" y="44" width="8" height="14" rx="2" fill={F} stroke={S} />
      <path d="M86 18v8M86 54v10" stroke={A} strokeDasharray="2 3" />
      <rect x="82" y="26" width="8" height="28" rx="2" stroke={A} strokeWidth="1.8" strokeDasharray="3 3" />
    </>
  ),
  deposits: (
    <>
      <rect x="28" y="42" width="64" height="36" rx="8" fill={F} stroke={S} />
      <rect x="46" y="38" width="28" height="7" rx="3.5" fill={BG} stroke={S} />
      <circle cx="60" cy="61" r="5" stroke={L} />
      <path d="M60 64v4" stroke={L} />
      <circle cx="60" cy="18" r="11" fill={BG} stroke={A} strokeWidth="2" />
      <path d="M55 15h10M55 19h10M55 23h10" stroke={A} strokeWidth="1.6" />
      <path d="M60 31v4" stroke={A} strokeDasharray="1.5 2.5" />
      <path d="M22 30v5M19.5 32.5h5M98 26v5M95.5 28.5h5" stroke={V} />
    </>
  ),
  people: (
    <>
      <circle cx="46" cy="32" r="9" fill={F} stroke={L} />
      <path d="M29 70c0-10 7-18 17-18s17 8 17 18" fill={F} stroke={L} />
      <circle cx="67" cy="36" r="10.5" fill={BG} stroke={S} />
      <path d="M48 78c0-11 8-20 19-20s19 9 19 20" fill={BG} stroke={S} />
      <circle cx="92" cy="24" r="9.5" fill="rgb(198 255 61 / 0.1)" stroke={A} />
      <path d="M92 19.5v9M87.5 24h9" stroke={A} strokeWidth="2" />
    </>
  ),
  agent: (
    <>
      <path d="M60 12v9" stroke={S} />
      <circle cx="60" cy="10" r="3" fill={A} />
      <rect x="36" y="21" width="48" height="34" rx="11" fill={F} stroke={S} />
      <path d="M36 34h-4v9h4M84 34h4v9h-4" stroke={S} />
      <circle cx="51" cy="37" r="4" fill={C} />
      <circle cx="69" cy="37" r="4" fill={C} />
      <path d="M54 47h12" stroke={L} strokeWidth="2" />
      <path d="M10 66h100" stroke={A} strokeDasharray="3 4" opacity="0.6" />
      <path d="M10 82h100" stroke={P} strokeDasharray="3 4" opacity="0.6" />
      <path d="M10 76c9-5 16 3 25-1s15-7 24-2 16 5 25 0 15-4 26-1" stroke={S} strokeWidth="1.8" />
    </>
  ),
  vault: (
    <>
      <rect x="28" y="10" width="64" height="64" rx="13" fill={F} stroke={S} />
      <circle cx="60" cy="42" r="21" fill={BG} stroke={S} />
      <circle cx="60" cy="42" r="14" stroke={L} strokeDasharray="2 3.5" />
      <path d="M60 28v-5M60 56v5M46 42h-5M74 42h5" stroke={S} strokeWidth="2" />
      <circle cx="60" cy="42" r="5" fill={A} />
      <circle cx="35" cy="17" r="1.8" fill={L} />
      <circle cx="85" cy="17" r="1.8" fill={L} />
      <circle cx="35" cy="67" r="1.8" fill={L} />
      <circle cx="85" cy="67" r="1.8" fill={L} />
      <path d="M38 74v6M82 74v6" stroke={S} strokeWidth="2" />
    </>
  ),
  wallet: (
    <>
      <rect x="40" y="12" width="46" height="28" rx="5" fill="rgb(157 107 255 / 0.14)" stroke="rgb(157 107 255 / 0.75)" transform="rotate(-9 63 26)" />
      <rect x="22" y="28" width="76" height="48" rx="11" fill={BG} stroke={S} />
      <path d="M22 40h76" stroke={L} />
      <path d="M98 47H81a7.5 7.5 0 0 0 0 15h17" fill={F} stroke={S} />
      <circle cx="82" cy="54.5" r="2.8" fill={A} />
    </>
  ),
};

/** Small line illustration for empty states; a soft glow sits under each drawing. */
export function EmptyArt({ kind, className }: { kind: EmptyArtKind; className?: string }) {
  return (
    <div aria-hidden className={cn("relative h-[84px] w-[112px]", className)}>
      <div className="absolute inset-x-5 bottom-1 h-6 rounded-[50%] bg-lime/[0.09] blur-xl" />
      <div className="absolute inset-x-8 top-3 h-12 rounded-full bg-violet/[0.12] blur-2xl" />
      <svg
        viewBox="0 0 120 90"
        className="relative size-full"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ART[kind]}
      </svg>
    </div>
  );
}
