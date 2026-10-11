#!/bin/bash
# Verificación E2E de WhatsApp — CRM ALBRA
# 1) Arranca Next.js (3000) + daemon WhatsApp (3002)
# 2) Espera a que estén listos
# 3) Verifica: conexión WA, mensajes en DB, Opportunity creada por IA
cd /home/z/my-project

echo "=== [1] Levantando servicios ==="
# Mata restos previos por si acaso
pkill -f "next dev" 2>/dev/null
pkill -f "whatsapp-daemon/daemon.mjs" 2>/dev/null
sleep 1

# Daemon WhatsApp en background (usa .wa-auth → reconecta sin QR)
nohup node src/whatsapp-daemon/daemon.mjs > daemon-verify.log 2>&1 &
DAEMON_PID=$!
echo "daemon PID: $DAEMON_PID"

# Next.js dev server en background
nohup bun run dev > dev-verify.log 2>&1 &
NEXT_PID=$!
echo "next PID: $NEXT_PID"

echo "=== [2] Esperando a los servicios (máx 90s) ==="
DAEMON_OK=0
NEXT_OK=0
for i in $(seq 1 90); do
  if [ "$DAEMON_OK" -eq 0 ]; then
    S=$(curl -s --max-time 2 http://localhost:3002/status 2>/dev/null)
    if [ -n "$S" ]; then DAEMON_OK=1; echo "daemon listo tras ${i}s: $S"; fi
  fi
  if [ "$NEXT_OK" -eq 0 ]; then
    C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000 2>/dev/null)
    if [ "$C" = "200" ] || [ "$C" = "307" ] || [ "$C" = "302" ]; then NEXT_OK=1; echo "next listo tras ${i}s (HTTP $C)"; fi
  fi
  if [ "$DAEMON_OK" -eq 1 ] && [ "$NEXT_OK" -eq 1 ]; then break; fi
  sleep 1
done

echo ""
echo "=== [3] Estado del daemon WhatsApp ==="
curl -s --max-time 3 http://localhost:3002/status
echo ""
echo ""
echo "=== [4] Conversaciones WhatsApp en DB ==="
node -e "
const Database = require('better-sqlite3');
const db = new Database('db/custom.db', { readonly: true });
try {
  const msgs = db.prepare(\"SELECT COUNT(*) as n FROM WhatsAppMessage\").get();
  console.log('Total mensajes WhatsApp:', msgs.n);
  const convs = db.prepare(\"SELECT id, contactPhone, contactJid, lastMessageAt FROM WhatsAppConversation ORDER BY lastMessageAt DESC LIMIT 3\").all();
  console.log('Conversaciones (top 3):');
  convs.forEach(c => console.log('  ', c.contactPhone, '| jid:', c.contactJid, '|', c.lastMessageAt));
  const last = db.prepare(\"SELECT direction, content, createdAt FROM WhatsAppMessage ORDER BY createdAt DESC LIMIT 6\").all();
  console.log('Últimos 6 mensajes:');
  last.forEach(m => console.log('  [' + m.direction + ']', (m.content||'').slice(0,80).replace(/\n/g,' '), '|', m.createdAt));
  const opps = db.prepare(\"SELECT name, value, source, createdAt FROM Opportunity ORDER BY createdAt DESC LIMIT 3\").all();
  console.log('Oportunidades (top 3):');
  opps.forEach(o => console.log('  ', o.name, '| $' + o.value, '| source:', o.source, '|', o.createdAt));
} catch(e) { console.log('DB error:', e.message); }
db.close();
"

echo ""
echo "=== [5] Log del daemon (últimas 15 líneas) ==="
tail -15 daemon-verify.log

echo ""
echo "=== RESUMEN ==="
echo "daemon: $DAEMON_OK | next: $NEXT_OK"
