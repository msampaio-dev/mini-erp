# Deploy gratuito: Render + Neon

Complementa o [guia geral de deploy](deploy.md). Decisões e limites no [ADR 0015](adr/0015-hospedagem-render-neon.md).

```
 navegador ──HTTPS──▶ Render (1 serviço, região Virginia)
                        ├─ /api/*  → NestJS
                        └─ /*      → React (servido pelo próprio Nest)
                                      │  conexão com pooler (app) / direta (migrations)
                                      ▼
                        Neon Postgres (aws-us-east-1, mesma região da AWS)
```

## Limites do plano gratuito (conferidos em out/2026)

- **Render:** o serviço **dorme após 15 min sem acesso** e leva **~1 min para acordar**. Sem disco
  persistente, sem shell. Há 750 h/mês de instância gratuita (suficiente para 1 serviço).
- **Neon:** sem prazo de expiração. 0,5 GB de dados e 100 horas de compute por mês por projeto;
  o banco também "dorme" sem uso e acorda em frações de segundo.
- **Uso indicado:** demonstração e portfólio. Para operar um caixa de verdade, o primeiro cliente
  do dia esperando 1 minuto é inaceitável: use o plano pago do Render ou a stack Docker numa VPS.

## Passo 1: banco no Neon

1. Crie o projeto na região **AWS US East 1 (N. Virginia)**: `aws-us-east-1`.
2. Em **Connect**, copie **duas** connection strings:
   - **com pooler** (o host tem `-pooler`): vai em `DATABASE_URL`, usada pela aplicação;
   - **direta** (sem `-pooler`): vai em `DIRECT_DATABASE_URL`, usada pelas migrations.

## Passo 2: serviço no Render

1. Entre em **render.com** com a sua conta do GitHub.
2. **New → Blueprint** → escolha o repositório `mini-erp`. O Render lê o `render.yaml`.
3. Preencha as variáveis pedidas:
   - `DATABASE_URL` e `DIRECT_DATABASE_URL`: as do passo 1;
   - `SEED_ADMIN_EMAIL`: o e-mail do primeiro administrador.

   A `SEED_ADMIN_PASSWORD` é **gerada pelo Render**.
4. **Apply**. O primeiro deploy compila a imagem (alguns minutos), aplica as migrations e cria
   o admin.

## Passo 3: primeiro acesso

1. No Render, abra o serviço → **Environment** → veja o valor de `SEED_ADMIN_PASSWORD`.
2. Abra a URL `https://mini-erp-XXXX.onrender.com` e entre com o e-mail e essa senha.
3. Em **Meu acesso**, troque a senha.

## Passo 4: calibrar o TRUST_PROXY (segurança do rate limit)

O proxy do Render **acrescenta** IPs ao `X-Forwarded-For` e não descarta o que o cliente manda.
Um valor errado permite forjar o IP e escapar do limite de tentativas de login.

1. No Render, defina `DIAGNOSTICS=true` (Environment) e aguarde o redeploy.
2. Compare:

   ```bash
   curl https://SEU-SERVICO.onrender.com/api/health/client-ip
   curl -H "X-Forwarded-For: 1.2.3.4" https://SEU-SERVICO.onrender.com/api/health/client-ip
   ```

   **Correto:** `ip` é o seu IP real **nas duas chamadas**. Se na segunda aparecer `1.2.3.4`, o
   `TRUST_PROXY` está alto demais. Se aparecer um IP interno do Render, está baixo demais.
3. Volte `DIAGNOSTICS=false`.

## Dia a dia

- **Atualizar:** é só dar push na `main`. O Render publica **depois que o CI passar**
  (`autoDeployTrigger: checksPass`). Se a versão nova falhar ao subir, a anterior continua no ar.
- **Backup:** o Render gratuito não roda o nosso serviço de backup. O Neon guarda um histórico
  curto que permite restaurar o banco a um ponto no tempo (veja o limite atual do plano free no
  painel). Para dados importantes, rode periodicamente, do seu computador:

  ```bash
  pg_dump --format=custom --file=mini_erp_$(date +%F).dump "URL-DIRETA-DO-NEON"
  ```
