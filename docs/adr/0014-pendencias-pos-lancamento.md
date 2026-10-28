# ADR 0014: Pendências pós-lançamento

- **Status:** aceito
- **Data:** 2026-10-28
- **Atualiza:** ADR 0006, 0007, 0010, 0011, 0013

## Contas e acesso
- **Troca da própria senha** (`POST /auth/password`): exige a senha atual (quem roubou só o cookie
  não tranca o dono fora), derruba as **outras** sessões e mantém a atual. Senha atual errada
  responde **400 com erro no campo**, não 401: no front, 401 significa "sessão inválida" e
  provocaria logout. Tem rate limit (conferir senha também é alvo de força bruta).
- **Admin:** alterar papéis (`PUT /users/:id/roles`) e redefinir a senha de outro usuário
  (`POST /users/:id/password`, derruba as sessões dele). Papéis valem na **próxima requisição**,
  porque as permissões são carregadas a cada request (ADR 0007).
- **Regra "nunca sem um admin ativo"** (ao alterar papéis e ao desativar):
  - Em sequência ela é inalcançável (só admin administra e ninguém altera a si mesmo), então
    existe para a **concorrência**: dois admins tirando o papel um do outro ao mesmo tempo.
  - Solução: `pg_advisory_xact_lock` serializa toda alteração que pode remover um admin; a
    contagem vem depois, numa instrução nova (READ COMMITTED enxerga o que a outra confirmou).
  - **Testes de mutação:** sem a trava, as duas requisições recebem 200 e o sistema fica **sem
    admin**. Com `SELECT ... FOR UPDATE` nas linhas de `users`, **também falha (3 de 3)**: após a
    espera, o Postgres reavalia só as linhas travadas, e as do JOIN (`user_roles`, que é o que muda)
    seguem da foto antiga. O teste exige que o caminho do 409 seja exercitado em 10 rodadas.

## Catálogo
- Categorias: renomear (`PATCH`) e excluir (`DELETE`) **só sem produtos**: a FK `RESTRICT` decide
  e a API traduz para 409 `CATEGORY_IN_USE` (sem "contar e depois apagar").
- **Trava de unidade** (pendência do ADR 0010): trigger `products_unit_guard` impede trocar para
  unidade inteira com saldo fracionado. A regra cruza Catálogo (unidade) e Estoque (saldo); o
  Catálogo não pode ler o Estoque (ADR 0001) e chamá-lo criaria um ciclo, então o invariante
  fica no banco. Resíduo aceito: uma entrada fracionada **simultânea** à troca de unidade
  (milissegundos) poderia escapar; a API de estoque já recusa frações para unidades inteiras.

## Relatórios
- **Categoria fotografada na venda** (pendência do ADR 0011): `sale_items.category_id/category_name`.
  Mudar o produto de categoria não leva o faturamento antigo junto. Nome exibido: o atual da
  categoria (renomear não cria "outra categoria"); se ela foi excluída, o nome registrado na venda.
  Vendas anteriores à migration receberam a categoria atual (única informação disponível).
- **Nome do produto não é fotografado nos relatórios, por decisão:** o relatório agrupa pela
  entidade produto, e renomear não cria outro produto. O cupom da venda continua com o nome da época.
- Medido de novo após a mudança: margem por categoria em 1 ano de 107 ms → 90 ms.

## Operação
- **Rate limit compartilhado** (substitui a ideia de Redis do ADR 0007): contadores na tabela
  `rate_limits`, atualizados por um único `INSERT ... ON CONFLICT` atômico. Vale para N
  instâncias, sem infraestrutura nova. Teste: 20 tentativas simultâneas = contagem exata.
- **Faxina de hora em hora** (`AccessMaintenanceService`): sessões vencidas (antes só sumiam
  quando o mesmo usuário logava de novo) e contadores expirados. Com várias instâncias, cada uma
  faz a sua: DELETEs idempotentes, sem necessidade de eleger um "líder".
- **Backup fora do servidor:** imagem própria (`deploy/backup.Dockerfile`, pg_dump + rclone).
  Destino e credenciais em `deploy/.env.offsite`, **separado** das senhas do banco. Falha no
  envio não interrompe o backup local (log `offsite falhou`). `restore-check.sh --offsite` baixa a
  cópia remota e restaura a partir dela. Testado com um volume separado simulando o armazenamento
  externo: envio, restauração pela cópia remota e falha de envio com o backup local seguindo.
- **Dependências:** Vitest 4.1.12; `npm audit` **zerado em dev e produção**.
- **Prisma 8: não migrar ainda.** A tag `latest` do npm aponta para `8.0.0-rc.28` (release
  candidate), e o ADR 0003 veta RC num sistema de uso real. Estamos na última estável (7.10.1).
  Retomar quando houver `8.x` estável: ler o guia de migração, rodar a suíte num branch e só então
  migrar. (Na resposta anterior eu disse que a 8 era estável; estava errado.)

## Desenvolvimento
- `npm run dev:api` compila em `dist-dev/` (tsconfig.dev.json): o `npm run build`, que limpa
  `dist/`, não derruba mais a API de desenvolvimento.
