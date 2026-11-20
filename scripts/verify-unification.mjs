/** Verificación de cero pérdida tras la secuencia de unificación. */
import Database from 'better-sqlite3'

const db = new Database('/tmp/test-unif.db', { readonly: true })
const out = {}
out.legacyTablesLeft = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('Integration','WhatsAppConnection','WhatsAppConnectionEvent','WhatsAppConversation','WhatsAppMessage')").get().n
out.googleRows = db.prepare('SELECT COUNT(*) n FROM GoogleIntegration').get().n
out.googleEmail = db.prepare('SELECT googleEmail FROM GoogleIntegration LIMIT 1').get()?.googleEmail ?? null
out.agentLeadsInSettings = db.prepare("SELECT agentLeadsSecretEnc IS NOT NULL n FROM Settings WHERE organizationId='org-a'").get().n
out.connections = db.prepare('SELECT providerAccountKey, status FROM ChannelConnection ORDER BY providerAccountKey').all()
out.conversations = db.prepare("SELECT externalContactKey, unreadCount, status, json_extract(metadata,'$.clientId') AS clientId FROM ChannelConversation ORDER BY externalContactKey").all()
out.messages = db.prepare('SELECT externalMessageId, direction, body FROM ChannelMessage ORDER BY createdAt').all()
out.messageCount = db.prepare('SELECT COUNT(*) n FROM ChannelMessage').get().n
console.log(JSON.stringify(out, null, 2))
db.close()
