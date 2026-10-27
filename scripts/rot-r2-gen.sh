#!/bin/bash
# ROTACIÓN R2 — VENTANA DE PRODUCCIÓN CONTROLADA (2026-10-28)
# Genera 5 secretos frescos SIN imprimirlos jamás.
# Única copia: /home/z/secure-rotation/secrets-r2.env (600, dir 700).
# Salida visible: SOLO huellas sha256 (12 hex) + longitud. Nunca valores.
set -euo pipefail
umask 077

SECRETS=/home/z/secure-rotation/secrets-r2.env

# Nunca heredar valores previos
unset INTERNAL_API_SECRET WEBHOOK_SECRET APP_SECRET APP_ENCRYPTION_KEY WHATSAPP_VERIFY_TOKEN || true

S_INTERNAL=$(openssl rand -hex 32)
S_WEBHOOK=$(openssl rand -hex 32)
S_APPSECRET=$(openssl rand -hex 32)
S_ENCKEY=$(openssl rand -hex 32)
S_VERIFY=$(openssl rand -hex 24)

cat > "$SECRETS" <<EOF
S_INTERNAL=$S_INTERNAL
S_WEBHOOK=$S_WEBHOOK
S_APPSECRET=$S_APPSECRET
S_ENCKEY=$S_ENCKEY
S_VERIFY=$S_VERIFY
EOF
chmod 600 "$SECRETS"

# Huellas (seguras de mostrar) + limpieza de variables del propio script
fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }
echo "S_INTERNAL len=${#S_INTERNAL} sha256:$(fp "$S_INTERNAL")…"
echo "S_WEBHOOK  len=${#S_WEBHOOK} sha256:$(fp "$S_WEBHOOK")…"
echo "S_APPSECRET len=${#S_APPSECRET} sha256:$(fp "$S_APPSECRET")…"
echo "S_ENCKEY   len=${#S_ENCKEY} sha256:$(fp "$S_ENCKEY")…"
echo "S_VERIFY   len=${#S_VERIFY} sha256:$(fp "$S_VERIFY")…"

unset S_INTERNAL S_WEBHOOK S_APPSECRET S_ENCKEY S_VERIFY
echo "OK: secretos R2 generados en $SECRETS (600). Cero valores impresos."
