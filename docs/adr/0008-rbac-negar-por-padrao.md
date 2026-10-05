# ADR 0008: RBAC com permissões granulares e negação por padrão

- **Status:** aceito
- **Data:** 2026-10-05

## Decisão
- Modelo `usuário → papéis → permissões`, com tabelas de junção `user_roles` e `role_permissions`.
- O **código checa permissões, nunca papéis**: `@RequirePermission('estoque:ajustar')`.
- O catálogo de permissões fica em `@mini-erp/contracts` (`PERMISSIONS`): chaves tipadas no
  front e no back, e um erro de digitação não compila.
- Os papéis padrão (`ROLE_DEFINITIONS`) ficam em código e são sincronizados com o banco
  pelo seed idempotente (`npm run db:seed -w @mini-erp/api`).
- **Negar por padrão:** um guard global (`APP_GUARD`) exige que toda rota declare
  `@Public()`, `@Authenticated()` ou `@RequirePermission(...)`. Rota sem política
  responde 403 e registra um log de erro.

## Consequências
- Criar um novo papel não exige mudar controllers.
- Esquecer de proteger uma rota nova falha **fechado** (403), nunca aberto.
- O `can()` do front é só conveniência de interface; a autorização real é sempre da API.
