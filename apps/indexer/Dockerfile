# Build context: repository root (pnpm workspace).
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/indexer/package.json apps/indexer/
RUN pnpm install --frozen-lockfile --filter @holdfast/indexer...

COPY tsconfig.base.json ./
COPY packages/sdk packages/sdk
COPY apps/indexer apps/indexer

# Persist DB + uploads on a mounted volume (Railway: mount at /data). TRUST_PROXY is deliberately unset: set it
# to the proxy's addresses in the environment (Railway: `uniquelocal,100.64.0.0/10`), see README.
ENV NODE_ENV=production HOST=0.0.0.0 DB_PATH=/data/indexer.db FILES_DIR=/data/files
EXPOSE 8787
CMD ["pnpm", "--filter", "@holdfast/indexer", "start"]
