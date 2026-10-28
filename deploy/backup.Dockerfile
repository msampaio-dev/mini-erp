# Imagem do serviço de backup: cliente do Postgres (mesma versão do servidor) + rclone,
# que envia a cópia para fora do servidor (S3, Backblaze B2, SFTP... ver docs/deploy.md).
FROM postgres:18-alpine
RUN apk add --no-cache rclone
# A configuração do rclone vem SÓ de variáveis RCLONE_CONFIG_* (deploy/.env.offsite), sem arquivo.
ENV RCLONE_CONFIG=/dev/null
COPY deploy/backup.sh deploy/restore-check.sh /scripts/
ENTRYPOINT ["/bin/sh", "/scripts/backup.sh"]
