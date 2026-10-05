# ADR 0006: Risco aceito, alertas do npm audit no CLI do Prisma

- **Status:** aceito (reavaliar no Prisma 7.11+ ou 8 estável)
- **Data:** 2026-10-05

## Contexto
O `npm audit` aponta 5 alertas *high*, todos dentro do pacote `prisma` (CLI, `devDependency`):
`mysql2`, `lodash` (via Prisma Studio) e `deepmerge-ts` (via `@prisma/config`).
O `npm audit fix --force` rebaixaria o Prisma para a 6. Overrides exigiriam uma major
do deepmerge-ts dentro de um pacote interno do Prisma.

## Decisão
Aceitar o risco e não aplicar overrides.

## Justificativa
- `npm audit --omit=dev` retorna **0 vulnerabilidades**: o runtime de produção
  (`@prisma/client`, `@prisma/adapter-pg`) não é afetado.
- Não usamos MySQL, e nenhuma entrada de usuário chega ao `_.template` nem ao merge de config do CLI.
- O CLI roda apenas na máquina de desenvolvimento e no CI.
