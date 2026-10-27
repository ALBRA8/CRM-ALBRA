#!/bin/bash
# GO-LIVE CONTROLADO — arranque de servicios con secretos R2 (solo env de proceso).
# Sin teardown: el orquestador golive-run.sh lo hace al final de la batería.
set -u
LOGS=/home/z/my-project/scripts/logs
mkdir -p "$LOGS"

set -a; source /home/z/secure-rotation/secrets-r2.env; set +a
export INTERNAL_API_SECRET="$S_INTERNAL"

# limpieza de puertos objetivo (restos previos)
for port in 3002 3003 3100; do
  pids=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u)
  for p in $pids; do kill -9 "$p" 2>/dev/null; done
done
sleep 1

cd /home/z/repos-limpio/WHATSPOWER
nohup node --experimental-strip-types src/server.ts > "$LOGS/golive-wp.log" 2>&1 &
echo $! > "$LOGS/golive-wp.pid"

cd /home/z/repos-limpio/CRM-ALBRA
nohup node src/whatsapp-daemon/daemon.mjs > "$LOGS/golive-daemon.log" 2>&1 &
echo $! > "$LOGS/golive-daemon.pid"

nohup node_modules/.bin/next dev -p 3100 > "$LOGS/golive-crm.log" 2>&1 &
echo $! > "$LOGS/golive-crm.pid"

# espera de salud: WP/daemon 30s, CRM 120s
wp_ok=0; dm_ok=0; crm_ok=0
for i in $(seq 1 30); do
  [ $wp_ok = 0 ] && curl -sf http://localhost:3003/api/health >/dev/null 2>&1 && wp_ok=1
  [ $dm_ok = 0 ] && curl -sf -H "Authorization: Bearer $S_INTERNAL" http://localhost:3002/status >/dev/null 2>&1 && dm_ok=1
  [ $wp_ok = 1 ] && [ $dm_ok = 1 ] && break
  sleep 1
done
for i in $(seq 1 120); do
  curl -sf http://localhost:3100/api/health >/dev/null 2>&1 && { crm_ok=1; break; }
  sleep 1
done
echo "RESULTADO_ARRANQUE WP=$wp_ok DAEMON=$dm_ok CRM=$crm_ok"
[ "$wp_ok" = 1 ] && [ "$dm_ok" = 1 ] && [ "$crm_ok" = 1 ]
