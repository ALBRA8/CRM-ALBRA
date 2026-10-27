#!/bin/bash
# Genera credenciales SINTÉTICAS de prueba para la campaña E2E (nunca se imprimen).
# Fichero con permisos 600, fuera de cualquier repo. Borrado en teardown.
set -e
E2E=/home/z/my-project/albra-final/e2e
mkdir -p "$E2E/logs"
CREDS="$E2E/.e2e-creds.sh"
if [ -f "$CREDS" ]; then echo "creds ya existen (reuso)"; exit 0; fi
umask 077
cat > "$CREDS" <<EOF
export E2E_INT_SECRET="$(openssl rand -hex 24)"
export E2E_WP_SECRET="$(openssl rand -hex 24)"
export E2E_APP_SECRET="$(openssl rand -hex 24)"
export E2E_ENC_KEY="$(openssl rand -hex 32)"
export E2E_META_SECRET="$(openssl rand -hex 24)"
export E2E_STUB_PORT=3012
EOF
chmod 600 "$CREDS"
echo "credenciales sintéticas generadas en $CREDS (600, no se imprimen)"
