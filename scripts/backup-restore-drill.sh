#!/usr/bin/env bash
# ============================================================
# CRM ALBRA — DRILL de BACKUP/RESTAURE (auditoría pre-venta P1)
#
# Demuestra la cadena completa EXIGIDA por la auditoría, en entorno
# AISLADO (no toca la BD real de desarrollo/producción):
#
#   BD original → [1] snapshot consistente (Online Backup API)
#                → [2] integridad del snapshot
#                → [3] copia EXTERNA (dir que simula almacenamiento remoto;
#                      con rclone + BACKUP_REMOTE_DEST copia de verdad)
#                → [4] DESTRUCCIÓN controlada del estado
#                → [5] RESTAURACIÓN desde la copia externa
#                → [6] verificación: integridad + conteos por tabla
#                → [7] CRM FUNCIONAL: boot standalone contra la BD
#                      restaurada + /api/health + auth leyendo la BD
#                → [8] informe de tiempos y alcances
#
# Uso:   bash scripts/backup-restore-drill.sh
# Reqs:  node + better-sqlite3 (repo) y .next/standalone (bun run build)
# Exit:  0 PASS · 1 FAIL
#
# La "BD original" del drill NUNCA es la BD real: se copia la estructura y
# se SIEMBRAN datos demo (org + usuario scrypt + cliente + oportunidad +
# automatización) → conteos > 0 verificables y cero riesgo para producción.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
DRILL="/tmp/crm-drill-$STAMP"
LOCAL_BAK="$DRILL/1-backup-local"      # = rol del dir de backup nocturno
EXTERNAL="$DRILL/2-backup-externo"     # = rol del storage remoto (rclone)
SANDBOX="$DRILL/3-sandbox-restauracion"
PORT=3101

SRC_DB="${DATABASE_URL:-file:$ROOT/db/custom.db}"
SRC_DB="${SRC_DB#file:}"

declare -a TIMES
phase() { TIMES+=("$1|$(date +%s%3N)"); echo "── $1"; }

fail() { echo "❌ FAIL: $*" >&2; exit 1; }

mkdir -p "$LOCAL_BAK" "$EXTERNAL" "$SANDBOX"
[ -f "$SRC_DB" ] || fail "no existe la BD de origen: $SRC_DB"

