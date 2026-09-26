# Build context: repository root (pnpm workspace).
# Secrets: set AGENT_KEYPAIR_JSON (64-byte JSON array) and RPC_URL in the host's variables.
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/agent/package.json apps/agent/
RUN pnpm install --frozen-lockfile --filter @moshsol/agent...

COPY tsconfig.base.json ./
COPY packages/sdk packages/sdk
COPY apps/agent apps/agent

ENV NODE_ENV=production STATUS_HOST=0.0.0.0
EXPOSE 8788
CMD ["pnpm", "--filter", "@moshsol/agent", "start"]
