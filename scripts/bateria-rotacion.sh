#!/bin/bash
# ============================================================================
# PRO-02 — Rotación controlada de INTERNAL_API_SECRET — Batería sandbox
# 4 procesos: CRM(:3000), daemon Baileys(:3002), WHATSPOWER(:3005), ULTRA(stub :3012)
# Cero mensajes reales. Evidencia sanitizada (sin valores de secretos).
# ============================================================================
set -u
R=/home/z/secure-rotation
LOGS=$R/logs
EV=/home/z/my-project/download/PRO-01-PRO-02-EVIDENCIA
RES=$EV/bateria-rotacion.txt
mkdir -p "$LOGS" "$EV"
NEW=$(cat $R/NEW_INTERNAL_API_SECRET.txt)
OLD=$(cat $R/OLD_INTERNAL_API_SECRET.txt)
# CP-Sec-01: los valores históricamente publicados NO se versionan — se exigen del entorno.
# Se usan solo como pruebas NEGATIVAS (verificar que el sistema los rechaza con 401).
FALLBACK="${FALLBACK_SECRET:-}"
DEVSECRET="${DEV_SHARED_HMAC_SECRET:-}"
if [ -z "$FALLBACK" ] || [ -z "$DEVSECRET" ]; then
  echo "✋ Faltan FALLBACK_SECRET y/o DEV_SHARED_HMAC_SECRET en el entorno." >&2
  echo "   Son los valores publicados que la batería debe verificar como RECHAZADOS (401)." >&2
  exit 1
fi
WPNEW=$(cat $R/NEW_WHATSPOWER_WEBHOOK_SECRET.txt)
PASS=0; FAIL=0
log(){ echo "$1" | tee -a "$RES"; }
chk(){ # chk "nombre" "esperado" "obtenido"
  local name="$1" exp="$2" got="$3"
  if [ "$exp" = "$got" ]; then log "PASS | $name | esperado=$exp obtenido=$got"; PASS=$((PASS+1));
  else log "FAIL | $name | esperado=$exp obtenido=$got"; FAIL=$((FAIL+1)); fi
}
rm -f "$RES"

log "=============================================================="
log "BATERIA DE ROTACION INTERNAL_API_SECRET — $(date -u +%FT%TZ)"
log "Procesos: CRM, daemon, WHATSPOWER, ULTRA (sandbox, 0 envios reales)"
log "=============================================================="

