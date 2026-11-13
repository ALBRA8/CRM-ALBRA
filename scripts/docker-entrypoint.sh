#!/bin/sh
# ============================================================
# CRM ALBRA — Entrypoint de Docker (POSIX sh, sin bash)
#
# Roles (primer argumento):
#   app    (default) → aplica las migraciones Prisma pendientes en la BD SQLite y
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
  # después de migrate deploy). Esto cubre `docker run` manuales o reinicios
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
# SEGURO POR DEFECTO (auditoría pre-venta, revisión de migraciones):
#   Sin datos que perder, `prisma db push` aplica cambios aditivos sin ruido.
#   Si un cambio de esquema exige destruir datos, push FALLA RUIDOSO en vez
#   de aceptarlos: primero HAZ BACKUP y decide. Solo con ALLOW_DATA_LOSS=1
#   se añade --accept-data-loss (misma conducta que antes de este hardening).
#   Desactiva por completo con SKIP_DB_PUSH=1 (BD ya en producción):
#     docker compose exec app npx prisma db push
if [ "${SKIP_DB_MIGRATE:-0}" != "1" ]; then
  echo "[entrypoint] Aplicando migraciones Prisma pendientes (migrate deploy)..."
  if ! node scripts/db-guard.mjs migrate; then
    echo "[entrypoint] ERROR: migrate deploy no pudo aplicar las migraciones." >&2
    echo "[entrypoint] Si la BD ya tenía esquema previo y no tiene _prisma_migrations, no marques el baseline automáticamente." >&2
    echo "[entrypoint] Haz backup, compara el esquema con 0_baseline y sigue docs/MIGRACIONES.md (P3005)." >&2
    exit 1
  fi
fi

# Servidor standalone de Next (escucha en PORT/HOSTNAME = 3000 / 0.0.0.0).
# `exec` reemplaza al shell: `docker stop` llega directo al servidor.
exec node server.js
