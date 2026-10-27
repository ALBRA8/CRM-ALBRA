#!/bin/bash
# ORQUESTADOR DE HUMO R2 — ventana de producción controlada.
# Secretos SOLO en env del proceso (jamás argv/URLs/logs). Sin despacho real.
set -u
LOGS=/home/z/my-project/scripts/logs
mkdir -p "$LOGS"

# Cargar secretos en env del proceso (no se imprimen)
set -a; source /home/z/secure-rotation/secrets-r2.env; set +a
export S_INTERNAL="$S_INTERNAL" S_WEBHOOK="$S_WEBHOOK"
export INTERNAL_API_SECRET="$S_INTERNAL"   # suites/bajas leen este nombre

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done
  sleep 1
  for port in 3002 3003 3100 3004; do
    pids_port=$(ss -tlnp 2>/dev/null | rg ":$port " | rg -o 'pid=[0-9]+' | rg -o '[0-9]+' | sort -u)
    for pp in $pids_port; do kill -9 "$pp" 2>/dev/null; done
  done
}
trap cleanup EXIT

echo "── arranque WHATSPOWER :3003 ──"
cd /home/z/repos-limpio/WHATSPOWER
node --experimental-strip-types src/server.ts > "$LOGS/smoke-wp.log" 2>&1 &
pids+=($!)

echo "── arranque daemon Baileys :3002 (desde CRM) ──"
cd /home/z/repos-limpio/CRM-ALBRA
node src/whatsapp-daemon/daemon.mjs > "$LOGS/smoke-daemon.log" 2>&1 &
pids+=($!)

echo "── arranque CRM :3100 (next dev) ──"
node_modules/.bin/next dev -p 3100 > "$LOGS/smoke-crm.log" 2>&1 &
pids+=($!)

echo "── espera de salud (WP/daemon hasta 25s, CRM hasta 120s) ──"
wp_ok=0; dm_ok=0; crm_ok=0
for i in $(seq 1 25); do
  [ $wp_ok = 0 ] && curl -sf http://localhost:3003/api/health >/dev/null 2>&1 && wp_ok=1
  [ $dm_ok = 0 ] && curl -sf -H "Authorization: Bearer $S_INTERNAL" http://localhost:3002/status >/dev/null 2>&1 && dm_ok=1
  [ $wp_ok = 1 ] && [ $dm_ok = 1 ] && break
  sleep 1
done
echo "WP=$wp_ok daemon=$dm_ok"
for i in $(seq 1 120); do
  curl -sf http://localhost:3100/api/health >/dev/null 2>&1 && { crm_ok=1; break; }
  sleep 1
done
echo "CRM=$crm_ok"
[ "$wp_ok" = 1 ] && [ "$dm_ok" = 1 ] && [ "$crm_ok" = 1 ] || { echo "BLOQUEO: servicios no arrancaron"; exit 3; }

echo "── seed sesión admin de humo (JWT firmado con APP_SECRET NUEVO) ──"
SMOKE_TOKEN=$(node --experimental-strip-types /home/z/my-project/scripts/smoke-admin-seed.mjs 2>/dev/null | tail -1)
export SMOKE_TOKEN
[ -n "$SMOKE_TOKEN" ] && echo "token de sesión emitido (oculto)" || { echo "BLOQUEO: no se pudo emitir sesión admin"; exit 4; }

echo "── batería principal ──"
node --experimental-strip-types /home/z/my-project/scripts/prod-smoke-battery.mjs 2>&1 | rg -v "ExperimentalWarning|MODULE_TYPELESS|trace-warnings"
BATT=${PIPESTATUS[0]}
echo "batería exit=$BATT"

echo "── suites ULTRA (env con NUEVO secreto) ──"
cd /home/z/repos-limpio/WHATSPOWER-ULTRA
npm test > "$LOGS/smoke-ultra-suite.log" 2>&1
echo "ULTRA npm test exit=$? (19/19 esperado)"
rg -o "^# (pass|fail) [0-9]+" "$LOGS/smoke-ultra-suite.log" | tail -2

echo "── bajas-circuit con WP vivo (:3003) y stub de auditoría ──"
node --experimental-strip-types --test tests/bajas-circuit.test.ts > "$LOGS/smoke-bajas.log" 2>&1
echo "bajas exit=$? (5/5 esperado)"
rg -o "^# (pass|fail) [0-9]+" "$LOGS/smoke-bajas.log" | tail -2

echo "── higiene: 0 secretos (nuevos y viejos) en logs ──"
LEAK=0
for v in "$S_INTERNAL" "$S_WEBHOOK" "${S_APPSECRET:-}" "${S_ENCKEY:-}" "${S_VERIFY:-}" "$SMOKE_TOKEN"; do
  for f in "$LOGS"/smoke-*.log "$LOGS"/fc-daemon.log; do
    [ -f "$f" ] || continue
    if grep -qF "$v" "$f" 2>/dev/null; then echo "FUGA detectada en $f"; LEAK=1; fi
  done
done
for f in "$LOGS"/smoke-wp.log "$LOGS"/smoke-daemon.log "$LOGS"/smoke-crm.log; do
  grep -qF "dev_secret_shared_albra_2a" "$f" 2>/dev/null && { echo "valor viejo impreso en $f"; LEAK=1; }
done
[ $LEAK = 0 ] && echo "0 fugas de secretos en logs"

echo "── fin de batería (teardown en EXIT) ──"
exit $BATT
