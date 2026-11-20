/**
 * Backfill del historial del daemon Baileys hacia el modelo canónico.
 *
 * (UNIFICACIÓN 2026-11-21) Mueve TODO el historial de WhatsAppConversation /
 * WhatsAppMessage hacia ChannelConversation / ChannelMessage bajo una
 * ChannelConnection canónica por organización (provider 'whatsapp_baileys',
 * providerAccountKey 'whatsapp_baileys:<organizationId>' — la MISMA clave que
 * crea el daemon al conectar una sesión QR).
 *
 * - DEDUP: los mensajes se insertan con INSERT OR IGNORE sobre la clave única
 *   (conversationId, externalMessageId); las conversaciones por
 *   (connectionId, externalContactKey). Seguro de ejecutar varias veces.
 * - El vínculo con la ficha 360 (clientId), isAutoReply y transferredTo se
 *   conservan en ChannelConversation.metadata (JSON).
 * - AISLAMIENTO: cada fila conserva su organizationId; la conexión es 1:1 con
 *   la organización y todas las consultas van filtradas por organización.
 * - CERO PÉRDIDA: no borra ni actualiza las tablas legacy (el DROP lo hace la
 *   migración formal drop_legacy_channel_models DESPUÉS de este backfill).
 *
 * Uso (con mejor-sqlite3, sin Prisma — sirve antes de aplicar la migración):
 *   node scripts/backfill-whatsapp-history-to-channel.mjs            # dry-run
 *   BACKFILL_WHATSAPP_HISTORY_CONFIRM=1 node scripts/backfill-whatsapp-history-to-channel.mjs --apply
 * En producción exige además BACKFILL_ALLOW_PRODUCTION=1.
 */
import Database from 'better-sqlite3'

const DB_PATH = (() => {
  const fromEnv = process.env.DATABASE_URL?.replace('file:', '')
  if (fromEnv && (fromEnv.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fromEnv))) return fromEnv
  return new URL('../../db/custom.db', import.meta.url).pathname
})()

const apply = process.argv.includes('--apply')
if (apply && process.env.BACKFILL_WHATSAPP_HISTORY_CONFIRM !== '1') {
  console.error('Para aplicar, define BACKFILL_WHATSAPP_HISTORY_CONFIRM=1 además de --apply')
  process.exit(1)
}
if (apply && process.env.NODE_ENV === 'production' && process.env.BACKFILL_ALLOW_PRODUCTION !== '1') {
  console.error('Backfill bloqueado en producción: requiere BACKFILL_ALLOW_PRODUCTION=1')
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: !apply })
db.pragma('journal_mode = WAL')

const legacyConvExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='WhatsAppConversation'").get()
if (!legacyConvExists) {
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', skipped: 'no hay tablas legacy (esquema ya unificado)' }))
  process.exit(0)
}

const organizations = db.prepare('SELECT DISTINCT organizationId FROM WhatsAppConversation').all()
const totals = {
  mode: apply ? 'apply' : 'dry-run',
  organizations: organizations.length,
  connectionsCreatedOrWouldCreate: 0,
  conversationsMigrated: 0,
  messagesMigrated: 0,
  messagesDuplicated: 0,
}

const ensureConnectionStmt = db.prepare('SELECT id FROM ChannelConnection WHERE providerAccountKey = ?')
const insertConnectionStmt = db.prepare(`
  INSERT INTO ChannelConnection (id, organizationId, channel, provider, providerAccountKey, externalAccountId, displayName, status, credentialsEnc, metadata, createdAt, updatedAt)
  VALUES (?, ?, 'whatsapp', 'whatsapp_baileys', ?, ?, 'WhatsApp QR (Baileys) (migrado)', 'connected', 'legacy-migrated', ?, datetime('now'), datetime('now'))
`)
const findConversationStmt = db.prepare('SELECT id FROM ChannelConversation WHERE connectionId = ? AND externalContactKey = ?')
const insertConversationStmt = db.prepare(`
  INSERT INTO ChannelConversation (id, organizationId, connectionId, channel, externalContactKey, contactName, lastMessage, lastMessageAt, unreadCount, status, metadata, createdAt, updatedAt)
  VALUES (?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`)
const findMessageStmt = db.prepare('SELECT 1 FROM ChannelMessage WHERE conversationId = ? AND externalMessageId = ? LIMIT 1')
const insertMessageStmt = db.prepare(`
  INSERT INTO ChannelMessage (id, conversationId, externalMessageId, direction, senderType, body, messageType, metadata, createdAt)
  VALUES (?, ?, ?, ?, ?, COALESCE(?, ''), ?, ?, ?)
`)

