# ==========================================
# 1. Base com ferramentas do sistema & OCR
# ==========================================
FROM node:20-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-spa \
    poppler-utils \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ==========================================
# 2. Dependências
# ==========================================
FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps

# ==========================================
# 3. Build da Aplicação
# ==========================================
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Variáveis seguras para permitir compilação estática do Next.js
ENV NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder"

RUN mkdir -p public dist
RUN npm run build

# ==========================================
# 4. Imagem de Execução (Runner)
# ==========================================
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copia artefatos gerados
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.js ./dist/worker.js
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start-all.js ./scripts/start-all.js

# Instala módulos nativos específicos de runtime no Linux se necessário
COPY --from=deps /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps /app/node_modules/tesseract.js ./node_modules/tesseract.js
COPY --from=deps /app/node_modules/pdf-parse ./node_modules/pdf-parse
COPY --from=deps /app/node_modules/csv-parse ./node_modules/csv-parse

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "scripts/start-all.js"]
