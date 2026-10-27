#!/bin/bash
# E2E-ALBRA-2026-10-27 — Batería de errores controlados (solo observa)
BASE=http://localhost:3000
SEED=http://localhost:9000
KEY=$(cat /home/z/my-project/scripts/e2e-apikey.txt)
TOKEN=$(cat /home/z/my-project/scripts/e2e-token.txt)
OUT=/home/z/my-project/scripts/e2e-results-errors.txt
: > "$OUT"
log(){ echo "[$(date -u +%FT%TZ)] $*" | tee -a "$OUT"; }

log "=== A. CREDENCIAL INVÁLIDA ==="
log "A1 CRM login demo-password mala:"
curl -s -o /tmp/e1.json -w "  HTTP %{http_code} — " -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"email":"demo@crmalbra.com","password":"E2E-password-erronea"}' 2>/dev/null; head -c 120 /tmp/e1.json | tee -a "$OUT"; echo | tee -a "$OUT"
log "A2 MCP con API key falsa:"
curl -s -o /tmp/e2.json -w "  HTTP %{http_code} — " -X POST $BASE/api/mcp -H "Authorization: Bearer albra_FAKEE2E000000000" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'; head -c 120 /tmp/e2.json | tee -a "$OUT"; echo | tee -a "$OUT"
log "A3 Seed con token falso:"
curl -s -o /tmp/e3.json -w "  HTTP %{http_code} — " -X POST $SEED/api/v1/execution -H "Authorization: Bearer token-E2E-falso" -H "Content-Type: application/json" -d '{"input":"x"}'; head -c 100 /tmp/e3.json | tee -a "$OUT"; echo | tee -a "$OUT"

log "=== B. ENDPOINT INEXISTENTE ==="
log "B1 CRM /api/no-existe:"
curl -s -o /tmp/e4.json -w "  HTTP %{http_code}\n" $BASE/api/no-existe | tee -a "$OUT"
log "B2 Seed /api/v1/no-existe:"
curl -s -o /tmp/e5.json -w "  HTTP %{http_code}\n" $SEED/api/v1/no-existe | tee -a "$OUT"
log "B3 MCP tool inexistente:"
curl -s -o /tmp/e6.json -w "  HTTP %{http_code} — " -X POST $BASE/api/mcp -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"herramienta_fantasma","arguments":{}}}'; head -c 150 /tmp/e6.json | tee -a "$OUT"; echo | tee -a "$OUT"

log "=== C. PAYLOAD INVÁLIDO ==="
log "C1 CRM cliente sin name:"
curl -s -o /tmp/e7.json -w "  HTTP %{http_code} — " -X POST $BASE/api/clients -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"phone":"+573000000009"}'; head -c 140 /tmp/e7.json | tee -a "$OUT"; echo | tee -a "$OUT"
log "C2 crm-actions acción desconocida:"
curl -s -o /tmp/e8.json -w "  HTTP %{http_code} — " -X POST $BASE/api/crm/actions -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"action":"borrar_todo","params":{}}'; head -c 140 /tmp/e8.json | tee -a "$OUT"; echo | tee -a "$OUT"
log "C3 Seed execution body inválido:"
curl -s -o /tmp/e9.json -w "  HTTP %{http_code} — " -X POST $SEED/api/v1/execution -H "Authorization: Bearer albra-dev-token" -H "Content-Type: application/json" -d 'esto no es json'; head -c 140 /tmp/e9.json | tee -a "$OUT"; echo | tee -a "$OUT"

log "=== D. SERVICIO NO DISPONIBLE (bridge con seed caído) ==="
# mata seed temporalmente y consulta el bridge
SEEDPID=$(ss -tlnp 2>/dev/null | rg 9000 -r '$1' | rg -o 'pid=([0-9]+)' -r '$1' | head -1)
if [ -n "$SEEDPID" ]; then
  kill $SEEDPID 2>/dev/null; sleep 2
  log "D1 seed detenido (pid $SEEDPID) → bridge:"
  curl -s -o /tmp/e10.json -w "  HTTP %{http_code} — " -H "Authorization: Bearer $TOKEN" "$BASE/api/agent-general/status?refresh=true"; head -c 220 /tmp/e10.json | tee -a "$OUT"; echo | tee -a "$OUT"
  log "D2 auto-reply con seed caído (debe degradar a LLM local o fallar controlado):"
  SECRET=$(rg "^INTERNAL_API_SECRET=" /home/z/my-project/.env | cut -d= -f2 | tr -d '"')
  curl -s -o /tmp/e11.json -w "  HTTP %{http_code} — " -X POST $BASE/api/whatsapp/auto-reply -H "X-Internal-Secret: $SECRET" -H "Content-Type: application/json" -d '{"message":"E2E-ALBRA-2026-10-27 prueba seed caido","clientId":"cmvq038pp003gp5vzpbp02hxb"}'; python3 -c "import json;d=json.load(open('/tmp/e11.json'));print('engine:',d.get('engine'),'| reply len:',len(d.get('reply','') or ''))" 2>/dev/null | tee -a "$OUT"
  # reinicia seed
  cd /home/z/repos/AGENTE-GENERAL && APP_ENV=dev setsid -f /home/z/venvs/albra-seed/bin/python -m uvicorn render_app:app --host 0.0.0.0 --port 9000 >> /home/z/my-project/scripts/e2e-seed.log 2>&1
  sleep 6
  log "D3 seed reiniciado → bridge:"
  curl -s -o /tmp/e12.json -w "  HTTP %{http_code} — " -H "Authorization: Bearer $TOKEN" "$BASE/api/agent-general/status?refresh=true"; head -c 180 /tmp/e12.json | tee -a "$OUT"; echo | tee -a "$OUT"
fi

log "=== E. HMAC INVÁLIDO (LEADS→CRM) ==="
log "E1 webhook con firma HMAC inválida → CRM (no existe receptor; auth rechaza antes):"
curl -s -o /tmp/e13.json -w "  HTTP %{http_code} — " -X POST $BASE/api/clients -H "Content-Type: application/json" -H "X-Signature: sha256=deadbeef" -H "X-Albra-Event: lead.created" -d '{"type":"lead.created","payload":{}}'; head -c 120 /tmp/e13.json | tee -a "$OUT"; echo | tee -a "$OUT"

log "=== F. TIMEOUT (bridge con host colgado) ==="
# listener que acepta y nunca responde en 9999
python3 -c "
import socket,threading,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',9999)); s.listen(5)
def hang():
    while True:
        try: c,_=s.accept(); time.sleep(30)
        except: break
threading.Thread(target=hang,daemon=True).start(); time.sleep(25)
" &
sleep 1
cd /home/z/my-project && ALBRA_AGENT_URL=http://127.0.0.1:9999 timeout 30 node --import tsx -e "
const t0=Date.now();
import('./src/lib/albra-agent-bridge.ts').then(async (m)=>{
  const r=await m.checkAgentHealth(true);
  console.log('bridge health con host colgado →', JSON.stringify({online:r.online, error:(r.error||'').slice(0,60), ms:Date.now()-t0}));
  process.exit(0);
});" 2>&1 | tail -1 | tee -a "$OUT"

log "=== FIN BATERÍA ERRORES ==="
