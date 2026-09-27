# Build context: repository root (pnpm workspace).
# NEXT_PUBLIC_* values are inlined at build time, so they must be provided as build args
# (Railway passes service variables to matching ARGs automatically).
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @holdfast/web...

COPY tsconfig.base.json ./
COPY packages/sdk packages/sdk
COPY apps/web apps/web

ARG NEXT_PUBLIC_CLUSTER
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_INDEXER_URL
ARG NEXT_PUBLIC_AGENT_URL
ARG NEXT_PUBLIC_SITE_URL
RUN pnpm --filter @holdfast/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@holdfast/web", "start"]
