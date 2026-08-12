# P14 — a multi-stage build producing a self-contained Next server.
#
# This project deploys to Vercel, so the container is not the production path.
# It exists for three concrete reasons, and it is worth being clear about them
# rather than shipping a Dockerfile because the blueprint says so:
#
#   1. **Portability.** Nothing in the app depends on Vercel except the geo
#      headers, which already fall back. A runnable container is the proof of
#      that rather than the claim.
#   2. **Reproducing a build without the platform.** When a deploy fails, the
#      question "is it the code or the platform" is answered by running the same
#      build locally with the same Node version and no build cache.
#   3. **Secrets as files.** lib/security/vault.ts reads NAME_FILE before NAME
#      precisely so a container can mount secrets with permissions instead of
#      putting them in an environment every process can read.
#
# DOCKER_BUILD=1 is what switches next.config.ts to `output: "standalone"`.
# Setting standalone unconditionally would change how Vercel deploys this
# project to solve a problem only the container has.

# ---- deps ------------------------------------------------------------------
# Separated from the build so a change to source code does not re-resolve the
# dependency tree — that layer is cached on the lockfile alone.
FROM node:24-alpine AS deps
WORKDIR /app

# libc6-compat: some native postinstalls assume glibc symbols that musl lacks.
RUN apk add --no-cache libc6-compat

# corepack is not used, for the same reason CI stopped relying on it: its shims
# stopped landing on PATH on GitHub's runners and failed every build for a week.
# The version is read from package.json's packageManager field so there is one
# source of truth.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"

# prisma generate runs in postinstall and needs the schema, but not a database:
# generating a client is a codegen step, and prisma.config.ts is written so it
# does not resolve DIRECT_URL for `generate`.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

# ---- builder ---------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
RUN ln -s /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm
COPY . .

# Placeholders, deliberately unreachable. `next build` prerenders pages and runs
# generateStaticParams, both of which touch the database — and this asserts that
# the build SURVIVES having no database, degrading to on-demand rendering. Same
# assertion CI makes, for the same reason.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db" \
    DIRECT_URL="postgresql://user:pass@localhost:5432/db" \
    AUTH_SECRET="docker-build-placeholder" \
    NEXT_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1

RUN pnpm build

# ---- runner ----------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Never root. A container that runs its app as uid 0 hands a container escape a
# head start it did not need.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `standalone` traces the exact files the server needs and copies them, so the
# runtime image carries neither pnpm nor the full node_modules tree. static/ and
# public/ are not traced — the server expects to find them beside itself.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Hits the real readiness endpoint rather than just checking the port is open:
# a Next server answers on the port well before it can reach the database, and
# "listening" is not "able to serve". /api/health returns 503 until it is.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
