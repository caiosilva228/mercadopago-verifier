# ==========================================
# 1. Base com ferramentas do sistema & OCR
# ==========================================
FROM node:20-bookworm-slim AS base

# Instala tesseract-ocr com idioma espanhol e utilitários
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
COPY package.json package-lock.json* ./
RUN npm ci

# ==========================================
# 3. Build da Aplicação
# ==========================================
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Variáveis fictícias apenas para validação de build estático se necessário
ENV NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder"

RUN npm run build

# Compila o worker em arquivo JS standalone
RUN npx esbuild src/server/worker-runner.ts --bundle --platform=node --target=node20 --outfile=dist/worker.js --external:sharp --external:tesseract.js --external:pdf-parse --external:csv-parse

# ==========================================
# 4. Imagem de Execução (Runner)
# ==========================================
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

WORKDIR /app

# Cria usuário não-root para segurança
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copia artefatos do build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.js ./dist/worker.js
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start-all.js ./scripts/start-all.js

# Instala apenas dependências nativas necessárias em runtime
COPY --from=deps /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps /app/node_modules/tesseract.js ./node_modules/tesseract.js
COPY --from=deps /app/node_modules/pdf-parse ./node_modules/pdf-parse
COPY --from=deps /app/node_modules/csv-parse ./node_modules/csv-parse

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "scripts/start-all.js"]
