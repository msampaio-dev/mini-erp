# ADR 0015: Hospedagem gratuita no Render + Neon

- **Status:** aceito
- **Data:** 2026-10-31
- **Contexto anterior:** ADR 0013 (stack Docker + Caddy). A Oracle Always Free não deu certo.

## Contexto
O plano gratuito do Render (conferido na documentação oficial):
- só um serviço web com spin-down (15 min sem acesso, ~1 min para acordar);
- **sem pre-deploy command** (é recurso pago);
- sem disco persistente e sem shell.

O Postgres gratuito do Render expira em 30 dias e não tem backup, então o banco fica no Neon
(free, sem expiração).

## Decisões

### Um serviço só: a API também serve o front
Em vez de Caddy + API (dois serviços que dormiriam e acordariam separados), o Nest serve o build
do React quando `WEB_DIST_DIR` está definido (`app.setup.ts`): assets com cache imutável, HTML
`no-cache`, fallback de SPA e a **mesma CSP** do Caddy. Isso preserva a **mesma origem**
(cookie `__Host-`, SameSite=Lax, sem CORS: ADR 0007). Rotas `/api/*` inexistentes continuam
404 JSON, nunca o `index.html` (há teste).
Nada muda na stack Docker/Caddy: sem `WEB_DIST_DIR`, a API se comporta como antes.

### Migrations no início do container
Sem pre-deploy no plano free, o comando de início é `migrate deploy → seed → node`. É seguro:
- o `prisma migrate deploy` usa trava consultiva (nunca duas migrations ao mesmo tempo);
- o Render só troca o tráfego quando a instância nova sobe e passa no health check, então uma
  migration com erro mantém a versão anterior no ar.

Custo: alguns segundos a mais em cada "acordar" (as migrations já aplicadas são verificadas e o
seed é idempotente; testado subindo duas vezes). **Consequência que vale para sempre:** a versão
antiga roda contra o schema novo durante o deploy, então migrations precisam ser compatíveis
com a versão anterior (expandir antes, remover depois).

### Neon: duas conexões
`DATABASE_URL` com pooler (PgBouncer em modo transação) para a aplicação, e `DIRECT_DATABASE_URL`
para o CLI do Prisma (`prisma.config.ts`), como recomenda o guia Neon + Prisma. O código é
compatível com o pooler: transações interativas e `pg_advisory_xact_lock` (escopo de transação)
funcionam em modo transação.

### Região
Render **virginia** + Neon **aws-us-east-1**: cada requisição faz várias consultas, então API e
banco precisam estar próximos. O usuário no Brasil paga uma ida e volta (~120 ms); o contrário
(API no Brasil, banco nos EUA) pagaria isso **por consulta**.

### Health check sem banco
`healthCheckPath: /api/health/live`. O Render chama o health check continuamente: se ele tocasse
no Postgres, o Neon nunca dormiria e as 100 h/mês de compute gratuito acabariam.

### TRUST_PROXY calibrado por medição
O proxy do Render acrescenta ao `X-Forwarded-For` sem descartar o valor do cliente (relato da
comunidade; a documentação oficial não diz quantos saltos há). Em vez de adivinhar, existe
`GET /api/health/client-ip`, **desligado por padrão** (`DIAGNOSTICS=true` liga), para conferir
após o deploy que o IP é o real e que um XFF forjado não o altera.

### Deploy só com CI verde
`autoDeployTrigger: checksPass` no `render.yaml`.

### Senha do admin gerada pelo Render
`generateValue: true`: a senha inicial não passa por e-mail, chat nem repositório. O usuário a lê
no painel e troca no primeiro acesso.

## Consequências e limites
- Primeiro acesso após 15 min parado: ~1 minuto. Inadequado para um caixa real; ok para portfólio.
- Sem o serviço de backup (ADR 0013): no free, o backup é o histórico do Neon mais `pg_dump` manual.
- Imagem grande (~1,4 GB), porque leva as dependências de desenvolvimento (CLI do Prisma e tsx,
  usados no início). Otimização possível: compilar o seed para JS e instalar só o CLI do Prisma.

## Correção feita no caminho
A faxina periódica (ADR 0014) roda ao iniciar. Um desligamento no meio dela fechava o pool de
conexões debaixo da transação ("Unable to start a transaction"); os testes revelaram isso. Agora
o `onModuleDestroy` aguarda a faxina em andamento (desligamento gracioso), o que importa no Render,
que reinicia o container a cada spin-down.
