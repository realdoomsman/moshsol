# Build context: repository root (pnpm workspace).
# Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, WALLET_MASTER_KEY, SESSION_SECRET and SITE_URL in the host's variables.
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/accounts/package.json apps/accounts/
RUN pnpm install --frozen-lockfile --filter @holdfast/accounts...

COPY tsconfig.base.json ./
COPY packages/sdk packages/sdk
COPY apps/accounts apps/accounts

# The DB holds every user's sealed wallet: mount a volume at /data (Railway) and back it up.
# HOST=:: listens on Railway's private network (IPv6); the service needs no public domain.
ENV NODE_ENV=production HOST=:: DB_PATH=/data/accounts.db
EXPOSE 8789
CMD ["pnpm", "--filter", "@holdfast/accounts", "start"]
