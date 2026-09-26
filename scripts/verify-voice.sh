#!/bin/bash
# Verificación EN VIVO del pipeline de voz (Task 20):
# 1) TTS genera una "nota de voz" en español
# 2) Se envía por HTTP al endpoint interno /api/whatsapp/transcribe
#    (mismo camino que hará el daemon Baileys en producción)
# 3) Se imprime la transcripción devuelta
set -e
cd /home/z/my-project

PHRASE="Hola, buenos días. Quiero saber si tienen disponibilidad para una cita mañana en la tarde. Gracias."
AUDIO=/tmp/nota-voz-test.wav

echo "==> 1) Generando nota de voz con TTS..."
z-ai tts -i "$PHRASE" -o "$AUDIO" -f wav 2>&1 | tail -2
ls -la "$AUDIO"

echo "==> 2) Enviando al endpoint interno (como lo hace el daemon)..."
SECRET=$(grep INTERNAL_API_SECRET .env | cut -d'"' -f2)
B64=$(base64 -w0 "$AUDIO")
python3 -c "import json,sys; print(json.dumps({'audioBase64': sys.stdin.read().strip(), 'mime':'audio/wav'}))" <<< "$B64" > /tmp/voice-body.json

RESP=$(curl -s -X POST http://localhost:3000/api/whatsapp/transcribe \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $SECRET" \
  --max-time 120 \
  -d @/tmp/voice-body.json)

echo "==> 3) Respuesta del endpoint:"
echo "$RESP"
