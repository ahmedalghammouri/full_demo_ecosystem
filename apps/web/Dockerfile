# ============================================================
# Industry360° Web - Multi-Stage Dockerfile
# ============================================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm@9

FROM base AS deps
COPY package.json pnpm-lock.yaml* .npmrc* ./
# Persist the pnpm content-addressable store across builds so packages are not
# re-downloaded/re-extracted every time (cuts build time + the memory/IO spike
# that can OOM-kill the BuildKit builder). Requires BuildKit (default).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --no-frozen-lockfile --store-dir=/pnpm/store

FROM base AS development
WORKDIR /app
COPY package.json .npmrc* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev:turbo"]

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:20-alpine AS production
# tzdata: required for the TZ env var to resolve — see apps/api/Dockerfile.
RUN apk add --no-cache dumb-init tzdata
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:3000/', (r) => process.exit(r.statusCode < 500 ? 0 : 1)); req.on('error', () => process.exit(1));"

CMD ["dumb-init", "node", "server.js"]
