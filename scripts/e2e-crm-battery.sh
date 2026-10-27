#!/bin/bash
# E2E-ALBRA-2026-10-27 — Batería funcional CRM-ALBRA (SOLO PRUEBA, no modifica código)
BASE=http://localhost:3000
TAG="E2E-ALBRA-2026-10-27"
OUT=/home/z/my-project/scripts/e2e-results-crm.txt
: > "$OUT"
log(){ echo "[$(date -u +%FT%TZ)] $*" | tee -a "$OUT"; }

# 1. AUTH
log "=== T2.1 AUTH demo ==="
TOKEN=$(curl -s -X POST $BASE/api/auth/demo | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then log "PASS auth/demo: token emitido (${#TOKEN} chars)"; else log "FAIL auth/demo: sin token"; exit 1; fi
AH="Authorization: Bearer $TOKEN"

# 2. READ clientes
log "=== T2.2 GET /api/clients ==="
CODE=$(curl -s -o /tmp/cl.json -w "%{http_code}" -H "$AH" "$BASE/api/clients")
N=$(python3 -c "import json;d=json.load(open('/tmp/cl.json'));print(len(d.get('clients',d) if isinstance(d,dict) else d))" 2>/dev/null)
log "HTTP $CODE — clientes: $N"

# 3. CREATE cliente E2E
log "=== T2.3 POST /api/clients (crear $TAG-cliente) ==="
CODE=$(curl -s -o /tmp/clnew.json -w "%{http_code}" -X POST $BASE/api/clients -H "$AH" -H "Content-Type: application/json" \
  -d "{\"name\":\"$TAG Cliente Prueba\",\"phone\":\"+573000000001\",\"email\":\"e2e@test.invalid\",\"notes\":\"Dato ficticio de prueba integral\",\"source\":\"manual\"}")
CLIENT_ID=$(python3 -c "import json;d=json.load(open('/tmp/clnew.json'));print(d.get('client',d).get('id',''))" 2>/dev/null)
log "HTTP $CODE — clientId: $CLIENT_ID"

# 4. READ cliente individual
if [ -n "$CLIENT_ID" ]; then
  log "=== T2.4 GET /api/clients/$CLIENT_ID ==="
  CODE=$(curl -s -o /tmp/cl1.json -w "%{http_code}" -H "$AH" "$BASE/api/clients/$CLIENT_ID")
  NAME=$(python3 -c "import json;d=json.load(open('/tmp/cl1.json'));print(d.get('client',d).get('name','?'))" 2>/dev/null)
  log "HTTP $CODE — name: $NAME"
fi

# 5. CREATE oportunidad
log "=== T2.5 POST /api/opportunities ==="
CODE=$(curl -s -o /tmp/opp.json -w "%{http_code}" -X POST $BASE/api/opportunities -H "$AH" -H "Content-Type: application/json" \
  -d "{\"title\":\"$TAG Oportunidad Prueba\",\"clientId\":\"$CLIENT_ID\",\"value\":500000}")
OPP_ID=$(python3 -c "import json;d=json.load(open('/tmp/opp.json'));print(d.get('opportunity',d).get('id',''))" 2>/dev/null)
log "HTTP $CODE — opportunityId: $OPP_ID"

# 6. READ oportunidades
log "=== T2.6 GET /api/opportunities ==="
CODE=$(curl -s -o /tmp/opps.json -w "%{http_code}" -H "$AH" "$BASE/api/opportunities")
log "HTTP $CODE"

# 7. PIPELINE
log "=== T2.7 GET /api/pipeline ==="
CODE=$(curl -s -o /tmp/pipe.json -w "%{http_code}" -H "$AH" "$BASE/api/pipeline")
STAGES=$(python3 -c "import json;d=json.load(open('/tmp/pipe.json'));print(len(d.get('stages',[])))" 2>/dev/null)
log "HTTP $CODE — etapas: $STAGES"

# 8. TIMELINE
log "=== T2.8 GET /api/timeline ==="
CODE=$(curl -s -o /tmp/tl.json -w "%{http_code}" -H "$AH" "$BASE/api/timeline")
log "HTTP $CODE"

# 9. CRM ACTIONS
log "=== T2.9 GET /api/crm/actions ==="
CODE=$(curl -s -o /tmp/act.json -w "%{http_code}" -H "$AH" "$BASE/api/crm/actions")
log "HTTP $CODE — $(head -c 150 /tmp/act.json)"

# 10. MCP
log "=== T2.10 GET /api/mcp ==="
CODE=$(curl -s -o /tmp/mcp.json -w "%{http_code}" -H "$AH" "$BASE/api/mcp")
log "HTTP $CODE — $(head -c 200 /tmp/mcp.json)"

# 11. BRIDGE status (seed probablemente abajo)
log "=== T2.11 GET /api/agent-general/status (bridge) ==="
CODE=$(curl -s -o /tmp/ag.json -w "%{http_code}" -H "$AH" "$BASE/api/agent-general/status")
log "HTTP $CODE — $(head -c 250 /tmp/ag.json)"

log "=== FIN batería CRM ==="
echo "$TOKEN" > /home/z/my-project/scripts/e2e-token.txt
