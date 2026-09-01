# ============================================================
# Industry360° API - Multi-Stage Dockerfile
# ============================================================

# Base
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++ openssl openssl-dev
WORKDIR /app
RUN npm install -g pnpm@9

# Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml* .npmrc* ./
# Persist the pnpm content-addressable store across builds so packages are not
# re-downloaded/re-extracted every time (cuts build time + the memory/IO spike
# that can OOM-kill the BuildKit builder). Requires BuildKit (default).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --no-frozen-lockfile --store-dir=/pnpm/store

# Development
FROM base AS development
WORKDIR /app
COPY package.json .npmrc* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
# Retry: the Prisma engine download from binaries.prisma.sh is occasionally flaky.
RUN for i in 1 2 3 4 5; do node node_modules/.bin/prisma generate && break || { echo "prisma generate failed (attempt $i/5), retrying in 8s…"; sleep 8; }; done
EXPOSE 3001
CMD ["pnpm", "start:dev"]

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Retry: the Prisma engine download from binaries.prisma.sh is occasionally flaky.
RUN for i in 1 2 3 4 5; do node node_modules/.bin/prisma generate && break || { echo "prisma generate failed (attempt $i/5), retrying in 8s…"; sleep 8; }; done
RUN pnpm build

# Production
FROM node:20-alpine AS production
# dumb-init: PID-1 signal handling | openssl: required by the Prisma query engine
# tzdata: WITHOUT this the alpine image has no zoneinfo database, so a TZ env var
#   (e.g. TZ=Asia/Riyadh) is silently ignored and Node falls back to UTC — every
#   server-side shift boundary, getHours() and working-day calculation then runs
#   3 hours out. Setting TZ in compose only works if this package is present.
# postgresql16-client: pg_dump / pg_restore for the in-app backup & restore.
#   The MAJOR VERSION MUST MATCH the server (postgres:16) — pg_dump refuses to
#   dump a newer server than itself, and a custom-format archive written by a
#   different major cannot be restored. Pin it here rather than taking whatever
#   `postgresql-client` currently resolves to.
RUN apk add --no-cache dumb-init openssl tzdata postgresql16-client
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
# tsconfig is needed so ts-node can run the master-data seed (prisma/prod-init.js)
COPY --from=builder --chown=nestjs:nodejs /app/tsconfig*.json ./

RUN mkdir -p logs && chown nestjs:nodejs logs
# Attachment upload root. Creating it here (owned by the runtime user) means a fresh
# named volume mounted at /app/uploads inherits this ownership, so the non-root
# process can write uploads. (Recreate the volume if it was made before this line.)
RUN mkdir -p uploads && chown nestjs:nodejs uploads
# Same reasoning for database backups: the named volume at /app/backups picks up
# this ownership when it is first created, so the non-root process can write a
# dump there. (Recreate the volume if it was made before this line existed.)
RUN mkdir -p backups && chown nestjs:nodejs backups

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1));"

CMD ["dumb-init", "node", "dist/main.js"]
