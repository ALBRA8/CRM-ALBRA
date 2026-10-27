#!/bin/bash
# Arranque de la ventana del operador: daemon :3002 + WP :3003 + CRM :3000.
# SIN teardown: los servicios quedan vivos para la conexión desde el dashboard.
set -u
LOGS=/home/z/my-project/scripts/logs
mkdir -p "$LOGS"
set -a; source /home/z/my-project/.env; set +a

kill_port() {
  local port="$1"
  local pids
  pids=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u)
  for p in $pids; do kill -9 "$p" 2>/dev/null; done
}

kill_port 3002; kill_port 3003
pkill -f "whatsapp-daemon/daemon.mjs" 2>/dev/null
sleep 1

echo "── daemon Baileys :3002 (copia my-project, env alineado) ──"
cd /home/z/my-project
nohup node src/whatsapp-daemon/daemon.mjs > "$LOGS/golive2-daemon.log" 2>&1 &
echo $! > "$LOGS/golive2-daemon.pid"

echo "── WHATSPOWER :3003 (repos, .env R2 canónico) ──"
cd /home/z/repos-limpio/WHATSPOWER
nohup node --experimental-strip-types src/server.ts > "$LOGS/golive2-wp.log" 2>&1 &
echo $! > "$LOGS/golive2-wp.pid"

echo "── CRM :3000 reinicio controlado (con secretos en env) ──"
kill_port 3000
pkill -f "bun run dev" 2>/dev/null
sleep 2
cd /home/z/my-project
nohup bun run dev > "$LOGS/golive2-crm.log" 2>&1 &
echo $! > "$LOGS/golive2-crm.pid"

echo "── espera de salud ──"
dm=0; wp=0; crm=0
for i in $(seq 1 30); do
  [ $dm = 0 ] && curl -sf -H "Authorization: Bearer $INTERNAL_API_SECRET" http://localhost:3002/status >/dev/null 2>&1 && dm=1
  [ $wp = 0 ] && curl -sf http://localhost:3003/api/health >/dev/null 2>&1 && wp=1
  [ $dm = 1 ] && [ $wp = 1 ] && break
  sleep 1
done
for i in $(seq 1 150); do
  curl -sf http://localhost:3000/api/health >/dev/null 2>&1 && { crm=1; break; }
  sleep 1
done
echo "RESULTADO_ARRANQUE WP=$wp DAEMON=$dm CRM=$crm"
