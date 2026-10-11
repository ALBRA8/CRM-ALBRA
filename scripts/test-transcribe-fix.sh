#!/bin/bash
# Test E2E del fix de transcripción: OGG/Opus (formato WhatsApp) → /api/whatsapp/transcribe
cd /home/z/my-project
set -e

echo "=== [1] Generar OGG/Opus de prueba (simula nota de voz de WhatsApp) ==="
# 2 segundos de tono: sin voz, pero formato EXACTO de WhatsApp (ogg/opus)
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=2" -c:a libopus -b:a 24k /tmp/test-voice.ogg
ls -la /tmp/test-voice.ogg
# Confirmar formato por magic bytes
head -c 4 /tmp/test-voice.ogg | xxd | head -1

echo ""
echo "=== [2] Llamar al endpoint REAL /api/whatsapp/transcribe (como hace el daemon) ==="
SECRET=$(grep INTERNAL_API_SECRET .env | cut -d'"' -f2)
B64=$(base64 -w0 /tmp/test-voice.ogg)
cat > /tmp/payload.json << EOF
{"audioBase64": "$B64", "mime": "audio/ogg; codecs=opus"}
EOF

echo "--- Respuesta del endpoint: ---"
curl -s --max-time 60 -X POST http://localhost:3000/api/whatsapp/transcribe \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $SECRET" \
  --data @/tmp/payload.json
echo ""

echo ""
echo "=== [3] Log reciente de Next.js (busca errores asr) ==="
tail -8 dev-verify.log