# ---- F0: detener instancias viejas (PIDs identificados, controlados) ----
log "--- F0: detencion de instancias previas con secreto viejo ---"
for P in $(ss -tlnp 2>/dev/null | grep -oE ':(3000|3002)\s.*pid=[0-9]+' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
  if kill "$P" 2>/dev/null; then log "F0 | proceso previo detenido pid=$P"; fi
done
sleep 2
kill -9 $(ss -tlnp 2>/dev/null | grep -E ':(3000|3002)\s' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u) 2>/dev/null
sleep 1
if ss -tln | grep -qE ':(3000|3002)\s'; then log "FAIL | F0 puertos 3000/3002 aun ocupados"; FAIL=$((FAIL+1)); else log "PASS | F0 puertos 3000/3002 liberados"; PASS=$((PASS+1)); fi

# ---- F0b: resolver dependencias del daemon en clone limpio (symlinks al volumen) ----
log "--- F0b: dependencias del daemon en clone (symlinks) ---"
CNM=/home/z/repos-limpio/CRM-ALBRA/node_modules
rm -rf $CNM/@hapi $CNM/@whiskeysockets 2>/dev/null
mkdir -p $CNM/@hapi $CNM/@whiskeysockets
ln -sfn /home/z/my-project/node_modules/@hapi/boom $CNM/@hapi/boom
ln -sfn /home/z/my-project/node_modules/@whiskeysockets/baileys $CNM/@whiskeysockets/baileys
for PKG in qrcode qrcode-terminal better-sqlite3; do ln -sfn "/home/z/my-project/node_modules/$PKG" "$CNM/$PKG"; done
log "F0b | symlinks listos: $(ls $CNM | tr '\n' ' ')"

# ---- F1: daemon fail-closed sin secreto (no arranca) ----
log "--- F1: daemon fail-closed sin INTERNAL_API_SECRET ---"
cd /home/z/repos-limpio/CRM-ALBRA
timeout 10 env -u INTERNAL_API_SECRET node src/whatsapp-daemon/daemon.mjs > $LOGS/f1-daemon-failclosed.log 2>&1
E1=$?
if [ $E1 -eq 1 ]; then log "PASS | F1 daemon exit(1) sin secreto (fail-closed)"; PASS=$((PASS+1)); else log "FAIL | F1 daemon exit=$E1 (se esperaba 1)"; FAIL=$((FAIL+1)); fi
if grep -q "no arranca por seguridad" $LOGS/f1-daemon-failclosed.log 2>/dev/null; then log "PASS | F1 mensaje de seguridad presente en log"; PASS=$((PASS+1)); else log "FAIL | F1 mensaje de seguridad ausente"; FAIL=$((FAIL+1)); fi

# ---- F2: daemon arranca con NUEVO; NUEVO acepta, VIEJO/FALLBACK/ausente rechazan ----
log "--- F2: daemon con secreto NUEVO (:3002) ---"
cd /home/z/repos-limpio/CRM-ALBRA
env INTERNAL_API_SECRET="$NEW" WHATSAPP_DAEMON_PORT=3002 node src/whatsapp-daemon/daemon.mjs > $LOGS/f2-daemon-nuevo.log 2>&1 &
DPID=$!
OK2=0
for i in $(seq 1 20); do
  C=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NEW" http://localhost:3002/status 2>/dev/null)
  [ "$C" = "200" ] && OK2=1 && break
  sleep 1
done
chk "F2.1 daemon /status con NUEVO" "200" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $OLD" http://localhost:3002/status 2>/dev/null); chk "F2.2 daemon /status con VIEJO" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $FALLBACK" http://localhost:3002/status 2>/dev/null); chk "F2.3 daemon /status con valor publicado(fallback)" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/status 2>/dev/null); chk "F2.4 daemon /status sin auth" "401" "$C"

# ---- F3: CRM con NUEVO + BD copia; X-Internal-Secret en handoff ----
log "--- F3: CRM con secreto NUEVO (:3000, BD copia) ---"
cd /home/z/my-project
DATABASE_URL="file:/home/z/secure-rotation/db-copia/custom.db" INTERNAL_API_SECRET="$NEW" npx next dev -p 3000 > $LOGS/f3-crm-nuevo.log 2>&1 &
CPID=$!
C3=000
for i in $(seq 1 90); do
  C3=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
  [ "$C3" = "200" ] && break
  sleep 1
done
chk "F3.0 CRM responde en :3000" "200" "$C3"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/whatsapp/handoff -H "Content-Type: application/json" -H "X-Internal-Secret: $NEW" -d '{}' 2>/dev/null)
if [ "$C" != "401" ]; then log "PASS | F3.1 handoff X-Internal-Secret NUEVO (no-401, auth OK) | obtenido=$C"; PASS=$((PASS+1)); else log "FAIL | F3.1 handoff NUEVO=401 (deberia pasar auth)"; FAIL=$((FAIL+1)); fi
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/whatsapp/handoff -H "Content-Type: application/json" -H "X-Internal-Secret: $OLD" -d '{}' 2>/dev/null); chk "F3.2 handoff X-Internal-Secret VIEJO" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/whatsapp/handoff -H "Content-Type: application/json" -H "X-Internal-Secret: $FALLBACK" -d '{}' 2>/dev/null); chk "F3.3 handoff X-Internal-Secret valor publicado" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/whatsapp/handoff -H "Content-Type: application/json" -d '{}' 2>/dev/null); chk "F3.4 handoff sin header" "401" "$C"

log "--- F4: WHATSPOWER parcheado con NUEVO (:3005) ---"
cd /home/z/repos-limpio/WHATSPOWER
PORT=3005 INTERNAL_API_SECRET="$NEW" AGENTIC_2A_WEBHOOK_SECRET="$WPNEW" node --experimental-strip-types src/server.ts > $LOGS/f4-wp-nuevo.log 2>&1 &
WPID=$!
C4=000
for i in $(seq 1 30); do
  C4=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/api/health 2>/dev/null)
  [ "$C4" = "200" ] && break
  sleep 1
done
chk "F4.0 WHATSPOWER /api/health" "200" "$C4"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3005/api/internal/suppression/573999888777 -H "Authorization: Bearer $NEW" 2>/dev/null); chk "F4.1 suppression POST con NUEVO" "200" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3005/api/internal/suppression/573999888777 -H "Authorization: Bearer $OLD" 2>/dev/null); chk "F4.2 suppression POST con VIEJO" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3005/api/internal/suppression/573999888777 -H "Authorization: Bearer $FALLBACK" 2>/dev/null); chk "F4.3 suppression POST con valor publicado" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3005/api/internal/suppression/573999888777 2>/dev/null); chk "F4.4 suppression POST sin auth" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:3005/api/internal/suppression/573999888777 -H "Authorization: Bearer $NEW" 2>/dev/null); chk "F4.5 suppression DELETE con NUEVO (limpieza)" "200" "$C"

