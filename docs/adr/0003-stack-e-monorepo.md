# ADR 0003: Stack e monorepo

- **Status:** aceito
- **Data:** 2026-10-05

## Decisão
| Camada | Escolha | Motivo principal |
|---|---|---|
| Repositório | Monorepo com npm workspaces | front e back compartilham contratos tipados |
| Backend | NestJS 12 + TypeScript (ESM) | módulos e injeção de dependência casam com o monólito modular |
| Frontend | React 19 + Vite | SPA separada da API; padrão de mercado |
| Banco | PostgreSQL 18 (Docker) | ACID, row locks, CHECK constraints, window functions |
| ORM | Prisma 7 (adapter `pg`) | tipagem gerada e migrations versionadas |

## Alternativas consideradas
- **Repos separados:** os contratos entre front e back ficariam fora de sincronia.
- **Nx/Turborepo:** ferramenta demais para dois apps; podem ser adotados depois.
- **MongoDB:** o domínio é relacional e o ledger exige transações fortes.
- **TypeORM / Drizzle:** o TypeORM tem histórico de bugs; o Drizzle é ótimo, mas tem ecossistema menor com Nest.

## Notas
- O Prisma foi fixado em `7.10.0`: a tag `latest` do npm apontava para uma RC (`8.0.0-rc.20`).
- O Postgres do Docker expõe a porta **5433** para não conflitar com instalações locais.
- O npm 11 bloqueia scripts de instalação. Apenas `prisma` e `@prisma/engines` estão aprovados
  (`allowScripts` no `package.json`).
