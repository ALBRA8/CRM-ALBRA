#!/bin/bash
# Bootstrap E2E post-publicación — genera credenciales efímeras, configura y levanta servicios.
# Las credenciales viven SOLO en download/.e2e-creds.sh (chmod 600, gitignored, se borra al final).
set -u
cd /home/z/my-project
CREDS=download/.e2e-creds.sh

# 1. Credenciales frescas (siempre se regeneran)
WP_SECRET="wpbr_$(openssl rand -hex 24)"
META_SECRET="e2emeta_$(openssl rand -hex 24)"
DAEMON_SECRET="crm_albra_internal_secret_key_fixed_length_for_daemon_2026"  # default del daemon en el sandbox

umask 077
cat > "$CREDS" << EOF
WP_SECRET='$WP_SECRET'
META_SECRET='$META_SECRET'
DAEMON_SECRET='$DAEMON_SECRET'
EOF

# 2. CRM: relanzar con bridge activo y el secreto real
pkill -f "next dev -p 3000" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
WHATSPOWER_ENABLED=true WHATSPOWER_WEBHOOK_SECRET="$WP_SECRET" \
  setsid nohup npx next dev -p 3000 > dev.log 2>&1 < /dev/null &
for i in $(seq 1 36); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:3000/api/health 2>/dev/null)
  [ "$code" = "200" ] && break; sleep 5
done
echo "CRM:3000=$code"
[ "$code" != "200" ] && { echo "FALLO CRM"; exit 1; }

# 3. Demo + API key + integración Meta
RESP=$(curl -s -X POST http://localhost:3000/api/auth/demo)
TOK=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch(e){console.log('')}})")
if [ -z "$TOK" ]; then echo "FALLO demo"; exit 1; fi
KRESP=$(curl -s -X POST http://localhost:3000/api/settings/api-keys -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"name":"E2E-WHATSPOWER-CRM-2026-postpub-v2"}')
CRM_KEY=$(echo "$KRESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.secret||j.raw||j.key||'')}catch(e){console.log('')}})")
[ -z "$CRM_KEY" ] && { echo "FALLO apikey"; exit 1; }
CFG=$(curl -s -X PUT http://localhost:3000/api/whatsapp/config -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d "{\"metaAppSecret\":\"$META_SECRET\",\"whatsappPhoneId\":\"e2e-phone-id-2026\"}")
echo "integración: $(echo "$CFG" | head -c 60)"

# Revocar claves huérfanas de intentos anteriores (todas menos la actual por nombre)
curl -s http://localhost:3000/api/settings/api-keys -H "Authorization: Bearer $TOK" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',async()=>{
  try { const j=JSON.parse(d); const list=j.apiKeys||j||[];
    for (const k of list) { if (k.name && !k.name.includes('v2') && !k.revokedAt) {
      await fetch('http://localhost:3000/api/settings/api-keys/'+k.id, {method:'DELETE',headers:{Authorization:'Bearer '+process.env.TOKX}}).catch(()=>{});
      console.log('revocada huérfana:', k.name); } }
  } catch(e) { console.log('sin claves huérfanas'); }
})" 2>/dev/null | head -3
export TOKX="$TOK"

# 4. WHATSPOWER :3003 + ULTRA :3004 + stub daemon :3012 (con secretos reales)
pkill -f "src/server.ts" 2>/dev/null; pkill -f "stub-daemon" 2>/dev/null; sleep 1
cd /home/z/repos/WHATSPOWER && PORT=3003 CRM_BASE_URL=http://localhost:3000 CRM_API_KEY="$CRM_KEY" \
  AGENTIC_2A_WEBHOOK_SECRET="$WP_SECRET" setsid nohup node --experimental-strip-types src/server.ts > /home/z/my-project/dev-whatspower.log 2>&1 < /dev/null &
cd /home/z/repos/WHATSPOWER-ULTRA && PORT=3004 WA_DAEMON_URL=http://localhost:3002 \
  INTERNAL_API_SECRET="$DAEMON_SECRET" ALLOW_REAL_DISPATCH=false WHATSPOWER_BASE_URL=http://localhost:3003 \
  setsid nohup node --experimental-strip-types src/server.ts > /home/z/my-project/dev-ultra.log 2>&1 < /dev/null &
cd /home/z/my-project && STUB_SECRET="$DAEMON_SECRET" setsid nohup node scripts/stub-daemon.mjs > /home/z/my-project/dev-stub.log 2>&1 < /dev/null &
sleep 3
for p in 3003 3004 3012; do
  hp=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:$p/api/health 2>/dev/null)
  echo "puerto $p: $hp"
done

# 5. Guardar credenciales para las siguientes fases (fichero 600, gitignored, efímero)
cat > "$CREDS" << EOF
WP_SECRET='$WP_SECRET'
META_SECRET='$META_SECRET'
DAEMON_SECRET='$DAEMON_SECRET'
CRM_KEY='$CRM_KEY'
TOK='$TOK'
EOF
chmod 600 "$CREDS"
echo "bootstrap OK (credenciales en $CREDS, se eliminará al final)"
