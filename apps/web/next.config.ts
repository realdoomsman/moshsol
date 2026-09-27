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
};

export default config;
