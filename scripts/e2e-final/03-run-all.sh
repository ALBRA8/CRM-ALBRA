#!/bin/bash
# Runner principal de la campaña E2E — ejecuta los 4 flujos en orden.
set -e
H=/home/z/my-project/scripts/e2e-final
E2E=/home/z/my-project/albra-final/e2e
REPO=/home/z/my-project/albra-final
bash "$H/00-gen-creds.sh"
bash "$H/01-bootstrap.sh"
source "$E2E/.e2e-creds.sh"
export E2E_WP_SECRET E2E_INT_SECRET E2E_TOK E2E_CRM_KEY E2E_ENC_KEY E2E_META_SECRET E2E_WP_PID E2E_CRM_PID
echo "=== FLUJO 1: WHATSPOWER → CRM ==="
node "$H/e2e-A.mjs" || true
echo "=== FLUJO 2: CRM → WHATSPOWER ==="
node "$H/e2e-B.mjs" || true
echo "=== REINICIO WP (B5 lo detuvo; C y D lo necesitan) ==="
cd "$REPO/WHATSPOWER"
PORT=3003 CRM_BASE_URL=http://localhost:3000 CRM_API_KEY="$E2E_CRM_KEY" AGENTIC_2A_WEBHOOK_SECRET="$E2E_WP_SECRET" INTERNAL_API_SECRET="$E2E_INT_SECRET" nohup node --experimental-strip-types src/server.ts >> "$E2E/logs/wp.log" 2>&1 &
WP_PID=$(echo $!)
for i in $(seq 1 15); do sleep 1; wcode=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/api/health || true); [ "$wcode" = "200" ] && break; done
echo "WP health=$wcode (pid $WP_PID)"
export E2E_WP_PID=$WP_PID
echo "=== FLUJO 3: ULTRA → DESPACHO ==="
node "$H/e2e-C.mjs" || true
echo "=== FLUJO 4: FALLOS Y RECUPERACIÓN ==="
node "$H/e2e-D.mjs" || true
echo "=== CAMPAÑA E2E COMPLETA ==="
