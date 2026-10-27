#!/bin/bash
# ORQUESTADOR GO-LIVE CONTROLADO — verificación operativa + breakers + teardown.
# Secretos SOLO en env (jamás argv/URLs/logs). Sin mensajes reales, sin campañas.
set -u
LOGS=/home/z/my-project/scripts/logs
mkdir -p "$LOGS"
set -a; source /home/z/secure-rotation/secrets-r2.env; set +a
export INTERNAL_API_SECRET="$S_INTERNAL"

echo "════ 1) ARRANQUE DE SERVICIOS ════"
bash /home/z/my-project/scripts/golive-start.sh
START=$?
echo "arranque exit=$START"
[ $START = 0 ] || { echo "GO-LIVE: servicios no arrancaron"; exit 3; }

echo ""
echo "════ 2) BATERÍA OPERATIVA (health/auth/estados/persistencia) ════"
SMOKE_TOKEN=$(node --experimental-strip-types /home/z/my-project/scripts/smoke-admin-seed.mjs 2>/dev/null | tail -1)
export SMOKE_TOKEN
[ -n "$SMOKE_TOKEN" ] && echo "sesión admin emitida (oculta)" || echo "AVISO: sin sesión admin (G11-G13 fallarán)"
node --experimental-strip-types /home/z/my-project/scripts/golive-battery.mjs 2>&1 | grep -v "ExperimentalWarning\|MODULE_TYPELESS\|trace-warnings"
BATT=${PIPESTATUS[0]}

echo ""
echo "════ 3) BREAKERS EN FRÍO — ULTRA execute-pilot SIN secreto → exit(1) ════"
cd /home/z/repos-limpio/WHATSPOWER-ULTRA
set +e
env -u INTERNAL_API_SECRET node --experimental-strip-types src/execute-pilot-single-dispatch.ts \
  > "$LOGS/golive-ultra-cold.log" 2>&1
COLD=$?
set -e
echo "execute-pilot sin secreto exit=$COLD (esperado !=0, fail-closed)"
grep -o "DAEMON_SECRET[^.]*" "$LOGS/golive-ultra-cold.log" | head -1

echo ""
echo "════ 4) BREAKERS EN CÓDIGO — gates de campañas/despacho (sin ejecutar) ════"
echo "-- ULTRA pilot-config: authorized (debe ser false) --"
grep -n "authorized: false" /home/z/repos-limpio/WHATSPOWER-ULTRA/src/pilot-config.ts || echo "FALLO: authorized no está en false"
echo "-- ULTRA: gates env del despacho real --"
grep -rn "ALLOW_REAL_DISPATCH\|CONFIRMED_PILOT_EXECUTION" /home/z/repos-limpio/WHATSPOWER-ULTRA/src/ | grep -v "\.test\." | head -8
echo "-- CRM: AGENTIC_2A_ENABLED ausente del .env (exigido por safetyRequirements) --"
grep -c "AGENTIC_2A_ENABLED" /home/z/repos-limpio/CRM-ALBRA/.env 2>/dev/null || echo "0 (ausente, correcto)"
echo "-- daemon: fromMe ignorado (el bot no se responde a sí mismo) --"
grep -n "JAMÁS para mensajes del dueño" /home/z/repos-limpio/CRM-ALBRA/src/whatsapp-daemon/daemon.mjs | head -1

echo ""
echo "════ 5) BANDERA DE DESPACHO DEL DAEMON —Variable de despacho masivo inexistente en proceso ════"
ps eww $(cat "$LOGS/golive-daemon.pid") 2>/dev/null | tr ' ' '\n' | grep -c "ALLOW_REAL_DISPATCH" || echo "0 (daemon no tiene ALLOW_REAL_DISPATCH en su env; no aplica al daemon)"

echo ""
echo "════ 6) TEARDOWN — ventana cerrada, puertos libres ════"
for f in golive-wp golive-daemon golive-crm; do
  [ -f "$LOGS/$f.pid" ] && kill "$(cat $LOGS/$f.pid)" 2>/dev/null
done
sleep 1
for port in 3002 3003 3100; do
  pids=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u)
  for p in $pids; do kill -9 "$p" 2>/dev/null; done
done
for port in 3002 3003 3100; do
  ss -tlnp 2>/dev/null | grep -q ":$port " && echo "PUERTO $port AÚN OCUPADO" || echo "puerto $port libre"
done

echo ""
echo "════ 7) HIGIENE — 0 secretos en logs de la ventana ════"
LEAK=0
for v in "$S_INTERNAL" "$S_WEBHOOK" "${S_APPSECRET:-}" "${S_ENCKEY:-}" "${S_VERIFY:-}" "${SMOKE_TOKEN:-}"; do
  [ -n "$v" ] || continue
  for f in "$LOGS"/golive-*.log; do
    [ -f "$f" ] || continue
    grep -qF "$v" "$f" 2>/dev/null && { echo "FUGA en $f"; LEAK=1; }
  done
done
[ $LEAK = 0 ] && echo "0 fugas de secretos en logs"
echo ""
echo "FIN_GO_LIVE batería=$BATT arranque=$START cold=$COLD leaks=$LEAK"
