# syntax=docker/dockerfile:1
# Build a partir da RAIZ do monorepo:  docker build -f apps/web/Dockerfile .
# Resultado: Caddy servindo o React compilado e encaminhando /api para a API.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @mini-erp/web --workspace @mini-erp/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build -w @mini-erp/contracts && npm run build -w @mini-erp/web

# A imagem final não tem Node: só o Caddy e arquivos estáticos (~50 MB).
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
