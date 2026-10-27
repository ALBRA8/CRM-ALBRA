#!/bin/bash
# Teardown: detiene todos los servicios de prueba y borra credenciales sintéticas + BDs efímeras.
E2E=/home/z/my-project/albra-final/e2e
REPO=/home/z/my-project/albra-final
for f in crm daemon wp ultra stub; do
  [ -f "$E2E/$f.pid" ] && kill "$(cat "$E2E/$f.pid")" 2>/dev/null
done
for port in 3000 3002 3003 3004 3012; do
  pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
done
sleep 1
rm -f "$E2E/.e2e-creds.sh" "$E2E/crm-e2e.db" "$E2E"/stub-dispatches.jsonl* "$REPO/WHATSPOWER/db/operational.db" "$REPO/WHATSPOWER-ULTRA/db/broadcast.db"
rm -rf "$E2E/wa-session"
echo "teardown completo (servicios detenidos, credenciales sintéticas y BDs efímeras eliminadas)"
