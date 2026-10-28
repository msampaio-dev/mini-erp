# Guia de deploy

Implantação num servidor Linux com Docker (VPS de qualquer provedor). Arquitetura e decisões no
[ADR 0013](adr/0013-qualidade-e-deploy.md).

```
 navegador ──HTTPS──▶ web (Caddy) ── /api/* ──▶ api (Node, sem root, FS somente leitura)
                        └─ /* front (React)          │
                                                     ▼
                     migrate (1x por deploy) ──▶ postgres ◀── backup (diário + rotação)
```

## 1. Pré-requisitos

- Servidor Linux com Docker Engine e o plugin `docker compose` (2 GB de RAM bastam).
- Um domínio apontando (registro **A**/AAAA) para o IP do servidor.
- Portas **80 e 443** liberadas no firewall (o Caddy usa a 80 para emitir o certificado).

## 2. Primeira instalação

```bash
git clone <seu-repositorio> mini-erp && cd mini-erp
cp deploy/.env.prod.example deploy/.env.prod
```

Edite `deploy/.env.prod`:

| Variável | Valor |
|---|---|
| `SITE_ADDRESS` | o domínio, ex.: `erp.minhaloja.com.br` (o Caddy emite o HTTPS sozinho) |
| `PUBLIC_URL` | `https://` + o domínio |
| `POSTGRES_PASSWORD`, `SEED_ADMIN_PASSWORD` | senhas longas e **URL-safe** (veja abaixo) |
| `SEED_ADMIN_EMAIL` | e-mail do primeiro administrador |

```bash
# gera uma senha URL-safe (só letras, números, - e _)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# sem Node no servidor:
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Suba:

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod ps
```

Esperado: `migrate` **Exited (0)**, `api` **healthy**, `web`, `postgres` e `backup` **Up**.
Abra `https://seu-dominio`, entre com o admin do `.env.prod` e **troque a senha** criando um
novo usuário administrador e desativando o inicial (a troca de senha ainda não existe na tela).

## 3. Atualizar para uma versão nova

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

O `migrate` roda antes da API nova subir. Se uma migration falhar, a API **antiga continua no
ar** e o erro aparece em `docker compose ... logs migrate`.

## 4. Backups

- O serviço `backup` faz um `pg_dump` ao iniciar e depois a cada `BACKUP_INTERVAL_SECONDS`,
  mantendo os `BACKUP_KEEP` mais recentes no volume `backups`.
- **Teste de restauração** (rode após instalar e depois mensalmente):

  ```bash
  docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod exec backup sh /scripts/restore-check.sh
  ```

  Ele restaura o backup mais recente num banco temporário e confere schema e invariantes de
  negócio. Saída esperada: `OK: backup restaurável e consistente`.
- **Cópia fora do servidor (recomendado):** o volume local fica no MESMO disco do banco. Para
  enviar cada backup a outro lugar (S3, Backblaze B2, Cloudflare R2, SFTP...) via rclone:

  ```bash
  cp deploy/.env.offsite.example deploy/.env.offsite   # preencha destino e credenciais
  docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build backup
  ```

  O log passa a mostrar `offsite ok` a cada backup. Monitore por `offsite falhou`: uma falha no
  envio não interrompe o backup local. Use uma credencial com acesso **só** a esse bucket.
- **Teste de restauração a partir da cópia externa** (prova que dá para recuperar mesmo se o
  servidor inteiro for perdido):

  ```bash
  docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod exec backup sh /scripts/restore-check.sh --offsite
  ```

### Restaurar de verdade (desastre)

```bash
P="docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod"
$P stop api web                      # ninguém escrevendo durante a restauração
$P exec backup sh -c 'dropdb "$PGDATABASE" && createdb "$PGDATABASE" && pg_restore --no-owner -d "$PGDATABASE" /backups/<arquivo>.dump'
$P start api web
```

## 5. Operação

| Tarefa | Comando |
|---|---|
| Logs da API (JSON, um evento por linha) | `docker compose ... logs -f api` |
| Seguir uma requisição | procure o `X-Request-Id` (devolvido em toda resposta) nos logs do `web` e da `api` |
| Saúde | `curl https://seu-dominio/api/health` (readiness) e `/api/health/live` (liveness) |
| Erro 500 reportado por um usuário | a mensagem traz um código: é o `requestId`, procure-o no log da API |

## 6. Testar a stack de produção localmente

Sem domínio, com HTTP na porta 8080:

```bash
cp deploy/.env.prod.example deploy/.env.prod.local
# edite: SITE_ADDRESS=:80  PUBLIC_URL=http://localhost:8080  HTTP_PORT=8080  HTTPS_PORT=8443  + senhas
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod.local up -d --build
```

O projeto compose de produção se chama `mini-erp-prod`: os volumes dele **não** se misturam com
os do ambiente de desenvolvimento (`mini-erp`). No Git Bash (Windows), use `MSYS_NO_PATHCONV=1`
antes de comandos com caminhos de container (ex.: `/scripts/restore-check.sh`).
