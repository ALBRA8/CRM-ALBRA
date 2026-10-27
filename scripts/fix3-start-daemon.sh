#!/bin/bash
# Arranque del daemon :3002 con el FIX BARRERA 3 (GO operador 2026-10-28).
# Patrón probado que sobrevive al sandbox: script arranca con nohup y sale;
# el daemon queda huérfano (ppid=1). Sin teardown. Secretos jamás impresos.
set -u
LOGS=/home/z/my-project/scripts/logs
mkdir -p "$LOGS"

# limpia restos en 3002
for p in $(ss -tlnp 2>/dev/null | grep ':3002 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do
  kill -9 "$p" 2>/dev/null
done
sleep 1

cd /home/z/my-project
nohup node src/whatsapp-daemon/daemon.mjs > "$LOGS/fix3-daemon.log" 2>&1 &
echo $! > "$LOGS/fix3-daemon.pid"

# espera de salud (máx 40s)
ok=0
for i in $(seq 1 40); do
  if set -a; source /home/z/my-project/.env; set +a; curl -sf -m 3 -H "Authorization: Bearer $INTERNAL_API_SECRET" http://localhost:3002/status >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 1
done
echo "RESULTADO_ARRANQUE_DAEMON ok=$ok pid=$(cat "$LOGS/fix3-daemon.pid")"
