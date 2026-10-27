#!/bin/bash
# FAIL-CLOSED EN FRÍO: gate de arranque del daemon sin INTERNAL_API_SECRET.
# Patrón "hold": retira .env atómicamente, lanza daemon, restaura y verifica integridad.
set -u
CRM=/home/z/repos-limpio/CRM-ALBRA
ENVF=$CRM/.env
BEFORE=$(sha256sum "$ENVF" | cut -d' ' -f1)

mv "$ENVF" "$ENVF.hold"
cd "$CRM"
timeout 20 node src/whatsapp-daemon/daemon.mjs > /home/z/my-project/scripts/logs/fc-daemon.log 2>&1
RC=$?
mv "$ENVF.hold" "$ENVF"
AFTER=$(sha256sum "$ENVF" | cut -d' ' -f1)

echo "exit_code=$RC (esperado 1)"
rg -o "INTERNAL_API_SECRET no configurado.*seguridad" /home/z/my-project/scripts/logs/fc-daemon.log | head -1
[ "$BEFORE" = "$AFTER" ] && echo ".env restaurado íntegro (sha256 OK)" || echo "ERROR: .env alterado"
echo "--- log fail-closed daemon ---"
head -4 /home/z/my-project/scripts/logs/fc-daemon.log
# El log no debe contener el valor del secreto (no existía) ni secretos de ningún tipo
rg -c "[0-9a-f]{40,}" /home/z/my-project/scripts/logs/fc-daemon.log || echo "0 secretos en log"
