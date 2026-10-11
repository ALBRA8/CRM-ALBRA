#!/usr/bin/env bash
# ============================================================
# Smoke E2E del Servidor MCP de CRM ALBRA (Task 27)
# 1) Login demo → token
# 2) Crea 2 API keys vía /api/settings/api-keys
# 3) initialize → tools/list → tools/call (list_clients, create_client,
#    get_client, get_dashboard_stats, send_whatsapp con daemon caído)
# 4) Revoca una clave → verifica 401 inmediato
# Requiere: dev server en :3000. Uso: bash scripts/mcp-smoke.sh
# ============================================================
set -euo pipefail
BASE="http://localhost:3000"

say() { echo -e "\n\033[1;36m== $1 ==\033[0m"; }

say "1) Login demo"
LOGIN=$(curl -s -X POST "$BASE/api/auth/demo")
TOKEN=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token||'')" "$LOGIN")
if [ -z "$TOKEN" ]; then echo "FALLO login: $LOGIN"; exit 1; fi
echo "token OK (${#TOKEN} chars)"

say "2) Crear API keys (Claude Desktop + smoke-test)"
KEYS=$(curl -s -X POST "$BASE/api/settings/api-keys" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Claude Desktop (smoke)"}')
SECRET=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).secret||'')" "$KEYS")
[ -n "$SECRET" ] || { echo "FALLO creando clave: $KEYS"; exit 1; }
KEY2=$(curl -s -X POST "$BASE/api/settings/api-keys" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"smoke-test (se revoca)"}')
SECRET2=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).secret||'')" "$KEY2")
KEY2_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).apiKey.id||'')" "$KEY2")
echo "clave activa: ${SECRET:0:12}…  | clave a revocar: ${SECRET2:0:12}…"

say "3a) initialize"
curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"smoke","version":"0"}}}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result;console.log('protocolVersion:',r.protocolVersion,'| server:',r.serverInfo.name,r.serverInfo.version)})"

say "3b) notifications/initialized → 202"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')
echo "HTTP $CODE (esperado 202)"

say "3c) tools/list"
curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).result.tools;console.log('tools:',t.length,'→',t.map(x=>x.name).join(', '))})"

say "3d) tools/call list_clients"
curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_clients","arguments":{"limit":5}}}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result;const c=r.structuredContent.clients;console.log('isError:',r.isError,'| clientes:',c.length,'| primero:',c[0]?c[0].name:'(ninguno)')})"

say "3e) tools/call create_client + get_client (round-trip)"
CREATED=$(curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_client","arguments":{"name":"Cliente MCP E2E","phone":"+57 320 999 8877","email":"mcp-e2e@test.albra"}}}')
CID=$(node -e "process.stdout.write((JSON.parse(process.argv[1]).result.structuredContent.client||{}).id||'')" "$CREATED")
echo "creado clientId=$CID"
curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_client\",\"arguments\":{\"clientId\":\"$CID\"}}}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result;console.log('get_client:',r.structuredContent.client.name,'| timeline events:',r.structuredContent.timeline.length)})"

say "3f) tools/call get_dashboard_stats"
curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_dashboard_stats","arguments":{}}}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log('stats:',JSON.stringify(JSON.parse(d).result.structuredContent))})"

say "3g) tools/call send_whatsapp (daemon esperando QR → error honesto esperado)"
curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"send_whatsapp","arguments":{"phone":"+573209998877","text":"Hola desde MCP"}}}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result;console.log('isError:',r.isError,'|',r.content[0].text.slice(0,120))})"

say "4) Revocar clave smoke → 401 inmediato"
curl -s -X DELETE "$BASE/api/settings/api-keys/$KEY2_ID" -H "Authorization: Bearer $TOKEN" > /dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/mcp" -H "Authorization: Bearer $SECRET2" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')
echo "clave revocada → HTTP $CODE (esperado 401)"

say "5) Sin auth → 401"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')
echo "sin Authorization → HTTP $CODE (esperado 401)"

say "SMOKE COMPLETO"
