/** Siembra datos legacy realistas para validar la migración de unificación. */
import Database from 'better-sqlite3'

const db = new Database('/tmp/test-unif.db')
db.pragma('journal_mode = WAL')

const now = new Date().toISOString()
db.pragma('foreign_keys = OFF')

db.prepare(`INSERT INTO Organization (id, name, slug, plan, isActive, createdAt, updatedAt) VALUES ('org-a', 'Org A', 'org-a', 'pilot', 1, ?, ?)`).run(now, now)
db.prepare(`INSERT INTO Organization (id, name, slug, plan, isActive, createdAt, updatedAt) VALUES ('org-b', 'Org B', 'org-b', 'pilot', 1, ?, ?)`).run(now, now)
db.prepare(`INSERT INTO Settings (id, organizationId, currency, timezone, updatedAt) VALUES ('set-a', 'org-a', 'USD', 'America/Bogota', ?)`).run(now)

// Integration con Google + agentLeads + telegram (blob cifrado simulado)
db.prepare(`INSERT INTO Integration (id, organizationId, googleRefreshTokenEnc, googleClientJsonEnc, googleEmail, agentLeadsSecretEnc, enableGoogle, updatedAt)
  VALUES ('int-a', 'org-a', 'v1:google-refresh', 'v1:google-client', 'cuenta@orga.com', 'v1:agent-leads-secret', 1, ?)`).run(now)
// Integration SIN google (no debe crear fila GoogleIntegration)
db.prepare(`INSERT INTO Integration (id, organizationId, updatedAt) VALUES ('int-b', 'org-b', ?)`).run(now)

// WhatsAppConversation org-a ×2
db.prepare(`INSERT INTO WhatsAppConversation (id, organizationId, clientId, contactPhone, contactName, lastMessage, lastMessageAt, lastMessageFrom, unreadCount, isAutoReply, status, createdAt, updatedAt)
  VALUES ('waconv-1', 'org-a', 'client-a1', '573001110000', 'Ana', '¿Precio?', '2026-01-03T10:00:00Z', 'contact', 2, 1, 'active', '2026-01-01T09:00:00Z', '2026-01-03T10:00:00Z')`).run()
db.prepare(`INSERT INTO WhatsAppConversation (id, organizationId, contactPhone, contactName, unreadCount, isAutoReply, status, createdAt, updatedAt)
  VALUES ('waconv-2', 'org-a', '573002220000', 'Beto', 0, 0, 'closed', '2026-01-02T09:00:00Z', '2026-01-02T09:00:00Z')`).run()
db.prepare(`INSERT INTO WhatsAppConversation (id, organizationId, contactPhone, contactName, unreadCount, status, createdAt, updatedAt)
  VALUES ('waconv-3', 'org-b', '573003330000', 'Carla', 1, 'active', '2026-01-04T09:00:00Z', '2026-01-04T09:00:00Z')`).run()

// WhatsAppMessage ×5 (1 duplicado por waMessageId, 1 sin ID)
const ins = db.prepare(`INSERT INTO WhatsAppMessage (id, organizationId, conversationId, waMessageId, direction, fromNumber, toNumber, text, messageType, senderType, isRead, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, ?)`)
ins.run('wamsg-1', 'org-a', 'waconv-1', 'waid-1', 'inbound', '573001110000', 'biz', 'Hola', 'contact', 0, '2026-01-01T09:01:00Z')
ins.run('wamsg-2', 'org-a', 'waconv-1', 'waid-2', 'outbound', 'biz', '573001110000', 'Buenas, ¿en qué te ayudo?', 'user', 1, '2026-01-01T09:02:00Z')
ins.run('wamsg-3', 'org-a', 'waconv-1', 'waid-3', 'inbound', '573001110000', 'biz', '¿Precio?', 'contact', 0, '2026-01-03T10:00:00Z')
ins.run('wamsg-4', 'org-a', 'waconv-1', 'waid-3', 'inbound', '573001110000', 'biz', '¿Precio? (duplicado)', 'contact', 0, '2026-01-03T10:00:05Z')
ins.run('wamsg-5', 'org-a', 'waconv-2', null, 'outbound', 'biz', '573002220000', 'Cerramos', 'user', 1, '2026-01-02T09:00:00Z')
ins.run('wamsg-6', 'org-b', 'waconv-3', 'waid-b1', 'inbound', '573003330000', 'biz', 'Consulta org-b', 'contact', 0, '2026-01-04T09:00:30Z')

// WhatsAppConnection legada (debe morir; su parte canónica ya vive en ChannelConnection por el backfill TS)
db.prepare(`INSERT INTO WhatsAppConnection (id, organizationId, phoneNumberId, phoneNumber, accessTokenEnc, webhookVerifyToken, status, source, createdAt, updatedAt)
  VALUES ('waconn-1', 'org-a', '1555000111', '+1555000111', 'v1:cloud-token', 'verify-tok-1', 'connected', 'manual', ?, ?)`).run(now, now)

console.log('seed OK: 3 conversaciones, 6 mensajes, 2 integrations')
db.close()
