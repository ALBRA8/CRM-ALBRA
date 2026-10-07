#!/bin/bash
# ============================================================
# CRM ALBRA — CLEAN-ROOM (§31 del cierre de producción)
#
# Demuestra que el repo funciona desde un CLONE LIMPIO, sin reutilizar
# node_modules, BDs, builds, caches ni secretos del entorno original:
#
#   git clone → install (lockfile) → prisma generate → BD desde cero
#   → build → start → health → E2E completo (scripts/e2e-final.mjs)
#
# Salida: .clean-room/ (clonado completo, se conserva para inspección)
# Exit: 0 PASS · 1 FAIL
# ============================================================
set -euo pipefail

# Neutraliza contaminación del entorno original (el gate #31 existe para
# descubrir EXACTAMENTE esto): variables exportadas en el shell pisan .env
# por precedencia de Prisma → la BD "clean-room" podría apuntar a la BD real.
unset DATABASE_URL APP_SECRET APP_ENCRYPTION_KEY INTERNAL_API_SECRET PORT HOSTNAME || true

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$SRC/.clean-room"
PORT=3102

echo "── [1/8] git clone limpio → $DEST"
rm -rf "$DEST"
git clone --quiet "$SRC" "$DEST"
cd "$DEST"
# Verificación de pureza: no debe existir nada heredado
test ! -d node_modules && test ! -f db/clean-room.db
echo "   clone OK (sin node_modules ni BD previa)"

echo "── [2/8] entorno: .env generado con secretos NUEVOS (no se copia el original)"
cat > .env << ENV
APP_SECRET="cleanroom-$(openssl rand -hex 16)"
APP_ENCRYPTION_KEY="cleanroom-$(openssl rand -hex 16)"
INTERNAL_API_SECRET="cleanroom-$(openssl rand -hex 16)"
# Ruta ABSOLUTA: Prisma (CLI) y el runtime resuelven file: relativo de forma
# distinta (schema dir vs cwd) — la misma lección del docker-compose.
DATABASE_URL="file:$DEST/db/clean-room.db"
WHATSAPP_DAEMON_URL="http://localhost:3998"
ENV
mkdir -p "$DEST/db"

echo "── [3/8] instalación limpia (lockfile congelado, PARIDAD con Dockerfile)"
# El Dockerfile de producción usa npm ci (--legacy-peer-deps): aquí igual.
# (bun install completa el build pero hoy no emite .next/standalone de forma
# fiable — trazado de node_modules distinto; CI usa bun solo para tipos+tests.)
if [ -f package-lock.json ]; then
  npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null
else
  npm install --legacy-peer-deps --no-audit --no-fund >/dev/null
fi

echo "── [4/8] prisma generate + BD desde CERO"
npx prisma generate >/dev/null
npx prisma db push --skip-generate 2>&1 | tail -1
test -f "$DEST/db/clean-room.db" || { echo "FAIL: la BD clean-room no se creó"; exit 1; }

echo "── [5/8] build de producción (esto tarda; sin caches del original)"
# Reintento: en VPS/sandboxes de 4 GB un worker de Turbopack puede ser
# OOM-killed; el segundo intento reconstruye sin estado corrupto.
if ! npm run build >/dev/null 2>&1; then
  echo "   build falló (probable OOM transitorio) — reintentando..."
  rm -rf .next
  npm run build >/dev/null
fi
test -f .next/standalone/server.js || { echo "FAIL: el build no produjo standalone"; exit 1; }

echo "── [6/8] start standalone :$PORT + health"
set -a; source .env; set +a
export PORT=$PORT HOSTNAME=127.0.0.1
setsid node .next/standalone/server.js > "$DEST/clean-room-server.log" 2>&1 &
SRV=$!
HEALTH=""
for i in $(seq 1 20); do
  sleep 1
  HEALTH=$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
  [ -n "$HEALTH" ] && break
done
echo "   health: $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || { echo "FAIL: health no respondió ok"; kill $SRV 2>/dev/null || true; exit 1; }

echo "── [7/9] E2E completo contra la instancia clean-room"
set +e
node scripts/e2e-final.mjs --base "http://127.0.0.1:$PORT" | tail -24
E2E_RC=$?
set -e

echo "── [8/9] E2E de aislamiento WhatsApp multi-tenant (HTTP real, fail-closed)"
# Levanta su propia app (:3100, BD efímera) + mock de daemon (:3997) —
# usa el standalone construido dentro de ESTE clone limpio.
set +e
node scripts/e2e-whatsapp-isolation.mjs | tail -24
WA_RC=$?
set -e

echo "── [9/9] limpieza de procesos"
kill $SRV 2>/dev/null || true
pkill -f "standalone/server.js" 2>/dev/null || true

if [ "$E2E_RC" -eq 0 ] && [ "$WA_RC" -eq 0 ]; then
  echo "CLEAN-ROOM: PASS"
  exit 0
else
  echo "CLEAN-ROOM: FAIL"
  exit 1
fi
