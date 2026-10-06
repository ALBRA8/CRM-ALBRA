#!/bin/sh
# ============================================================
# CRM ALBRA — Backup nocturno (HOST, cron-able)
#
# La lección de oro del auditor: con SQLite, "recuperación total ante
# desastres" = copia de los archivos físicos. Este script genera, SIN
# detener servicios:
#   1) snapshot consistente de la BD (Online Backup API, con
#      integrity_check — ver scripts/sqlite-backup.cjs)
#   2) copia comprimida de la sesión de WhatsApp (.wa-auth)
#   3) retención: borra copias con más de RETAIN_DAYS días
#   4) (opcional) copia externa con rclone si BACKUP_REMOTE_DEST está
#      definido — un backup SOLO en el VPS no protege contra la pérdida
#      del VPS: fase 1 mínimo = este dir + un destino externo.
#
# Instalación (una vez, en el VPS):
#   crontab -e  →  añadir la línea:
#   30 3 * * * /opt/crm-albra/scripts/backup-nightly.sh >> /var/log/crm-albra-backup.log 2>&1
#
# Variables (opcional):
#   BACKUP_DIR          default /opt/crm-albra/backups
#   RETAIN_DAYS         default 14
#   APP_CONTAINER       default crm-albra-app
#   DAEMON_CONTAINER    default crm-albra-wa-daemon
#   BACKUP_REMOTE_DEST  ej. "b2:crm-albra-backups" (solo si usas rclone)
#
# Restaurar → procedimiento exacto en DEPLOY.md §8.
# ============================================================
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
BACKUP_DIR="${BACKUP_DIR:-/opt/crm-albra/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
APP_CONTAINER="${APP_CONTAINER:-crm-albra-app}"
DAEMON_CONTAINER="${DAEMON_CONTAINER:-crm-albra-wa-daemon}"

STAMP=$(date +%Y-%m-%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# ---------- 1) Snapshot consistente de la BD ----------
docker exec -i "$APP_CONTAINER" node - < "$SCRIPT_DIR/sqlite-backup.cjs"
docker cp "$APP_CONTAINER:/tmp/.backup-snapshot.db" "$BACKUP_DIR/custom-$STAMP.db"

# ---------- 2) Sesión de WhatsApp (.wa-auth) ----------
docker exec "$DAEMON_CONTAINER" sh -c \
  'tar czf - -C /app/src/whatsapp-daemon/.wa-auth .' \
  > "$BACKUP_DIR/wa-auth-$STAMP.tar.gz"

# ---------- 3) Retención ----------
find "$BACKUP_DIR" -name 'custom-*.db' -mtime "+$RETAIN_DAYS" -delete
find "$BACKUP_DIR" -name 'wa-auth-*.tar.gz' -mtime "+$RETAIN_DAYS" -delete

# ---------- 4) Copia externa (opcional) ----------
if [ -n "${BACKUP_REMOTE_DEST:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$BACKUP_DIR/custom-$STAMP.db" "$BACKUP_REMOTE_DEST"
    rclone copy "$BACKUP_DIR/wa-auth-$STAMP.tar.gz" "$BACKUP_REMOTE_DEST"
    echo "[backup] copia externa enviada a $BACKUP_REMOTE_DEST"
  else
    echo "[backup] AVISO: BACKUP_REMOTE_DEST definido pero rclone no está instalado" >&2
  fi
fi

echo "[backup] OK $STAMP — bd: custom-$STAMP.db · wa: wa-auth-$STAMP.tar.gz"
