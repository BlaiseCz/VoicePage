# ============================================================
# VoicePage — Multi-stage Docker build
#
# Stage 1: Install deps + build
# Stage 2: Lightweight nginx to serve the static demo
# ============================================================

# --- Build stage ---
FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/voicepage-core/package.json packages/voicepage-core/
COPY packages/voicepage-ui/package.json packages/voicepage-ui/
COPY apps/demo-vanilla/package.json apps/demo-vanilla/

RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/demo-vanilla/ apps/demo-vanilla/

# Build workspace packages then the demo app
RUN pnpm run build
RUN pnpm --filter demo-vanilla build

# --- Production stage ---
FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/apps/demo-vanilla/dist /usr/share/nginx/html

EXPOSE 80
