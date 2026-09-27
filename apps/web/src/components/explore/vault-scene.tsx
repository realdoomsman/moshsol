"use client";

import { useAnimationFrame, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { cn } from "../ui/cn";
import { TokenAvatar } from "../ui/interactive";

export interface Orbiter {
  key: string;
  image: string | null;
  symbol: string;
}

/** Scene geometry in SVG user units (viewBox 0 0 400 220). */
const W = 400;
const H = 220;
const CX = 200;
const CY = 108;
const ORBIT = { cx: 200, cy: 120, rx: 172, ry: 50 };
const PERIOD_MS = 28_000;
const MIN_ORBITERS = 4;

/** Coins drawn toward the door: start offset from the centre (SVG units), size, colour, timing. */
const FLOW = [
  { x: -150, y: 22, r: 3.2, c: "#c6ff3d", d: 0, t: 3.6 },
  { x: 160, y: -18, r: 2.6, c: "#9d6bff", d: 0.7, t: 3.2 },
  { x: -120, y: -42, r: 2.2, c: "#3de3ff", d: 1.5, t: 3.8 },
  { x: 132, y: 40, r: 3, c: "#c6ff3d", d: 2.1, t: 3.4 },
  { x: -168, y: -6, r: 2, c: "#9d6bff", d: 2.8, t: 4 },
  { x: 96, y: -50, r: 2.4, c: "#c6ff3d", d: 3.3, t: 3.1 },
  { x: -80, y: 50, r: 2.2, c: "#3de3ff", d: 1.1, t: 3.5 },
  { x: 176, y: 12, r: 2.8, c: "#c6ff3d", d: 1.9, t: 3.9 },
];

const round = (n: number) => Math.round(n * 100) / 100;
const BOLTS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return { x: round(CX + 70 * Math.cos(a)), y: round(CY + 70 * Math.sin(a)) };
});
/** Dial ticks: every fifth is longer; the first is the lime index mark. */
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
  const inner = i % 5 === 0 ? 47 : 51;
  return {
    x1: round(CX + inner * Math.cos(a)),
    y1: round(CY + inner * Math.sin(a)),
    x2: round(CX + 56 * Math.cos(a)),
    y2: round(CY + 56 * Math.sin(a)),
    stroke: i === 0 ? "#c6ff3d" : i % 5 === 0 ? "rgb(255 255 255 / 0.4)" : "rgb(255 255 255 / 0.16)",
    width: i === 0 ? 2 : 1,
  };
});
/** Rotating groups turn around the door's centre. */
const SPIN_ORIGIN: CSSProperties = { transformOrigin: `${CX}px ${CY}px`, transformBox: "view-box" };

/**
 * Position on the orbit ellipse; the lower half is "in front" of the door. Rounded so the server
 * and browser render identical markup.
 */
function orbitPoint(angle: number) {
  const sin = Math.sin(angle);
  const depth = (sin + 1) / 2;
  return {
    left: (((ORBIT.cx + ORBIT.rx * Math.cos(angle)) / W) * 100).toFixed(3),
    top: (((ORBIT.cy + ORBIT.ry * sin) / H) * 100).toFixed(3),
    scale: (0.72 + depth * 0.36).toFixed(3),
    opacity: (0.5 + depth * 0.5).toFixed(3),
    front: sin > 0,
  };
}

function orbiterStyle(angle: number): CSSProperties {
  const p = orbitPoint(angle);
  return {
    left: `${p.left}%`,
    top: `${p.top}%`,
    opacity: Number(p.opacity),
    zIndex: p.front ? 3 : 1,
    transform: `translate(-50%, -50%) scale(${p.scale})`,
  };
}

/**
 * The hero's vault: a locked door with a slowly turning dial and wheel, coins streaming in, and the
 * live launches' logos riding an orbit ring around it (behind the door on the far side).
 */
