#!/bin/bash
# Verificación de la cadena del operador: login demo → daemon-proxy → daemon.
# Token de sesión jamás impreso.
set -u
set -a; source /home/z/my-project/.env; set +a

echo "CRM /api/health:        HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)"
echo "WP  /api/health:        HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3003/api/health)"
echo "daemon sin auth:        HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/status)"
echo "daemon con auth:        HTTP $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $INTERNAL_API_SECRET" http://localhost:3002/status)"

TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/demo \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.token||'')}catch(e){console.log('')}})")

if [ -n "$TOKEN" ]; then
  echo "POST /api/auth/demo:    OK (token emitido, oculto)"
  echo "daemon-proxy con sesión demo:"
  curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/api/whatsapp/daemon-proxy?path=/status'
  echo ""
else
  echo "POST /api/auth/demo:    FALLO"
  curl -s -X POST http://localhost:3000/api/auth/demo | head -c 300
  echo ""
fi
