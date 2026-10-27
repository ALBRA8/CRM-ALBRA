#!/bin/bash
# Bootstrap de la campaña E2E — instancias REALES de los 3 servicios en entorno aislado.
# Todos los datos son sintéticos (prefijos e2e-2026). Sin WhatsApp real, sin campañas reales.
set -e
REPO=/home/z/my-project/albra-final
E2E=$REPO/e2e
LOGS=$E2E/logs
CREDS=$E2E/.e2e-creds.sh
source "$E2E/.e2e-creds.sh"
DB=$E2E/crm-e2e.db

# ---------- 0. Limpieza previa de procesos y BD ----------
for port in 3000 3002 3003 3004 3012; do
  pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
done
sleep 1
rm -f "$DB" "$REPO/WHATSPOWER/db/operational.db" "$REPO/WHATSPOWER-ULTRA/db/broadcast.db" "$E2E/stub-dispatches.jsonl"

# ---------- 1. CRM: BD fresca desde el schema ----------
cd "$REPO/CRM-ALBRA"
export DATABASE_URL="file:$DB" APP_SECRET="$E2E_APP_SECRET" APP_ENCRYPTION_KEY="$E2E_ENC_KEY" \
  INTERNAL_API_SECRET="$E2E_INT_SECRET" NEXT_TELEMETRY_DISABLED=1
bunx prisma db push --skip-generate --accept-data-loss > "$LOGS/prisma-push.log" 2>&1
echo "[1] BD CRM creada: $DB"

# ---------- 2. CRM dev server :3000 (build bloqueado por memoria del sandbox; dev = instancia real) ----------
WHATSPOWER_ENABLED=true WHATSPOWER_WEBHOOK_SECRET="$E2E_WP_SECRET" nohup bunx next dev -p 3000 > "$LOGS/crm.log" 2>&1 &
echo $! > "$E2E/crm.pid"
for i in $(seq 1 60); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health || true)
  [ "$code" = "200" ] && break
done
echo "[2] CRM :3000 health=$code"

# ---------- 3. Org + usuario + JWT + API key (sintéticos) ----------
REG=$(curl -s -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"E2E 2026 Owner","email":"e2e-2026@albra-test.local","password":"E2e2026!SyntheticPass","company":"E2E Synth Org"}')
TOK=$(echo "$REG" | jq -r '.token // .accessToken // empty')
if [ -z "$TOK" ]; then
  LOGIN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
    -d '{"email":"e2e-2026@albra-test.local","password":"E2e2026!SyntheticPass"}')
  TOK=$(echo "$LOGIN" | jq -r '.token // .accessToken // empty')
fi
echo "[3] registro/login JWT: $([ -n "$TOK" ] && echo OK || echo FALLÓ)"
KEYRAW=$(curl -s -X POST http://localhost:3000/api/settings/api-keys -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"name":"e2e-bridge-key"}' | jq -r '.secret // empty')
echo "[3b] API key org creada: $([ -n "$KEYRAW" ] && echo OK || echo FALLÓ)"

# Pre-calentar rutas que usan los flujos (compila en dev una sola vez)
for route in "api/health" "api/auth/me"; do curl -s -o /dev/null "http://localhost:3000/$route" || true; done
curl -s -o /dev/null -X POST http://localhost:3000/api/crm/actions -H "Authorization: Bearer $KEYRAW" -H 'Content-Type: application/json' -d '{"action":"create_client","params":{"name":"warmup","phone":"573000000000"}}' || true
curl -s -o /dev/null -X POST http://localhost:3000/api/whatsapp/webhook -H 'Content-Type: application/json' -d '{}' || true
echo "[3c] rutas CRM pre-calentadas"

# ---------- 4. Daemon real :3002 (Baileys NO conectado → sin envío posible) ----------
cd "$REPO/CRM-ALBRA"
DATABASE_URL="file:$DB" INTERNAL_API_SECRET="$E2E_INT_SECRET" WHATSAPP_SESSION_PATH="$E2E/wa-session" \
  nohup node src/whatsapp-daemon/daemon.mjs > "$LOGS/daemon.log" 2>&1 &
echo $! > "$E2E/daemon.pid"
sleep 2
dcode=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/status -H "Authorization: Bearer $E2E_INT_SECRET" || true)
echo "[4] daemon :3002 status=$dcode (401/200 esperado)"

# ---------- 5. WHATSPOWER :3003 con cliente CRM real ----------
cd "$REPO/WHATSPOWER"
mkdir -p db
PORT=3003 CRM_BASE_URL=http://localhost:3000 CRM_API_KEY="$KEYRAW" \
  AGENTIC_2A_WEBHOOK_SECRET="$E2E_WP_SECRET" INTERNAL_API_SECRET="$E2E_INT_SECRET" \
  nohup node --experimental-strip-types src/server.ts > "$LOGS/wp.log" 2>&1 &
echo $! > "$E2E/wp.pid"
for i in $(seq 1 15); do sleep 1; wcode=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/api/health || true); [ "$wcode" = "200" ] && break; done
echo "[5] WHATSPOWER :3003 health=$wcode"

# ---------- 6. ULTRA :3004 ----------
cd "$REPO/WHATSPOWER-ULTRA"
mkdir -p db
PORT=3004 INTERNAL_API_SECRET="$E2E_INT_SECRET" \
  nohup node --experimental-strip-types src/server.ts > "$LOGS/ultra.log" 2>&1 &
echo $! > "$E2E/ultra.pid"
sleep 2
ucode=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3004/ || true)
echo "[6] ULTRA :3004 http=$ucode"

# ---------- 7. Stub fiel del daemon :3012 ----------
cd /home/z/my-project
STUB_SECRET="$E2E_INT_SECRET" STUB_LOG="$E2E/stub-dispatches.jsonl" \
  nohup node "$REPO/e2e/stub-daemon.mjs" > "$LOGS/stub.log" 2>&1 &
echo $! > "$E2E/stub.pid"
sleep 1
echo "[7] stub :3012 levantado"

# ---------- 8. Guardar contexto para los flujos (fichero 600, nunca en evidencia) ----------
{
  echo "export E2E_TOK='$TOK'"
  echo "export E2E_CRM_KEY='$KEYRAW'"
  echo "export E2E_WP_PID=$(cat "$E2E/wp.pid")"
  echo "export E2E_CRM_PID=$(cat "$E2E/crm.pid")"
} >> "$CREDS"
chmod 600 "$CREDS"
echo "BOOTSTRAP COMPLETO"
