# ADR 0013: Qualidade e deploy

- **Status:** aceito
- **Data:** 2026-10-28
- **Guia operacional:** [docs/deploy.md](../deploy.md)

## D37: tela de usuários
A API de usuários existia desde a Fase 2, sem tela. Agora: criar com papéis, desativar e reativar.
Ninguém desativa a si mesmo (regra na API; a tela nem oferece o botão).
**Pendente:** troca de senha pelo próprio usuário (não há endpoint ainda).

## D38: CI (GitHub Actions)
`.github/workflows/ci.yml`: `npm ci` → contratos + `prisma generate` → lint → tipos (API e front)
→ testes de contratos e unitários → **e2e contra um Postgres 18 real** (service container) → build
→ `npm audit --omit=dev --audit-level=high`; depois, build das três imagens Docker (sem publicar).

Validado localmente **num clone limpo** com os mesmos passos: o projeto não depende de nada que só
existe na máquina de desenvolvimento. Nessa simulação, o portão de auditoria **barrou 5
vulnerabilidades novas** (zod, multer, body-parser, qs, @nestjs/platform-express), todas corrigidas
com atualizações sem quebra. O `audit fix` desalinhou CLI (7.10.1) e client (7.10.0) do Prisma; os
três pacotes foram alinhados em 7.10.1 e os scripts de instalação reaprovados explicitamente.

## D39: imagens e proxy reverso
- **API** (`apps/api/Dockerfile`): multi-stage. Alvo `runtime` só com dependências de produção,
  usuário `node` (uid 1000), e no compose: sistema de arquivos somente leitura, `cap_drop: ALL`,
  `no-new-privileges`. Alvo `migrate` com o CLI do Prisma (precisa de OpenSSL; o runtime não).
- **Web** (`apps/web/Dockerfile`): o build do React servido pelo **Caddy** (imagem final sem
  Node). O Caddy emite/renova HTTPS sozinho, encaminha `/api/*` (mesma origem: sem CORS),
  aplica CSP e cabeçalhos de segurança, cache imutável para `/assets/*` e `no-cache` no HTML.
- Só o `web` publica portas; API e Postgres ficam na rede interna (verificado).

## D40: migrations como etapa separada
O serviço `migrate` roda `prisma migrate deploy` + seed idempotente e termina. A API só sobe com
`service_completed_successfully`: migration com erro = versão nova não sobe, a antiga continua.

## D41: endurecimento e backup
- `helmet`, `trust proxy` = 1 salto (Caddy), cookie `__Host-` em produção.
  **Teste:** 7 tentativas de login com `X-Forwarded-For` forjado diferente em cada uma: a 6ª
  recebeu 429. O Caddy não repassa XFF do cliente, então o rate limit não é contornável.
- Backup com `pg_dump -Fc` periódico e rotação, mais `restore-check.sh`, que restaura num banco
  temporário e confere schema e invariantes de negócio (total da venda = soma dos itens, saldo ≥ 0).

## D42: observabilidade
`X-Request-Id` em toda resposta (gerado pelo Caddy, repassado à API, aceito só com formato seguro),
o mesmo ID nos logs de acesso do Caddy e nos logs JSON da API (`ConsoleLogger({ json: true })`,
sem dependência). Erro inesperado: 500 com o `requestId` e sem detalhes internos; stack só no log.
`/api/health/live` (liveness, sem banco) e `/api/health` (readiness, com banco; é o HEALTHCHECK
do container, pois o compose usa a saúde para ordenar a subida).

## D43: hospedagem
Sem escolha do usuário ainda: tudo pronto para VPS com Docker Compose, nada publicado.
Também não há repositório remoto: o CI roda no primeiro push para o GitHub.

## Incidentes encontrados pelos testes desta fase
1. **Volumes compartilhados entre dev e produção.** Sem `name:` nos arquivos compose, os dois
   herdavam o nome da pasta (`mini-erp`) e o volume `pgdata` era **o mesmo**: o Postgres "de
   produção" substituiu o container de dev e abriu os dados de desenvolvimento. Detectado por um
   erro de autenticação; a stack foi derrubada sem apagar volumes, e o log do Postgres de dev
   mostrou início limpo (sem recuperação de falha) e os dados intactos.
   **Regra:** todo arquivo compose declara `name:` (`mini-erp` e `mini-erp-prod`).
2. **Primeiro backup vazio.** O serviço de backup esperava só o Postgres, não as migrations: o
   primeiro dump de um servidor novo não tinha tabelas. O `restore-check.sh` pegou isso no
   primeiro uso. Agora o backup depende do `migrate`, e o script verifica o schema antes de tudo;
   comprovado recriando a stack do zero.
3. **OpenSSL ausente** na imagem slim quebrava o motor de migrations do Prisma (aviso no build,
   falha no `migrate`). Instalado só no estágio de build.
