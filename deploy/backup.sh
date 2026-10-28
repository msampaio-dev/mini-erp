#!/bin/sh
# Backup periódico do Postgres com rotação (ADR 0013, D41).
# Formato custom (-Fc): comprimido e restaurável seletivamente com pg_restore.
# Grava em .partial e renomeia no fim: um backup interrompido nunca parece completo.
set -eu

mkdir -p /backups
while true; do
  file="/backups/mini_erp_$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump --format=custom --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "{\"level\":\"log\",\"context\":\"Backup\",\"message\":\"backup ok\",\"file\":\"$file\",\"size\":\"$(du -h "$file" | cut -f1)\"}"
    # Mantém só os BACKUP_KEEP mais recentes.
    ls -1t /backups/*.dump | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm --
  else
    rm -f "$file.partial"
    echo "{\"level\":\"error\",\"context\":\"Backup\",\"message\":\"pg_dump falhou\"}"
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
