#!/bin/sh
# Backup periódico do Postgres com rotação e cópia fora do servidor (ADR 0013 / ADR 0014).
# Formato custom (-Fc): comprimido e restaurável seletivamente com pg_restore.
# Grava em .partial e renomeia no fim: um backup interrompido nunca parece completo.
#
# Cópia remota (opcional): defina OFFSITE_REMOTE (ex.: "offsite:meu-bucket/mini-erp") e a
# configuração do rclone em variáveis RCLONE_CONFIG_OFFSITE_* (ver deploy/.env.offsite.example).
set -eu

log() { echo "{\"level\":\"$1\",\"context\":\"Backup\",\"message\":\"$2\"$3}"; }

mkdir -p /backups
while true; do
  file="/backups/mini_erp_$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump --format=custom --file="$file.partial"; then
    mv "$file.partial" "$file"
    log log "backup ok" ",\"file\":\"$file\",\"size\":\"$(du -h "$file" | cut -f1)\""
    # Mantém só os BACKUP_KEEP mais recentes no servidor.
    ls -1t /backups/*.dump | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm --

    if [ -n "${OFFSITE_REMOTE:-}" ]; then
      # Falha no envio NÃO interrompe o ciclo: o backup local continua valendo, e o erro
      # aparece no log (monitore por "offsite falhou").
      if rclone copyto "$file" "$OFFSITE_REMOTE/$(basename "$file")" --retries 3; then
        log log "offsite ok" ",\"remote\":\"$OFFSITE_REMOTE/$(basename "$file")\""
        # Retenção remota por idade (pode ser maior que a local).
        rclone delete "$OFFSITE_REMOTE" --min-age "${OFFSITE_KEEP_DAYS:-30}d" --include "mini_erp_*.dump" || \
          log error "limpeza offsite falhou" ""
      else
        log error "offsite falhou" ",\"remote\":\"$OFFSITE_REMOTE\""
      fi
    fi
  else
    rm -f "$file.partial"
    log error "pg_dump falhou" ""
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
