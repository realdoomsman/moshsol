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
  // Baseline hardening; no CSP yet (wallet extensions, inline Next scripts and Arweave images need an audited policy).
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
  ],
};

export default config;