export function VaultScene({ orbiters, className }: { orbiters: Orbiter[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const visible = useRef(true);
  const host = useRef<HTMLDivElement>(null);

  const items: Orbiter[] = [...orbiters.slice(0, 6)];
  for (let i = items.length; i < MIN_ORBITERS; i++) items.push({ key: `coin-${i}`, image: null, symbol: "" });
  const phase = (i: number) => (i / items.length) * Math.PI * 2 + Math.PI * 0.35;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useAnimationFrame((t) => {
    if (reduce || !visible.current) return;
    const base = (t / PERIOD_MS) * Math.PI * 2;
    nodes.current.forEach((node, i) => {
      if (node) Object.assign(node.style, orbiterStyle(base + phase(i)));
    });
  });

  const backArc = `M ${ORBIT.cx - ORBIT.rx} ${ORBIT.cy} A ${ORBIT.rx} ${ORBIT.ry} 0 0 1 ${ORBIT.cx + ORBIT.rx} ${ORBIT.cy}`;
  const frontArc = `M ${ORBIT.cx + ORBIT.rx} ${ORBIT.cy} A ${ORBIT.rx} ${ORBIT.ry} 0 0 1 ${ORBIT.cx - ORBIT.rx} ${ORBIT.cy}`;

  return (
    <div ref={host} aria-hidden className={cn("relative w-full select-none", className)} style={{ aspectRatio: `${W} / ${H}` }}>
      {/* Light: rotating rays + breathing core glow. */}
      <div className="absolute top-[49%] left-1/2 aspect-square w-[62%] -translate-x-1/2 -translate-y-1/2 [mask-image:radial-gradient(closest-side,#000_30%,transparent)]">
        <div className="size-full animate-spin-slow rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgb(198_255_61/0.16)_20deg,transparent_45deg,transparent_120deg,rgb(157_107_255/0.2)_150deg,transparent_180deg,transparent_240deg,rgb(61_227_255/0.14)_265deg,transparent_300deg)]" />
      </div>
      <div className="absolute top-[49%] left-1/2 size-[34%] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full bg-lime/25 blur-3xl" />

      {/* Back layer: far half of the orbit and the coin stream (swallowed by the door). */}
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 z-0 size-full" fill="none">
        <ellipse cx={CX} cy={H - 14} rx="92" ry="9" fill="rgb(0 0 0 / 0.55)" />
        <path d={backArc} stroke="rgb(255 255 255 / 0.1)" strokeWidth="1.2" />
        <path d={backArc} stroke="rgb(198 255 61 / 0.4)" strokeWidth="1.2" strokeDasharray="1.5 9" strokeLinecap="round" />
        {FLOW.map((f, i) => (
          <circle
            key={i}
            className="vault-coin"
            cx={CX}
            cy={CY}
            r={f.r}
            fill={f.c}
            style={
              {
                "--fx": `${f.x}px`,
                "--fy": `${f.y}px`,
                "--delay": `${f.d}s`,
                "--dur": `${f.t}s`,
                filter: `drop-shadow(0 0 4px ${f.c})`,
              } as CSSProperties
            }
          />
        ))}
      </svg>

      {/* Door. */}
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 z-[2] size-full" fill="none">
        <defs>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#343b45" />
            <stop offset="0.45" stopColor="#161a20" />
            <stop offset="1" stopColor="#07090b" />
          </linearGradient>
          <radialGradient id={`${id}-face`} cx="0.42" cy="0.36" r="0.75">
            <stop offset="0" stopColor="#1a1f26" />
            <stop offset="1" stopColor="#07090c" />
          </radialGradient>
          <radialGradient id={`${id}-hub`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#c6ff3d" stopOpacity="0.28" />
            <stop offset="1" stopColor="#c6ff3d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r="76" fill={`url(#${id}-rim)`} stroke="rgb(255 255 255 / 0.16)" />
        <path
          d={`M ${CX - 64} ${CY - 28} A 70 70 0 0 1 ${CX - 12} ${CY - 70}`}
          stroke="rgb(255 255 255 / 0.35)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="64" fill={`url(#${id}-face)`} stroke="rgb(0 0 0 / 0.6)" strokeWidth="2" />
        {BOLTS.map((b, i) => (
          <circle
            key={i}
            cx={b.x}
            cy={b.y}
            r="2.2"
            fill="#2b313a"
            stroke="rgb(255 255 255 / 0.28)"
            strokeWidth="0.8"
          />
        ))}
        <g className="animate-spin-slower" style={SPIN_ORIGIN}>
          {TICKS.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.stroke} strokeWidth={t.width} strokeLinecap="round" />
          ))}
        </g>
        <g className="animate-spin-slow" style={SPIN_ORIGIN}>
          {[0, 60, 120].map((deg) => (
            <g key={deg} transform={`rotate(${deg} ${CX} ${CY})`}>
              <line x1={CX - 38} y1={CY} x2={CX + 38} y2={CY} stroke="#3a424d" strokeWidth="5" strokeLinecap="round" />
              <circle cx={CX - 40} cy={CY} r="5" fill="#2b323b" stroke="rgb(255 255 255 / 0.3)" strokeWidth="0.8" />
              <circle cx={CX + 40} cy={CY} r="5" fill="#2b323b" stroke="rgb(255 255 255 / 0.3)" strokeWidth="0.8" />
            </g>
          ))}
        </g>
        <circle cx={CX} cy={CY} r="34" fill={`url(#${id}-hub)`} />
        <circle cx={CX} cy={CY} r="19" fill="#0a0d11" stroke="rgb(198 255 61 / 0.55)" strokeWidth="1.5" />
        <path d={`M ${CX - 5.5} ${CY - 1} v-4.5 a5.5 5.5 0 0 1 11 0 v4.5`} stroke="#c6ff3d" strokeWidth="2.2" strokeLinecap="round" />
        <rect x={CX - 8.5} y={CY - 2} width="17" height="12.5" rx="3" fill="#c6ff3d" />
        <circle cx={CX} cy={CY + 3.4} r="1.8" fill="#0a0d11" />
      </svg>

      {/* Near half of the orbit, drawn over the door. */}
      <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 z-[4] size-full" fill="none">
        <path d={frontArc} stroke="rgb(255 255 255 / 0.14)" strokeWidth="1.2" />
        <path d={frontArc} stroke="rgb(198 255 61 / 0.55)" strokeWidth="1.4" strokeDasharray="1.5 9" strokeLinecap="round" />
      </svg>

      {items.map((o, i) => (
        <div
          key={o.key}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          className="absolute"
          style={orbiterStyle(phase(i))}
        >
          {o.image || o.symbol ? (
            <div className="rounded-xl shadow-[0_6px_18px_-4px_rgb(0_0_0/0.8)] ring-1 ring-white/15">
              <TokenAvatar src={o.image} symbol={o.symbol} size={34} />
            </div>
          ) : (
            <div className="grid size-7 place-items-center rounded-full border border-lime/40 bg-[#10150a] shadow-[0_0_16px_-2px_rgb(198_255_61/0.6)]">
              <span className="grid gap-[2px]">
                {[0, 1, 2].map((b) => (
                  <span key={b} className="block h-[2px] w-2.5 rounded-full bg-lime" />
                ))}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
