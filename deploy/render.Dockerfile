# syntax=docker/dockerfile:1
# Imagem para o Render (plano gratuito, ADR 0015): UM serviço que serve API + front.
# Build a partir da RAIZ:  docker build -f deploy/render.Dockerfile .
#
# Diferenças em relação à stack Docker/Caddy (ADR 0013):
# - sem Caddy: o próprio Nest serve o React (WEB_DIST_DIR), na mesma origem;
# - migrations no INÍCIO do container: o pre-deploy command do Render é recurso pago.
#   Seguro porque o `prisma migrate deploy` usa trava consultiva no banco e o Render só
#   troca o tráfego se a instância nova subir e passar no health check.

FROM node:24-slim
WORKDIR /app
# OpenSSL: exigido pelo motor de migrations do Prisma.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Dependências completas: o CLI do Prisma e o tsx (seed) rodam a cada início.
RUN npm ci

COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web
# O `prisma generate` lê o prisma.config.ts, que exige uma URL; não conecta em nada.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build:contracts \
  && DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @mini-erp/api \
  && npm run build -w @mini-erp/web

ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && exec node --enable-source-maps dist/main.js"]