# ─────────────────────────────────────────────────────────────
phase "[0/8] BD original del drill (estructura real + datos demo — la BD real NUNCA se toca)"
cp "$SRC_DB" "$LOCAL_BAK/custom.db"
DRILL_USER_EMAIL="drill-owner@drill.local"
DRILL_USER_PASS="Drill-Passw0rd!"
node -e "
const D = require('better-sqlite3');
const { scryptSync, randomBytes } = require('crypto');
const db = new D('$LOCAL_BAK/custom.db');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync('$DRILL_USER_PASS', salt, 64).toString('hex');
const now = new Date().toISOString();
let oid = db.prepare('SELECT id FROM Organization LIMIT 1').get();
if (oid) { db.prepare('UPDATE Organization SET updatedAt = ? WHERE id = ?').run(now, oid.id); }
else {
  db.prepare('INSERT INTO Organization (id, name, slug, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run('drill-org', 'Drill Org', 'drill-org', now, now);
  oid = { id: 'drill-org' };
}
if (!db.prepare('SELECT id FROM User WHERE email = ?').get('$DRILL_USER_EMAIL')) {
  db.prepare('INSERT INTO User (id, email, name, passwordHash, role, isActive, organizationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .run('drill-user', '$DRILL_USER_EMAIL', 'Owner Drill', 'scrypt:' + salt + ':' + hash, 'owner', oid.id, now, now);
}
const ins = (t, cols, vals) => db.prepare('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')').run(...vals);
ins('Client', ['id','organizationId','name','phone','status','createdAt','updatedAt'], ['drill-cli-1', oid.id, 'Cliente Drill', '+57 300 000 0001', 'prospect', now, now]);
ins('Opportunity', ['id','organizationId','clientId','title','amount','status','createdAt','updatedAt'], ['drill-opp-1', oid.id, 'drill-cli-1', 'Oportunidad Drill', 1500000, 'open', now, now]);
ins('Automation', ['id','organizationId','name','triggerType','conditions','actions','isActive','createdAt','updatedAt'], ['drill-auto-1', oid.id, 'Auto Drill', 'client_created', '[]', '[]', 1, now, now]);
db.close();
console.log('sembrados: org + user(owner,scrypt) + cliente + oportunidad + automatización');
"
SRC_DB="$LOCAL_BAK/custom.db"
SNAP="$LOCAL_BAK/custom-drill.db"

trap 'if [ -n "${APP_PID:-}" ]; then kill "$APP_PID" 2>/dev/null || true; fi' EXIT

# ─────────────────────────────────────────────────────────────
phase "[1/8] Snapshot consistente (mismo método del nocturno: Online Backup API + integrity_check)"
DATABASE_URL="file:$SRC_DB" BACKUP_OUT="$SNAP" node scripts/sqlite-backup.cjs

phase "[2/8] Integridad + conteo del snapshot"
node -e "
const D = require('better-sqlite3');
const db = new D('$SNAP', { readonly: true });
const check = db.pragma('integrity_check', { simple: true });
if (check !== 'ok') process.exit(2);
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'\").all().map(r => r.name);
console.log('integrity_check: ok · tablas: ' + tables.length);
"
# Hash del snapshot original (para comparar tras la copia externa)
HASH_ORIG="$(sha256sum "$SNAP" | cut -d' ' -f1)"

phase "[3/8] Copia EXTERNA $( [ -n "${BACKUP_REMOTE_DEST:-}" ] && echo "(rclone → $BACKUP_REMOTE_DEST)" || echo "(dir local que simula el storage remoto)" )"
if [ -n "${BACKUP_REMOTE_DEST:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$SNAP" "$BACKUP_REMOTE_DEST/drill-$STAMP/"
  cp "$BACKUP_REMOTE_DEST/drill-$STAMP/$(basename "$SNAP")" "$EXTERNAL/custom-drill.db"
else
  cp "$SNAP" "$EXTERNAL/custom-drill.db"
fi
HASH_EXT="$(sha256sum "$EXTERNAL/custom-drill.db" | cut -d' ' -f1)"
[ "$HASH_ORIG" = "$HASH_EXT" ] || fail "el hash de la copia externa no coincide"
echo "   sha256 idéntico: ${HASH_ORIG:0:16}…"

phase "[4/8] DESTRUCCIÓN controlada del estado (simula pérdida total de la BD)"
echo "corrupción deliberada" > "$SANDBOX/custom.db"   # estado previo inútil
rm -f "$SANDBOX/custom.db-wal" "$SANDBOX/custom.db-shm"
echo "   BD del sandbox destruida ($(wc -c < "$SANDBOX/custom.db") bytes de basura)"

phase "[5/8] RESTAURACIÓN desde la copia EXTERNA"
cp "$EXTERNAL/custom-drill.db" "$SANDBOX/custom.db"
# Regla del despliegue real (DEPLOY.md §8): sin WAL viejo + dueño correcto
rm -f "$SANDBOX/custom.db-wal" "$SANDBOX/custom.db-shm"
chmod 644 "$SANDBOX/custom.db"

phase "[6/8] Verificación de la BD restaurada (integridad + conteos vs snapshot)"
node -e "
const D = require('better-sqlite3');
const snap = new D('$SNAP', { readonly: true });
const rest = new D('$SANDBOX/custom.db', { readonly: true });
const c1 = rest.pragma('integrity_check', { simple: true });
if (c1 !== 'ok') process.exit(2);
const tables = ['Organization','User','Client','Opportunity','Quote','Automation','WhatsAppConversation','AgentMemory','AuditLog','Settings'].filter(t => {
  try { rest.prepare('SELECT 1 FROM ' + t + ' LIMIT 1').get(); return true } catch { return false }
});
let mismatches = 0;
for (const t of tables) {
  const a = snap.prepare('SELECT COUNT(*) n FROM \"' + t + '\"').get().n;
  const b = rest.prepare('SELECT COUNT(*) n FROM \"' + t + '\"').get().n;
  const ok = a === b ? 'OK' : 'DIFIERE';
  if (a !== b) mismatches++;
  console.log('  ' + t.padEnd(24) + ' snapshot=' + a + ' restaurada=' + b + ' ' + ok);
}
console.log(mismatches === 0 ? 'conteos idénticos en ' + tables.length + ' tablas core' : 'FALLO: ' + mismatches + ' tablas difieren');
process.exit(mismatches === 0 ? 0 : 3);
"

phase "[7/8] CRM FUNCIONAL contra la BD restaurada (:$PORT, boot standalone)"
[ -f .next/standalone/server.js ] || fail "falta .next/standalone — ejecuta antes: bun run build (o npm run build)"
DATABASE_URL="file:$SANDBOX/custom.db" \
APP_SECRET="drill-app-secret-$STAMP" \
APP_ENCRYPTION_KEY="drill-enc-key-$STAMP" \
INTERNAL_API_SECRET="drill-internal-$STAMP" \
PORT=$PORT HOSTNAME=127.0.0.1 SKIP_DB_PUSH=1 NEXT_TELEMETRY_DISABLED=1 \
  node .next/standalone/server.js > "$DRILL/server.log" 2>&1 &
APP_PID=$!

HEALTH=""
for i in $(seq 1 60); do
  HEALTH="$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 0.5
done
echo "$HEALTH" | grep -q '"ok":true' || fail "health no respondió ok contra la BD restaurada (ver $DRILL/server.log)"
echo "   /api/health → $HEALTH"

# Auth leyendo la BD restaurada: sin token → 401; login falso → 401 (Prisma consulta User)
CODE_NOAUTH="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/clients")"
CODE_BADLOGIN="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"email":"drill-no-existe@t.albra","password":"ClaveIncorrecta123"}' "http://127.0.0.1:$PORT/api/auth/login")"
LOGIN_JSON="$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$DRILL_USER_EMAIL\",\"password\":\"$DRILL_USER_PASS\"}" "http://127.0.0.1:$PORT/api/auth/login")"
echo "$LOGIN_JSON" | grep -q '"token"' || fail "login con credenciales correctas no devolvió token (ver $DRILL/server.log)"
[ "$CODE_NOAUTH" = "401" ] || fail "API protegida respondió $CODE_NOAUTH (esperado 401)"
[ "$CODE_BADLOGIN" = "401" ] || fail "login falso respondió $CODE_BADLOGIN (esperado 401)"
echo "   /api/clients sin token → $CODE_NOAUTH · login falso → $CODE_BADLOGIN · login real (scrypt+Prisma) → token OK"
kill "$APP_PID" 2>/dev/null || true
APP_PID=""

phase "[8/8] Informe del drill"
echo "   Origen:      $SRC_DB"
echo "   Snapshot:    $SNAP ($(wc -c < "$SNAP") bytes, sha256 ${HASH_ORIG:0:16}…)"
echo "   Externo:     $EXTERNAL/custom-drill.db (hash verificado)"
echo "   Restaurada:  $SANDBOX/custom.db (integridad ok, conteos idénticos)"
echo "   CRM:         health ok + auth operativa contra la BD restaurada"
echo "   NO cubierto por este drill (respaldado/documentado aparte):"
echo "     · sesión WhatsApp (volumen wa-auth → tar en backup-nightly.sh; DEPLOY.md §8)"
echo "     · .env con secretos (se re-crea; pérdida = re-ingresar llaves IA)"
echo "     · attachmentes binarios si existieran fuera de la BD"
i=${#TIMES[@]}
echo ""
echo "✅ DRILL BACKUP/RESTAURE: PASS — backup→integridad→externo→destrucción→restore→CRM funcional"
