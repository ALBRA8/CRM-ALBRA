// Harness de validación del fix /send del daemon (estabilización).
// Replica EXACTAMENTE las sentencias SQL que el daemon ejecuta en /send
// (persistencia del mensaje humano + takeover) y el matching de cliente
// por teléfono normalizado de getOrCreateConversation, contra una COPIA
// de la BD real. No toca la BD en uso.
// (UNIFICACIÓN 2026-11-21) El daemon escribe en ChannelConnection
// (whatsapp_baileys) + ChannelConversation + ChannelMessage.
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
const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)

function ensureBaileysConnection(orgId, phone) {
  const key = `whatsapp_baileys:${orgId}`
  const existing = db.prepare('SELECT id FROM ChannelConnection WHERE providerAccountKey = ?').get(key)
  if (existing) return existing.id
  const id = genId()
  db.prepare(`INSERT INTO ChannelConnection (id, organizationId, channel, provider, providerAccountKey, externalAccountId, displayName, status, credentialsEnc, metadata, createdAt, updatedAt)
    VALUES (?, ?, 'whatsapp', 'whatsapp_baileys', ?, ?, 'WhatsApp QR (Baileys)', 'connected', 'harness', '{}', datetime('now'), datetime('now'))`)
    .run(id, orgId, key, phone || orgId)
  return id
}

function getOrCreateConversation(orgId, phone, contactName) {
  const connectionId = ensureBaileysConnection(orgId, phone)
  let conv = db.prepare('SELECT * FROM ChannelConversation WHERE connectionId = ? AND externalContactKey = ?').get(connectionId, phone)
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
    db.prepare(`INSERT INTO ChannelConversation (id, organizationId, connectionId, channel, externalContactKey, contactName, lastMessage, lastMessageAt, unreadCount, status, metadata, createdAt, updatedAt)
      VALUES (?, ?, ?, 'whatsapp', ?, ?, NULL, datetime('now'), 0, 'active', ?, datetime('now'), datetime('now'))`)
      .run(convId, orgId, connectionId, phone, contactName || phone, JSON.stringify({ clientId: client.id, isAutoReply: true, transferredTo: null }))
    conv = { id: convId, clientId: client.id, metadata: JSON.stringify({ clientId: client.id, isAutoReply: true }) }
  }
  return conv
}

function convMetadata(conv) {
  try { return JSON.parse(conv.metadata || '{}') } catch { return {} }
}

function saveMessage(convId, direction, fromNumber, toNumber, text, senderType) {
  const msgId = genId()
  const dir = direction === 'outbound' ? 'out' : 'in'
  db.prepare(`INSERT INTO ChannelMessage (id, conversationId, externalMessageId, direction, senderType, body, messageType, metadata, createdAt)
    VALUES (?, ?, NULL, ?, ?, ?, 'text', ?, datetime('now'))`)
    .run(msgId, convId, dir, senderType, text, JSON.stringify({ from: fromNumber, to: toNumber, ...(direction === 'outbound' ? { deliveryStatus: 'sent' } : {}) }))
  db.prepare(`UPDATE ChannelConversation SET lastMessage = substr(COALESCE(?, ''), 1, 100), lastMessageAt = datetime('now'), unreadCount = unreadCount + ?, updatedAt = datetime('now') WHERE id = ?`)
    .run(text, dir === 'in' ? 1 : 0, convId)
  return msgId
}

const clientsBefore = db.prepare('SELECT COUNT(*) n FROM Client').get().n
const conv = getOrCreateConversation(org.id, contactPhone, null)
const meta = convMetadata(conv)
console.log('2) conversación lista:', conv.id, '| clientId:', meta.clientId, '| isAutoReply:', meta.isAutoReply !== false ? 1 : 0)

// ---------- 3. Persistencia del mensaje humano + takeover ----------
const text = 'Hola, soy el asesor humano. ¿En qué quedamos?'
saveMessage(conv.id, 'outbound', '573009990000', contactPhone, text, 'user')
db.prepare("UPDATE Client SET lastContactAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(meta.clientId)
let tookOver = false
if (meta.isAutoReply !== false) {
  const nextMeta = { ...meta, isAutoReply: false }
  db.prepare("UPDATE ChannelConversation SET metadata = ?, updatedAt = datetime('now') WHERE id = ?").run(JSON.stringify(nextMeta), conv.id)
  tookOver = true
}
const persisted = db.prepare('SELECT senderType, direction, body AS text FROM ChannelMessage WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1').get(conv.id)
const convAfterRow = db.prepare('SELECT status, lastMessage, unreadCount, metadata FROM ChannelConversation WHERE id = ?').get(conv.id)
const convAfterMeta = convMetadata(convAfterRow)
const convAfter = { isAutoReply: convAfterMeta.isAutoReply !== false ? 1 : 0, unreadCount: convAfterRow.unreadCount }
console.log('3) mensaje persistido:', JSON.stringify(persisted))
console.log('   takeover:', tookOver, '| conv tras send:', JSON.stringify(convAfter))
const clientsAfter = db.prepare('SELECT COUNT(*) n FROM Client').get().n

// ---------- Veredicto ----------
const ok = persisted && persisted.senderType === 'user' && persisted.direction === 'out'
  && tookOver === true && convAfter.isAutoReply === 0
  && convAfter.unreadCount === 0 // sin bump en salientes
  && clientsAfter === clientsBefore // sin duplicado de cliente
console.log(ok ? '\n✓ HARNESS OK: persistencia + takeover + matching + sin duplicados' : '\n✗ HARNESS FALLÓ')
process.exit(ok ? 0 : 1)
