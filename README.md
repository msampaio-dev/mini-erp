# Mini-ERP

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

Health check: `GET /api/health`.

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run build` | compila contracts, API e front |
| `npm test` | testes dos contratos e unitários da API |
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
- [ ] Fase 7: qualidade e deploy
