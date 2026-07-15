# ============================================
# Multi-stage Dockerfile for Evaalo Node Express API
# Stage 1: build (compile TypeScript)
# Stage 2: runtime (slim image, only what's needed)
# ============================================

# --------------------------------------------
# Stage 1: builder
# --------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build tools needed for native modules (e.g. ws, bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# Install ALL deps (including dev: typescript, tsx, types)
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Prune dev dependencies for smaller runtime layer
RUN npm prune --omit=dev

# --------------------------------------------
# Stage 2: runtime
# --------------------------------------------
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Runtime deps:
#   - ffmpeg: for fluent-ffmpeg (audio processing)
#   - chromium + fonts: for puppeteer (PDF/HTML rendering)
#   - tini: clean process supervisor (proper SIGTERM handling)
#   - ca-certificates: TLS for outbound HTTPS (Stripe, OpenAI, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-liberation \
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    ca-certificates \
    tini \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Tell puppeteer to use the system chromium (skip its own download)
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=5000

# Non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

# Copy built artifacts and runtime deps from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# uploads/logs directories (Express writes to them at runtime)
RUN mkdir -p uploads logs \
  && chown -R app:app /app

USER app

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:5000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
