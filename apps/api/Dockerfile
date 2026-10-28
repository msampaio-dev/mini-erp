# syntax=docker/dockerfile:1
# Build a partir da RAIZ do monorepo:  docker build -f apps/api/Dockerfile --target runtime .
# Alvos: `runtime` (a API) e `migrate` (migrations + seed, roda uma vez a cada deploy).

FROM node:24-slim AS base
WORKDIR /app
# Só os manifestos primeiro: a camada do `npm ci` fica em cache enquanto as dependências
# não mudarem, e o rebuild após mudar só o código leva segundos.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# ─── Dependências completas (com dev) para compilar ───────────────────────
FROM base AS build
# O motor de migrations do Prisma (binário nativo, usado pelo alvo `migrate`) precisa do
# OpenSSL, ausente na imagem slim. O runtime não precisa: o client com driver adapter
# (@prisma/adapter-pg) não usa binário nativo.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm ci --workspace @mini-erp/api --workspace @mini-erp/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# O `prisma generate` (prebuild) lê o prisma.config.ts, que exige uma URL; não conecta em nada.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build -w @mini-erp/contracts && npm run build -w @mini-erp/api

# ─── migrate: aplica migrations e sincroniza papéis/permissões (seed idempotente) ─
FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ─── runtime: só dependências de produção + código compilado ──────────────
FROM base AS runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --workspace @mini-erp/api --workspace @mini-erp/contracts --include-workspace-root \
  && npm cache clean --force
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# Usuário sem privilégios: se a API for comprometida, o invasor não é root no container.
USER node
EXPOSE 3000
# Readiness (inclui o banco): o compose só libera o Caddy quando a API consegue atender.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
