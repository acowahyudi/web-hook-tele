# ==========================================
# Production Dockerfile for Webhook Service
# ==========================================
FROM node:20-alpine AS base

# Install dumb-init untuk menangani process signals (PID 1) dengan benar
RUN apk add --no-cache dumb-init

# Tentukan direktori kerja aplikasi
WORKDIR /usr/src/app

# Set environment ke production
ENV NODE_ENV=production \
    PORT=3000

# Salin package manifests terlebih dahulu untuk efisiensi caching layer Docker
COPY package*.json ./

# Install dependensi hanya untuk production
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Salin seluruh source code aplikasi
COPY . .

# Gunakan non-root user bawaan Alpine ('node') demi keamanan kontainer
USER node

# Expose port yang digunakan aplikasi
EXPOSE 3000

# Healthcheck otomatis untuk Docker & Container Orchestrator
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Jalankan aplikasi menggunakan dumb-init untuk menangani SIGTERM/SIGINT secara graceful
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "app.js"]
