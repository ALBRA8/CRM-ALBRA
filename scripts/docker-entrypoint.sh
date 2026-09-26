#!/bin/sh
# ============================================================
# CRM ALBRA — Entrypoint de Docker (POSIX sh, sin bash)
#
# Roles (primer argumento):
#   app    (default) → sincroniza el esquema Prisma con la BD SQLite y
#                      arranca el servidor Next.js standalone (server.js).
#   daemon           → espera a que el esquema exista y arranca el daemon
#                      de WhatsApp (src/whatsapp-daemon/daemon.mjs, :3002).
# ============================================================
set -e

ROLE="${1:-app}"
cd /app

# El volumen puede llegar vacío en el primer arranque
mkdir -p /app/db

if [ "$ROLE" = "daemon" ]; then
  # Defensa extra: en Compose el orden ya lo garantiza
  # `depends_on: app: condition: service_healthy` (app solo está sano
  # después del db push). Esto cubre `docker run` manuales o reinicios
  # fuera de Compose: evita que better-sqlite3 abra una BD sin esquema.
  i=0
  until node scripts/docker-wait-db.mjs >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 90 ]; then
      echo "[entrypoint] Aviso: esquema de BD no detectado tras 90s; se arranca el daemon igualmente." >&2
      break
    fi
    sleep 1
  done

  # exec → el daemon reemplaza al entrypoint: recibe SIGTERM directamente
  # (parada limpia con `docker stop`). Baileys cierra la sesión con gracia.
  exec node src/whatsapp-daemon/daemon.mjs
fi

# ---------------- Rol app (default) ----------------
# Sincroniza el esquema con la BD (idempotente: no-op si ya está en sync).
#
# TRADE-OFF documentado (README › Despliegue con Docker):
#   En v0.x con SQLite usamos `prisma db push` en cada arranque como
#   "migración automática": los cambios del schema.prisma se aplican solos.
#   Con --accept-data-loss, cambios destructivos (borrar/renombrar columnas)
#   también se aplican → HAZ BACKUP del volumen db-data antes de actualizar.
#   Desactiva con SKIP_DB_PUSH=1 si prefieres aplicarlo a mano:
#     docker compose exec app npx prisma db push
if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
  echo "[entrypoint] Sincronizando esquema Prisma (prisma db push --skip-generate)..."
  npx prisma db push --skip-generate --accept-data-loss
fi

# Servidor standalone de Next (escucha en PORT/HOSTNAME = 3000 / 0.0.0.0).
# `exec` reemplaza al shell: `docker stop` llega directo al servidor.
exec node server.js
