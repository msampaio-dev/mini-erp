#!/bin/sh
# Teste de restauração (ADR 0013, D41): "backup que nunca foi restaurado é só uma esperança".
# Restaura o backup mais recente num banco TEMPORÁRIO e confere se os dados fazem sentido.
# O banco de produção não é tocado.
#
#   docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod exec backup sh /scripts/restore-check.sh
#   ... restore-check.sh --offsite   # BAIXA a cópia remota mais recente e restaura a partir dela
set -eu

check_db="restore_check_$(date -u +%Y%m%d%H%M%S)"
download=""
cleanup() {
  dropdb --if-exists "$check_db" >/dev/null 2>&1 || true
  [ -z "$download" ] || rm -f "$download"
}
trap cleanup EXIT

if [ "${1:-}" = "--offsite" ]; then
  # Prova que a cópia FORA do servidor serve: se o disco morrer, é dela que vamos depender.
  [ -n "${OFFSITE_REMOTE:-}" ] || { echo "FALHOU: OFFSITE_REMOTE não configurado"; exit 1; }
  name=$(rclone lsf --files-only --include "mini_erp_*.dump" "$OFFSITE_REMOTE" | sort | tail -n 1)
  [ -n "$name" ] || { echo "FALHOU: nenhum backup em $OFFSITE_REMOTE"; exit 1; }
  download="/tmp/$name"
  echo "Baixando $OFFSITE_REMOTE/$name..."
  rclone copyto "$OFFSITE_REMOTE/$name" "$download"
  latest="$download"
else
  latest=$(ls -1t /backups/*.dump 2>/dev/null | head -n 1 || true)
  [ -n "$latest" ] || { echo "FALHOU: nenhum backup encontrado em /backups"; exit 1; }
fi

echo "Restaurando $latest em $check_db..."
createdb "$check_db"
pg_restore --no-owner --exit-on-error --dbname="$check_db" "$latest"

q() { psql --dbname="$check_db" --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="$1"; }

echo "Conferindo..."
# Primeiro o schema: um dump de banco vazio restaura "com sucesso" e não serve para nada.
[ "$(q "SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public._prisma_migrations') IS NOT NULL")" = "t" ] \
  || { echo "FALHOU: o backup não contém o schema do sistema (dump de banco vazio?)"; exit 1; }
echo "  migrations aplicadas: $(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
echo "  usuários: $(q 'SELECT count(*) FROM users')   permissões: $(q 'SELECT count(*) FROM permissions')"
echo "  produtos: $(q 'SELECT count(*) FROM products')   vendas: $(q 'SELECT count(*) FROM sales')"

# Invariantes de negócio: o backup tem de ser CONSISTENTE, não só "existir".
problems=$(q "
  SELECT (SELECT count(*) FROM permissions) = 0
      OR EXISTS (SELECT 1 FROM sales s
                 WHERE s.status = 'COMPLETED'
                   AND s.total_cents <> (SELECT coalesce(sum(i.net_cents), 0) FROM sale_items i WHERE i.sale_id = s.id))
      OR EXISTS (SELECT 1 FROM stock_balances WHERE quantity < 0)")
[ "$problems" = "f" ] || { echo "FALHOU: o backup restaurado viola invariantes de negócio"; exit 1; }

echo "OK: backup restaurável e consistente ($latest)"
