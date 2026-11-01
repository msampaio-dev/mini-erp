# Mini-ERP

[![CI](https://github.com/msampaio-dev/mini-erp/actions/workflows/ci.yml/badge.svg)](https://github.com/msampaio-dev/mini-erp/actions/workflows/ci.yml)

Mini-ERP de estoque e vendas: cadastro de produtos, entradas e saídas de estoque,
vendas, relatórios e controle de acesso por permissões.

## Arquitetura

Monólito modular (NestJS) com SPA React, em um monorepo:

```
apps/api            NestJS 12: um módulo por contexto de negócio
apps/web            React 19 + Vite
packages/contracts  schemas Zod e tipos compartilhados entre front e back
docs/adr            registro das decisões de arquitetura
```

Contextos: **Acesso** · **Catálogo** · **Estoque** · **Vendas** · **Relatórios**.
O porquê de cada decisão está em [`docs/adr`](docs/adr).

## Requisitos

- Node.js 24+
- Docker (para o PostgreSQL)

## Rodando localmente

```bash
npm install
cp apps/api/.env.example apps/api/.env   # defina SEED_ADMIN_PASSWORD (mín. 10 caracteres)
npm run db:up      # Postgres na porta 5433
npm run db:deploy -w @mini-erp/api   # aplica as migrations
npm run db:seed -w @mini-erp/api     # papéis, permissões e o primeiro admin
npm run dev:api    # API em http://localhost:3000/api
npm run dev:web    # Front em http://localhost:5180
```

Health check: `GET /api/health` (readiness) e `GET /api/health/live` (liveness).

## Produção

Docker Compose com Caddy (HTTPS automático), API sem root, migrations como etapa separada e
backup diário com teste de restauração. Passo a passo em [`docs/deploy.md`](docs/deploy.md)
(gratuito no Render + Neon: [`docs/deploy-render.md`](docs/deploy-render.md); Oracle Cloud: [`docs/deploy-oracle.md`](docs/deploy-oracle.md)).

```bash
cp deploy/.env.prod.example deploy/.env.prod   # preencha
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

O CI (`.github/workflows/ci.yml`) roda lint, tipos, testes unitários, e2e contra Postgres real,
build, auditoria de dependências e o build das imagens a cada push.

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run build` | compila contracts, API e front |
| `npm test` | testes dos contratos e unitários da API |
| `npm run build && npm test -w @mini-erp/e2e` | testes de interface (Playwright) contra a configuração do Render |
| `npm run test:e2e -w @mini-erp/api` | testes ponta a ponta num banco separado `mini_erp_test` (criado automaticamente) |
| `npm run db:migrate -w @mini-erp/api` | cria e aplica uma migration em dev |
| `npm run db:seed -w @mini-erp/api` | sincroniza papéis/permissões e cria o admin (idempotente) |
| `npm run db:studio -w @mini-erp/api` | abre o Prisma Studio |
| `npm run perf:reports -w @mini-erp/api` | mede os relatórios com 50 mil vendas num banco separado |
| `npm run db:down` | para o Postgres |

## Roadmap

- [x] Fase 1: fundação (monorepo, banco, Prisma, health check)
- [x] Fase 2: acesso (login com sessão, Argon2id, RBAC com negação por padrão)
- [x] Fase 3: catálogo (produtos, categorias, optimistic locking, busca trigram)
- [x] Fase 4: estoque (ledger imutável, saldo atômico, custo médio, estornos, idempotência)
- [x] Fase 5: vendas (atômicas, sem deadlock, desconto com rateio exato, cancelamento, PDV)
- [x] Fase 6: relatórios (fuso de SP, ABC, margem, reposição, CSV seguro, desempenho medido)
- [x] Fase 7: qualidade e deploy (usuários, CI, Docker, Caddy, backup testado, logs com request id)

### Próximos passos

- [x] Troca de senha, edição de papéis e redefinição de senha pelo admin (ADR 0014)
- [x] Renomear e excluir categorias; trava de unidade com saldo fracionado
- [x] Categoria fotografada na venda (relatório de margem por categoria)
- [x] Rate limit compartilhado no Postgres e faxina periódica de sessões
- [x] Backup fora do servidor via rclone, com teste de restauração da cópia remota
- [x] Prisma 8 avaliado: ainda é release candidate, mantido o 7.10.1 (ADR 0014)
- [x] Repositório público no GitHub, com CI rodando a cada push
- [x] Publicado no Render + Neon, com rate limit de login validado em produção (ADR 0015)
- [ ] Migrar para o Prisma 8 quando sair a versão estável
