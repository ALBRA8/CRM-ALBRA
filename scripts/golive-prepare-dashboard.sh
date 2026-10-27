#!/bin/bash
# Preparación dashboard operador: alinear .env del CRM sandbox con secretos canónicos R2
# (sin imprimir valores) + reset de contraseña demo (mecanismo existente del dueño).
set -eu
ENVF=/home/z/my-project/.env

# seguridad de escritura: valores sin caracteres especiales
if grep -E '^S_(INTERNAL|WEBHOOK)=' /home/z/secure-rotation/secrets-r2.env | grep -qE '["\\#]'; then
  echo "BLOQUEO: caracteres especiales en secretos, abortando"
  exit 2
fi

add_kv() { local k="$1" v="$2"; if grep -qE "^${k}=" "$ENVF"; then echo "ya presente: $k"; else echo "${k}=\"${v}\"" >> "$ENVF"; echo "añadido: $k"; fi; }

S_INTERNAL_VAL=$(grep '^S_INTERNAL=' /home/z/secure-rotation/secrets-r2.env | cut -d= -f2-)
S_WEBHOOK_VAL=$(grep '^S_WEBHOOK=' /home/z/secure-rotation/secrets-r2.env | cut -d= -f2-)

add_kv INTERNAL_API_SECRET "$S_INTERNAL_VAL"
add_kv WHATSAPP_DAEMON_URL "http://localhost:3002"
add_kv WHATSPOWER_ENABLED "true"
add_kv WHATSPOWER_INBOUND_URL "http://localhost:3003/api/inbound"
add_kv WHATSPOWER_STAGE_URL "http://localhost:3003/api/crm/stage-change"
add_kv WHATSPOWER_WEBHOOK_SECRET "$S_WEBHOOK_VAL"
chmod 600 "$ENVF"
echo "claves .env ahora: $(cut -d= -f1 "$ENVF" | tr '\n' ' ')"

# reset contraseña demo (script existente, mismo scrypt de auth.ts)
set -a; source "$ENVF"; set +a
cd /home/z/my-project
node scripts/reset-demo-password.mjs
