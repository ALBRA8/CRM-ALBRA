#!/bin/bash
# Pruebas end-to-end: knowledge CRUD + reemplazo de items de cotización
set -e
cd /home/z/my-project

warm() { for i in 1 2 3; do RES=$(curl -s "$@") && [ -n "$RES" ] && echo "$RES" && return 0; sleep 3; done; return 1; }

TOKEN=$(warm -X POST http://localhost:3000/api/auth/demo -H "Content-Type: application/json" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
echo "token OK"

echo "=== GET knowledge ==="
warm http://localhost:3000/api/knowledge -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f\"{len(d['knowledge'])} entradas: \" + ' | '.join(f\"{k['title']} ({k['category']})\" for k in d['knowledge']))"

echo ""
echo "=== POST knowledge nueva ==="
KID=$(warm -X POST http://localhost:3000/api/knowledge -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Horario de atención","content":"Lunes a viernes 9am-6pm. Sábados 9am-1pm. Respondemos WhatsApp en menos de 1 hora en horario laboral.","category":"general"}' | python3 -c "import json,sys; k=json.load(sys.stdin)['knowledge']; print(k['id'])")
echo "creada id=$KID"

echo ""
echo "=== PUT reemplazo de items de COT-0002 ==="
QID=$(warm http://localhost:3000/api/quotes -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print([q['id'] for q in json.load(sys.stdin)['quotes'] if q['number']=='COT-0002'][0])")
warm -X PUT http://localhost:3000/api/quotes/$QID -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"items":[{"sku":"NUEVO-A","description":"Linea reemplazada A","quantity":3,"unitPrice":50}],"discount":0}' | python3 -c "
import json,sys
q=json.load(sys.stdin)['quote']
print(f\"{q['number']} | subtotal={q['subtotal']} | total={q['total']} | items={[(i['sku'],i['quantity']) for i in q['items']]}\")"

echo ""
echo "=== DELETE knowledge de prueba ==="
curl -s -X DELETE http://localhost:3000/api/knowledge/$KID -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== limpieza COT-0002 ==="
curl -s -X DELETE http://localhost:3000/api/quotes/$QID -H "Authorization: Bearer $TOKEN"
echo ""
echo "LISTO"
