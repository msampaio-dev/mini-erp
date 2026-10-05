# ADR 0005: Validação com Zod compartilhado

- **Status:** aceito
- **Data:** 2026-10-05

## Decisão
Os schemas de entrada e saída vivem em `packages/contracts` (Zod 4). O mesmo schema:
- valida o body na API, via `ZodValidationPipe` (`apps/api/src/common/pipes`);
- valida formulários e respostas no front (`apps/web/src/lib/api.ts`).

## Alternativas consideradas
- **class-validator:** é o padrão do Nest, mas não roda no front, então a regra seria duplicada.
- **nestjs-zod:** era a ideia inicial, mas a versão 5.5 ainda não suporta Nest 12 (peer `^10 || ^11`).
  O pipe próprio tem cerca de 20 linhas e elimina uma dependência.

## Consequências
- Uma regra de negócio de formato fica escrita uma vez só.
- O pacote `contracts` precisa ser compilado antes dos apps (os scripts da raiz já fazem isso).
