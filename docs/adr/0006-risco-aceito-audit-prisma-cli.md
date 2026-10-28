# ADR 0006: Risco aceito, alertas do npm audit no CLI do Prisma

- **Status:** superado em 2026-10-28 (ver atualização no fim)
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

## Atualização (2026-10-28)
**Superado.** Com o Prisma 7.10.1 (CLI, client e adapter alinhados), os 5 alertas *high* do CLI
desapareceram. O `npm audit` completo mostra só 3 alertas *moderate* no Vitest (ferramenta de
teste, nunca vai para produção). O CI agora bloqueia qualquer alerta *high* em dependências de
produção (`npm audit --omit=dev --audit-level=high`, ADR 0013).
