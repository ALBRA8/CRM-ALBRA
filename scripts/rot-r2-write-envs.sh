#!/bin/bash
# ROTACIÓN R2 — Escribe .env de los 4 consumidores leyendo secretos-r2.env.
# Los valores viajan SOLO entre archivos (600). Jamás se imprimen ni van a argv.
set -euo pipefail
umask 077

SECRETS=/home/z/secure-rotation/secrets-r2.env
# shellcheck disable=SC1090
source "$SECRETS"

CRM=/home/z/repos-limpio/CRM-ALBRA/.env
WP=/home/z/repos-limpio/WHATSPOWER/.env
ULTRA=/home/z/repos-limpio/WHATSPOWER-ULTRA/.env

# 1) CRM (compartido con daemon Baileys :3002 — el daemon carga este mismo .env)
cat > "$CRM" <<EOF
DATABASE_URL=file:/home/z/repos-limpio/CRM-ALBRA/db/custom.db
APP_SECRET=$S_APPSECRET
APP_ENCRYPTION_KEY=$S_ENCKEY
INTERNAL_API_SECRET=$S_INTERNAL
WHATSAPP_DAEMON_URL=http://localhost:3002
WHATSAPP_DAEMON_PORT=3002
NEXT_APP_URL=http://localhost:3100
WHATSAPP_VERIFY_TOKEN=$S_VERIFY
WHATSPOWER_ENABLED=true
WHATSPOWER_INBOUND_URL=http://localhost:3003/api/inbound
WHATSPOWER_STAGE_URL=http://localhost:3003/api/crm/stage-change
WHATSPOWER_WEBHOOK_SECRET=$S_WEBHOOK
ALBRA_AGENT_ENABLED=false
EOF

# 2) WHATSPOWER (:3003)
cat > "$WP" <<EOF
PORT=3003
NODE_ENV=production
INTERNAL_API_SECRET=$S_INTERNAL
WEBHOOK_SECRET=$S_WEBHOOK
WHATSAPP_DAEMON_URL=http://localhost:3002
CRM_BASE_URL=http://localhost:3100
EOF

# 3) ULTRA (despacho real SIEMPRE deshabilitado en esta ventana)
cat > "$ULTRA" <<EOF
PORT=3004
INTERNAL_API_SECRET=$S_INTERNAL
WA_DAEMON_URL=http://localhost:3002
WHATSPOWER_BASE_URL=http://localhost:3003
CRM_BASE_URL=http://localhost:3100
ALLOW_REAL_DISPATCH=false
META_MOCK_MODE=true
EOF

chmod 600 "$CRM" "$WP" "$ULTRA"

# Verificación estructural SIN valores: cuenta de claves por archivo
for f in "$CRM" "$WP" "$ULTRA"; do
  echo "$(basename $(dirname $f))/.env: $(grep -cE '^[A-Z_]+=' $f) claves, permisos $(stat -c %a $f)"
done

# Comprobación cruzada de coherencia (sin imprimir): mismo S_INTERNAL en 4 consumidores
daemon_ok=$(grep -c "^INTERNAL_API_SECRET=$S_INTERNAL$" "$CRM")
wp_ok=$(grep -c "^INTERNAL_API_SECRET=$S_INTERNAL$" "$WP")
ultra_ok=$(grep -c "^INTERNAL_API_SECRET=$S_INTERNAL$" "$ULTRA")
webhook_wp=$(grep -c "^WEBHOOK_SECRET=$S_WEBHOOK$" "$WP")
webhook_crm=$(grep -c "^WHATSPOWER_WEBHOOK_SECRET=$S_WEBHOOK$" "$CRM")
enc_crm=$(grep -c "^APP_ENCRYPTION_KEY=$S_ENCKEY$" "$CRM")
echo "coherencia: daemon(CRM.env)=$daemon_ok WP=$wp_ok ULTRA=$ultra_ok webhookWP=$webhook_wp webhookCRM=$webhook_crm encCRM=$enc_crm (todos deben ser 1)"
unset S_INTERNAL S_WEBHOOK S_APPSECRET S_ENCKEY S_VERIFY
echo "OK: .env escritos en los 3 repos (daemon hereda el de CRM)."
