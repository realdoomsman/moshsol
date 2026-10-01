import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "../..");

const config: NextConfig = {
  // A second build (e.g. a verification server) can go elsewhere without clobbering a running `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  transpilePackages: ["@holdfast/sdk"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  agentRules: false,
  poweredByHeader: false,
  // The old explainer lives in the docs now (brief §4.1); `permanent` answers 308.
  redirects: async () => [{ source: "/how-it-works", destination: "/docs/how-it-works", permanent: true }],
  // Static hardening for every response; the per-request Content-Security-Policy (script nonce) is set in src/proxy.ts.
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    },
    // public/ media keeps its name across re-recordings (not content-hashed), so a day fresh then revalidated, not immutable.
    ...["/videos/:path*", "/brand/:path*", "/icon-192.png", "/icon-512.png"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
    })),
  ],
};

export default config;
