import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "../..");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@holdfast/sdk"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  agentRules: false,
  poweredByHeader: false,
};

export default config;
