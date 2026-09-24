#!/bin/bash
# E2E: automatización con acción "wait" → pausa durable → reanudación por scheduler
set -e
BASE=http://localhost:3000/api

TOKEN=$(curl -s -X POST $BASE/auth/demo -H "Content-Type: application/json" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"

echo "── 1) Crear automatización: client_created → notify_admin → wait 1 min → ai_followup"
AUTO_ID=$(curl -s -X POST $BASE/automations -H "$AUTH" -H "Content-Type: application/json" -d '{
  "name": "E2E Bienvenida con pausa",
  "type": "custom",
  "triggerType": "client_created",
  "isActive": true,
  "actions": "[{\"type\":\"notify_admin\",\"config\":{\"title\":\"Nuevo cliente\",\"body\":\"Bienvenida a {{name}}\"}},{\"type\":\"wait\",\"config\":{\"days\":0,\"hours\":0,\"minutes\":1}},{\"type\":\"ai_followup\",\"config\":{\"instruction\":\"Redacta un saludo breve\"}}]"
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['automation']['id'])")
echo "   automation: $AUTO_ID"

echo "── 2) Disparar trigger (crear cliente vía demo: PATCH nicho no sirve; uso trigger manual con cliente existente)"
# El trigger client_created se dispara al crear un cliente; creamos uno por API
CLIENT_ID=$(curl -s -X POST $BASE/clients -H "$AUTH" -H "Content-Type: application/json" -d '{
  "name": "E2E Cliente Pausa", "phone": "+57 300 999 9999", "source": "manual"
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['client']['id'])")
echo "   cliente: $CLIENT_ID"
sleep 2

echo "── 3) Estado del run tras el trigger (debe estar waiting con resumeAt futuro)"
curl -s "$BASE/automations" -H "$AUTH" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d['automations']:
    if a['name'] == 'E2E Bienvenida con pausa':
        lr = a.get('lastRun')
        print('   status run:', lr['status'] if lr else 'SIN RUN')
        if lr:
            print('   resumeAt:', lr['resumeAt'])
            print('   steps:', [(s['type'], s['status']) for s in lr['steps']])
            print('   currentStep:', lr['currentStep'])
"

echo "── 4) Backdate resumeAt al pasado + ejecutar scheduler"
DATABASE_URL="file:/home/z/my-project/db/custom.db" bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
await db.automationRun.updateMany({ where: { status: 'waiting', automationId: '$AUTO_ID' }, data: { resumeAt: new Date(Date.now() - 5000) } })
await db.\$disconnect()
"
RES=$(curl -s -X POST $BASE/automations/run -H "$AUTH")
echo "   scheduler: $(echo $RES | head -c 120)"
sleep 2

echo "── 5) Verificación final (run debe estar success con los 3 pasos y runCount=1)"
curl -s "$BASE/automations" -H "$AUTH" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d['automations']:
    if a['name'] == 'E2E Bienvenida con pausa':
        lr = a.get('lastRun')
        print('   runCount:', a['runCount'], '| status:', lr['status'] if lr else '?')
        if lr:
            print('   steps:', [(s['type'], s['status'], s.get('ms')) for s in lr['steps']])
"

echo "── 6) Limpiar automatización de prueba"
curl -s -X DELETE "$BASE/automations/$AUTO_ID" -H "$AUTH" > /dev/null && echo "   eliminada $AUTO_ID"
echo "FIN OK"
