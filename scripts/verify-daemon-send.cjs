// Harness de validación del fix /send del daemon (estabilización).
// Replica EXACTAMENTE las sentencias SQL que el daemon ejecuta en /send
// (persistencia del mensaje humano + takeover) y el matching de cliente
// por teléfono normalizado de getOrCreateConversation, contra una COPIA
// de la BD real. No toca la BD en uso.
const Database = require('better-sqlite3')
const fs = require('fs')

const SRC = process.env.DB_PATH || 'db/custom.db'
const TMP = '/tmp/daemon-send-test.db'
fs.copyFileSync(SRC, TMP)
const db = new Database(TMP)

const org = db.prepare('SELECT id FROM Organization LIMIT 1').get()
if (!org) { console.error('FAIL: no hay organización en la BD'); process.exit(1) }
console.log('org:', org.id)

// ---------- 1. Matching de cliente por teléfono normalizado ----------
const digits = (s) => String(s || '').replace(/\D/g, '')
const contactPhone = '573115550102' // formato Baileys (Carlos Rodríguez: '+57 311 555 0102' sin formato)
const candidates = db.prepare('SELECT id, phone, name FROM Client WHERE organizationId = ?').all(org.id)
const match = candidates.find((c) => digits(c.phone) === contactPhone)
console.log('1) matching normalizado:', match ? `OK → ${match.name} (${match.phone})` : 'FAIL: no emparejó teléfono formateado')
if (!match) process.exit(1)

// ---------- 2. /send sobre teléfono SIN conversación previa (rama create) ----------
const existing = db.prepare('SELECT * FROM WhatsAppConversation WHERE organizationId = ? AND contactPhone = ?').get(org.id, contactPhone)
console.log('   conversación previa:', existing ? `sí (${existing.id})` : 'no → se crea')
const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)

function getOrCreateConversation(orgId, phone, contactName) {
  let conv = db.prepare('SELECT * FROM WhatsAppConversation WHERE organizationId = ? AND contactPhone = ?').get(orgId, phone)
  if (!conv) {
    let client = null
    const phoneDigits = digits(phone)
    if (phoneDigits) {
      const cands = db.prepare('SELECT id, phone FROM Client WHERE organizationId = ?').all(orgId)
      const m = cands.find((c) => digits(c.phone) === phoneDigits)
      if (m) client = { id: m.id }
    }
    if (!client) {
      const clientId = genId()
      db.prepare(`INSERT INTO Client (id, organizationId, name, phone, source, status, lastContactAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'whatsapp', 'prospect', datetime('now'), datetime('now'), datetime('now'))`).run(clientId, orgId, contactName || phone, phone)
      client = { id: clientId }
      console.log('   (cliente creado — no debería pasar si el matching funciona)')
    } else {
      console.log('   cliente emparejado sin duplicar ✓')
    }
    const convId = genId()
    db.prepare(`INSERT INTO WhatsAppConversation (id, organizationId, clientId, contactPhone, contactName, lastMessage, lastMessageAt, lastMessageFrom, unreadCount, isAutoReply, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, NULL, datetime('now'), 'contact', 1, 1, 'active', datetime('now'), datetime('now'))`).run(convId, orgId, client.id, phone, contactName || phone)
    conv = { id: convId, clientId: client.id, isAutoReply: 1 }
  }
  return conv
}

function saveMessage(convId, orgId2, direction, fromNumber, toNumber, text, senderType) {
  const msgId = genId()
  db.prepare(`INSERT INTO WhatsAppMessage (id, organizationId, conversationId, waMessageId, direction, fromNumber, toNumber, text, messageType, senderType, isRead, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, datetime('now'))`).run(msgId, orgId2, convId, null, direction, fromNumber, toNumber, text, senderType, direction === 'outbound' ? 1 : 0)
  const lastFrom = direction === 'inbound' ? 'contact' : senderType
  db.prepare(`UPDATE WhatsAppConversation SET lastMessage = ?, lastMessageAt = datetime('now'), lastMessageFrom = ?, updatedAt = datetime('now') WHERE id = ?`)
    .run(text?.substring(0, 100), lastFrom, convId)
  return msgId
}

const clientsBefore = db.prepare('SELECT COUNT(*) n FROM Client').get().n
let conv = db.prepare('SELECT * FROM WhatsAppConversation WHERE organizationId = ? AND contactPhone = ?').get(org.id, contactPhone)
if (!conv) conv = getOrCreateConversation(org.id, contactPhone, null)
console.log('2) conversación lista:', conv.id, '| clientId:', conv.clientId, '| isAutoReply:', conv.isAutoReply)

// ---------- 3. Persistencia del mensaje humano + takeover ----------
const text = 'Hola, soy el asesor humano. ¿En qué quedamos?'
saveMessage(conv.id, org.id, 'outbound', '573009990000', contactPhone, text, 'human')
db.prepare("UPDATE Client SET lastContactAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(conv.clientId)
let tookOver = false
if (conv.isAutoReply) {
  db.prepare("UPDATE WhatsAppConversation SET isAutoReply = 0, updatedAt = datetime('now') WHERE id = ?").run(conv.id)
  tookOver = true
}
const persisted = db.prepare('SELECT senderType, direction, text, isRead FROM WhatsAppMessage WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1').get(conv.id)
const convAfter = db.prepare('SELECT isAutoReply, lastMessage, lastMessageFrom, unreadCount FROM WhatsAppConversation WHERE id = ?').get(conv.id)
console.log('3) mensaje persistido:', JSON.stringify(persisted))
console.log('   takeover:', tookOver, '| conv tras send:', JSON.stringify(convAfter))
const clientsAfter = db.prepare('SELECT COUNT(*) n FROM Client').get().n

// ---------- Veredicto ----------
const ok = persisted && persisted.senderType === 'human' && persisted.direction === 'outbound' && persisted.isRead === 1
  && tookOver === true && convAfter.isAutoReply === 0 && convAfter.lastMessageFrom === 'human'
  && convAfter.unreadCount === (existing ? existing.unreadCount : 1) // sin bump en salientes
  && clientsAfter === clientsBefore // sin duplicado de cliente
console.log(ok ? '\n✓ HARNESS OK: persistencia + takeover + matching + sin duplicados' : '\n✗ HARNESS FALLÓ')
process.exit(ok ? 0 : 1)