# F4.6 inbound firmado con NUEVO webhook secret (HMAC) — transport Mock, 0 envios
BODY='{"eventId":"rot-evid-001","orgId":"org-rotacion-pro02","contact":{"phone":"573000000001"},"message":{"text":"prueba rotacion PRO-02"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WPNEW" -hex | awk '{print $NF}')
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3005/api/inbound -H "Content-Type: application/json" -H "X-Signature-SHA256: $SIG" -d "$BODY" 2>/dev/null)
chk "F4.6 inbound HMAC firmado con NUEVO" "200" "$C"
SIGDEV=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$DEVSECRET" -hex | awk '{print $NF}')
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3005/api/inbound -H "Content-Type: application/json" -H "X-Signature-SHA256: $SIGDEV" -d "$BODY" 2>/dev/null)
chk "F4.7 inbound HMAC con valor dev publicado (fallback eliminado)" "401" "$C"

log "--- F5: ULTRA — dispatcher y fail-closed ---"
# 5a execute-pilot fail-closed sin env
cd /home/z/repos-limpio/WHATSPOWER-ULTRA
timeout 10 env -u INTERNAL_API_SECRET node --experimental-strip-types src/execute-pilot-single-dispatch.ts > $LOGS/f5a-pilot-failclosed.log 2>&1
E5=$?
if [ $E5 -eq 1 ]; then log "PASS | F5.1 execute-pilot exit(1) sin secreto (fail-closed)"; PASS=$((PASS+1)); else log "FAIL | F5.1 execute-pilot exit=$E1"; FAIL=$((FAIL+1)); fi

# 5b dispatcher vs stub fiel :3012
mkdir -p /home/z/my-project/download/e2e-postpub
cd /home/z/my-project
STUB_SECRET="$NEW" node scripts/stub-daemon.mjs > $LOGS/f5b-stub.log 2>&1 &
SPID=$!
sleep 1
INTERNAL_API_SECRET="$NEW" node --experimental-strip-types $R/dispatcher-rotacion-test.ts > $LOGS/f5b-dispatcher.log 2>&1
E5B=$?
if [ $E5B -eq 0 ] && grep -q "TODOS-PASS" $LOGS/f5b-dispatcher.log 2>/dev/null; then log "PASS | F5.2 dispatcher: NUEVO exitoso / VIEJO y FALLBACK 401"; PASS=$((PASS+1)); else log "FAIL | F5.2 dispatcher (ver f5b-dispatcher.log)"; FAIL=$((FAIL+1)); fi

log "--- F6: WHATSPOWER sin ningun secret (fail-closed total) ---"
cd /home/z/repos-limpio/WHATSPOWER
PORT=3006 env -u INTERNAL_API_SECRET -u AGENTIC_2A_WEBHOOK_SECRET -u WEBHOOK_SECRET node --experimental-strip-types src/server.ts > $LOGS/f6-wp-failclosed.log 2>&1 &
WP2ID=$!
sleep 3
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3006/api/inbound -H "Content-Type: application/json" -H "X-Signature-SHA256: $SIGDEV" -d "$BODY" 2>/dev/null)
chk "F6.1 inbound sin secret en server + firma dev" "401" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3006/qr/data 2>/dev/null)
chk "F6.2 /qr/data sin INTERNAL_API_SECRET (503 fail-closed)" "503" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3006/api/internal/suppression/573999888777 -H "Authorization: Bearer $FALLBACK" 2>/dev/null)
chk "F6.3 suppression sin secret en server + valor publicado" "401" "$C"

log "--- F7: limpieza controlada de procesos ---"
kill $DPID $CPID $WPID $WP2ID $SPID 2>/dev/null
sleep 2
for P in $DPID $CPID $WPID $WP2ID $SPID; do kill -9 $P 2>/dev/null; done
# matar tambien workers que sobreviven al padre (next-server, etc.) por puerto
for PORT in 3000 3002 3005 3006 3012; do
  for P in $(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill -9 $P 2>/dev/null; done
done
sleep 1
REMAIN=0
for PORT in 3000 3002 3005 3006 3012; do ss -tln | grep -q ":$PORT " && REMAIN=$((REMAIN+1)); done
if [ $REMAIN -eq 0 ]; then log "PASS | F7 todos los procesos de prueba detenidos"; PASS=$((PASS+1)); else log "FAIL | F7 $REMAIN puertos aun ocupados"; FAIL=$((FAIL+1)); fi

log "=============================================================="
log "RESULTADO: PASS=$PASS FAIL=$FAIL"
log "=============================================================="
if [ $FAIL -eq 0 ]; then echo "ROTACION-VERIFICADA" > $EV/RESULTADO-BATERIA.txt; else echo "ROTACION-CON-FALLOS" > $EV/RESULTADO-BATERIA.txt; fi
exit $FAIL