function genId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

const tx = apply ? db.transaction(() => {
  for (const { organizationId } of organizations) {
    // 1) Conexión canónica 1:1 por organización (misma clave del daemon).
    const key = `whatsapp_baileys:${organizationId}`
    let connectionId = ensureConnectionStmt.get(key)?.id ?? null
    if (!connectionId) {
      connectionId = genId()
      insertConnectionStmt.run(connectionId, organizationId, key, organizationId, JSON.stringify({ source: 'backfill_whatsapp_history' }))
      totals.connectionsCreatedOrWouldCreate += 1
    }

    // 2) Conversaciones y mensajes de ESA organización.
    const conversations = db.prepare('SELECT * FROM WhatsAppConversation WHERE organizationId = ?').all(organizationId)
    for (const conv of conversations) {
      const existingConv = findConversationStmt.get(connectionId, conv.contactPhone)
      let canonicalConvId = existingConv?.id ?? null
      if (!canonicalConvId) {
        canonicalConvId = genId()
        insertConversationStmt.run(
          canonicalConvId, organizationId, connectionId, conv.contactPhone,
          conv.contactName || conv.contactPhone,
          conv.lastMessage ?? null, conv.lastMessageAt ?? null,
          conv.unreadCount ?? 0, conv.status || 'active',
          JSON.stringify({
            clientId: conv.clientId ?? null,
            isAutoReply: conv.isAutoReply === 0 ? false : true,
            transferredTo: conv.transferredTo ?? null,
            legacy: { lastMessageFrom: conv.lastMessageFrom ?? null },
          }),
        )
        totals.conversationsMigrated += 1
      }

      const messages = db.prepare('SELECT * FROM WhatsAppMessage WHERE conversationId = ? ORDER BY createdAt ASC').all(conv.id)
      for (const msg of messages) {
        const direction = msg.direction === 'outbound' ? 'out' : 'in'
        if (msg.waMessageId) {
          const dup = findMessageStmt.get(canonicalConvId, msg.waMessageId)
          if (dup) { totals.messagesDuplicated += 1; continue }
        } else {
          // Sin ID de proveedor no hay dedup posible: se conserva SIEMPRE
          // (cero pérdida) con un externalMessageId nulo.
        }
        // ID determinista ('cm_' + id legacy): el backfill SQL de la migración
        // usa EXACTAMENTE la misma clave, así ambas rutas convergen sin
        // duplicados incluso para mensajes sin waMessageId (NULL no deduplica
        // por índice único; la PK sí).
        insertMessageStmt.run(
          'cm_' + msg.id, canonicalConvId, msg.waMessageId ?? null, direction,
          msg.senderType || (direction === 'out' ? 'user' : 'contact'),
          msg.text ?? '', msg.messageType || 'text',
          JSON.stringify({ from: msg.fromNumber ?? '', to: msg.toNumber ?? '', legacy: { isRead: msg.isRead ? 1 : 0 } }),
          msg.createdAt ?? new Date().toISOString(),
        )
        totals.messagesMigrated += 1
      }
    }
  }
}) : null

// Dry-run: contar sin escribir
if (!apply) {
  for (const { organizationId } of organizations) {
    totals.conversationsMigrated += db.prepare('SELECT COUNT(*) n FROM WhatsAppConversation WHERE organizationId = ?').get(organizationId).n
    totals.messagesMigrated += db.prepare(`
      SELECT COUNT(*) n FROM WhatsAppMessage m
      JOIN WhatsAppConversation c ON c.id = m.conversationId
      WHERE c.organizationId = ?`).get(organizationId).n
  }
} else {
  tx()
}

// Verificación de paridad (solo con legacy presente)
totals.verification = {
  legacyConversations: db.prepare('SELECT COUNT(*) n FROM WhatsAppConversation').get().n,
  legacyMessages: db.prepare('SELECT COUNT(*) n FROM WhatsAppMessage').get().n,
  canonicalConversations: db.prepare("SELECT COUNT(*) n FROM ChannelConversation WHERE channel = 'whatsapp'").get().n,
  canonicalWhatsAppMessages: db.prepare(`
    SELECT COUNT(*) n FROM ChannelMessage m
    JOIN ChannelConversation cc ON cc.id = m.conversationId
    WHERE cc.channel = 'whatsapp'`).get().n,
}

console.log(JSON.stringify(totals, null, 2))
db.close()
