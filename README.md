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
cp apps/api/.env.example apps/api/.env
npm run db:up      # Postgres na porta 5433
npm run dev:api    # API em http://localhost:3000/api
npm run dev:web    # Front em http://localhost:5173
```

Health check: `GET /api/health`.

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run build` | compila contracts, API e front |
| `npm test` | testes unitários da API |
| `npm run test:e2e -w @mini-erp/api` | testes ponta a ponta (precisa do banco no ar) |
| `npm run db:migrate -w @mini-erp/api` | cria e aplica uma migration em dev |
| `npm run db:studio -w @mini-erp/api` | abre o Prisma Studio |
| `npm run db:down` | para o Postgres |

## Roadmap

- [x] Fase 1: fundação (monorepo, banco, Prisma, health check)
- [ ] Fase 2: acesso (login, RBAC)
- [ ] Fase 3: catálogo de produtos
- [ ] Fase 4: estoque (ledger, saldo, concorrência)
- [ ] Fase 5: vendas
- [ ] Fase 6: relatórios
- [ ] Fase 7: qualidade e deploy
