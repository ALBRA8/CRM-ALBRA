#!/usr/bin/env node
/**
 * CRM ALBRA - WhatsApp Daemon (Baileys)
 * Conexión por QR (protocolo WhatsApp Web) usando @whiskeysockets/baileys.
 * Corre como proceso separado en el puerto 3002 (WHATSAPP_DAEMON_URL).
 *
 * Adaptado al CRM multi-tenant: usa organizationId (no userId) y el esquema
 * Prisma actual (Client sin temperature/score, WhatsAppConversation/Message).
 *
 * Arranque: bun run wa:daemon  ó  node src/whatsapp-daemon/daemon.mjs
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import qrcodeTerminal from 'qrcode-terminal'
import { createServer } from 'http'
import { Boom } from '@hapi/boom'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = join(__dirname, '.wa-auth')
const PORT = Number(process.env.WHATSAPP_DAEMON_PORT || 3002)

// El daemon es un proceso Node independiente: carga el .env del proyecto para
// compartir DATABASE_URL e INTERNAL_API_SECRET con el servidor Next.js.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env'))
  console.log('[ENV] .env del proyecto cargado')
} catch {
  console.warn('[ENV] Sin .env en la raíz — usa variables de entorno del proceso')
}

// SEGURIDAD (auditoría crítica #2/#4): sin secreto interno no arranca.
// Evita que el daemon quede expuesto con una clave hardcodeada conocida.
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET
if (!INTERNAL_SECRET || INTERNAL_SECRET.length < 24) {
  console.error('[ENV] INTERNAL_API_SECRET no configurado (mínimo 24 caracteres). El daemon no arranca por seguridad.')
  process.exit(1)
}

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT] Error:', err.message)
})
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED] Rejection:', err)
})

// ============ State ============
let sock = null
let connectionStatus = 'disconnected' // disconnected, connecting, waiting_qr, connected
let qrCodeData = null // base64 QR image
let qrCodeText = null // raw QR string
let connectedPhone = null
let lastConnectionUpdate = null
let linkedOrgId = null // organización dueña de esta sesión de WhatsApp (multi-tenant)

// ============ Database Helper ============
// better-sqlite3 directo para evitar overhead de Prisma en el daemon
import Database from 'better-sqlite3'

// Ruta portable: DATABASE_URL absoluto gana; si es relativo, se resuelve
// contra la raíz del proyecto (src/whatsapp-daemon -> <root>/db/custom.db).
const DB_PATH = (() => {
  const fromEnv = process.env.DATABASE_URL?.replace('file:', '')
  if (fromEnv && (fromEnv.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fromEnv))) return fromEnv
  return join(__dirname, '..', '..', 'db', 'custom.db')
})()

let db = null
try {
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  console.log(`[DB] Connected to: ${DB_PATH}`)
} catch (err) {
  console.error('[DB] Failed to connect:', err.message)
}

/**
 * Organización dueña del número conectado.
 * SEGURIDAD (auditoría crítica #1 — fuga multi-tenant): YA NO se toma la primera
 * organización de la BD (SELECT ... LIMIT 1). La org se vincula explícitamente
 * cuando la sesión de WhatsApp se conecta desde la UI de una organización
 * (POST /connect { orgId }, validado contra la BD y persistido junto a la sesión).
 * Sin org vinculada, los mensajes entrantes NO se guardan (se avisa en el log).
 */
const ORG_META_FILE = join(AUTH_DIR, 'session-org.json')

function persistLinkedOrg(orgId) {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
    fs.writeFileSync(ORG_META_FILE, JSON.stringify({ orgId, linkedAt: new Date().toISOString() }))
  } catch (err) {
    console.error('[ORG] No se pudo persistir la vinculación de organización:', err.message)
  }
}

function loadLinkedOrgFromDisk() {
  try {
    if (fs.existsSync(ORG_META_FILE)) {
      const meta = JSON.parse(fs.readFileSync(ORG_META_FILE, 'utf8'))
      if (meta.orgId && orgExists(meta.orgId)) {
        linkedOrgId = meta.orgId
        console.log(`[ORG] Sesión previa vinculada a organización: ${linkedOrgId}`)
      }
    }
  } catch {}
}

function orgExists(orgId) {
  if (!db || !orgId) return false
  return !!db.prepare('SELECT id FROM Organization WHERE id = ?').get(orgId)
}

function getOrgId() {
  return linkedOrgId
}

function getOrCreateConversation(orgId, contactPhone, contactName) {
  if (!db || !orgId) return null

  let conv = db.prepare('SELECT * FROM WhatsAppConversation WHERE organizationId = ? AND contactPhone = ?').get(orgId, contactPhone)

  if (!conv) {
    // Busca o crea el cliente de la organización
    let client = db.prepare('SELECT id FROM Client WHERE organizationId = ? AND phone = ?').get(orgId, contactPhone)

    if (!client) {
      const clientId = generateId()
      db.prepare(`
        INSERT INTO Client (id, organizationId, name, phone, source, status, lastContactAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'whatsapp', 'prospect', datetime('now'), datetime('now'), datetime('now'))
      `).run(clientId, orgId, contactName || contactPhone, contactPhone)
      client = { id: clientId }
    }

    const convId = generateId()
    db.prepare(`
      INSERT INTO WhatsAppConversation (id, organizationId, clientId, contactPhone, contactName, lastMessage, lastMessageAt, lastMessageFrom, unreadCount, isAutoReply, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, NULL, datetime('now'), 'contact', 1, 1, 'active', datetime('now'), datetime('now'))
    `).run(convId, orgId, client.id, contactPhone, contactName || contactPhone)

    conv = { id: convId, clientId: client.id, organizationId: orgId, contactPhone, contactName, isAutoReply: 1, status: 'active' }
  } else {
    db.prepare(`
      UPDATE WhatsAppConversation
      SET unreadCount = unreadCount + 1,
          status = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
          updatedAt = datetime('now')
      WHERE id = ?
    `).run(conv.id)
  }

  return conv
}

function saveMessage(conversationId, orgId, direction, fromNumber, toNumber, text, senderType, waMessageId = null) {
  if (!db) return null

  const msgId = generateId()
  db.prepare(`
    INSERT INTO WhatsAppMessage (id, organizationId, conversationId, waMessageId, direction, fromNumber, toNumber, text, messageType, senderType, isRead, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, datetime('now'))
  `).run(msgId, orgId, conversationId, waMessageId, direction, fromNumber, toNumber, text, senderType, direction === 'outbound' ? 1 : 0)

  // Actualiza el último mensaje de la conversación
  const lastFrom = direction === 'inbound' ? 'contact' : senderType
  db.prepare(`
    UPDATE WhatsAppConversation
    SET lastMessage = ?, lastMessageAt = datetime('now'), lastMessageFrom = ?, updatedAt = datetime('now')
    WHERE id = ?
  `).run(text?.substring(0, 100), lastFrom, conversationId)

  return msgId
}

function generateId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

// ============ WhatsApp Connection ============
async function connectToWhatsApp() {
  connectionStatus = 'connecting'
  lastConnectionUpdate = new Date().toISOString()

  const { version } = await fetchLatestBaileysVersion()
  console.log(`[WA] Using Baileys version: ${version.join('.')}`)

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR) // eslint-disable-line react-hooks/rules-of-hooks

  // Logger silencioso (Baileys es muy verboso)
  const silentLogger = { level: 'silent', fatal: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {} }
  silentLogger.child = () => silentLogger

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: silentLogger,
    browser: ['CRM ALBRA', 'Chrome', '1.0.0'],
    connectTimeoutMs: 60000,
    qrTimeout: 120000,
  })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    lastConnectionUpdate = new Date().toISOString()

    if (qr) {
      connectionStatus = 'waiting_qr'
      qrCodeText = qr

      try {
        qrCodeData = await QRCode.toDataURL(qr, {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })
      } catch (err) {
        console.error('[WA] QR generation error:', err)
      }

      qrcodeTerminal.generate(qr, { small: true })
      console.log('[WA] QR Code generated - scan with WhatsApp')
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(`[WA] Connection closed. Status: ${statusCode}, Reconnect: ${shouldReconnect}`)

      if (statusCode === DisconnectReason.loggedOut) {
        connectionStatus = 'disconnected'
        qrCodeData = null
        qrCodeText = null
        connectedPhone = null
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true })
        } catch {}
      } else {
        connectionStatus = 'disconnected'
      }

      if (shouldReconnect) {
        console.log('[WA] Reconnecting in 3 seconds...')
        setTimeout(() => connectToWhatsApp(), 3000)
      }
    } else if (connection === 'open') {
      connectionStatus = 'connected'
      qrCodeData = null
      qrCodeText = null
      console.log('[WA] Connected successfully!')

      try {
        const me = sock.user
        if (me?.id) {
          connectedPhone = me.id.split(':')[0]
          console.log(`[WA] Phone: ${connectedPhone}`)
        }
      } catch {}
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        const textContent = msg.message?.conversation ||
                           msg.message?.extendedTextMessage?.text ||
                           null

        if (!textContent) continue

        // Ignora estados y grupos
        const from = msg.key.remoteJid
        if (from === 'status@broadcast' || from.includes('@g.us')) continue

        const contactPhone = from.split('@')[0]
        const contactName = msg.pushName || contactPhone
        const waMessageId = msg.key.id

        console.log(`[WA] Message from ${contactName} (${contactPhone}): ${textContent.substring(0, 50)}...`)

        const orgId = getOrgId()
        if (!orgId) {
          console.warn('[WA] Mensaje descartado: la sesión no está vinculada a ninguna organización. Reconecta WhatsApp desde Configuración → WhatsApp para vincularla.')
          continue
        }

        const conv = getOrCreateConversation(orgId, contactPhone, contactName)
        if (!conv) continue

        saveMessage(conv.id, orgId, 'inbound', contactPhone, connectedPhone || '', textContent, 'contact', waMessageId)

        // Actualiza último contacto del cliente
        if (conv.clientId && db) {
          db.prepare("UPDATE Client SET lastContactAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(conv.clientId)
        }

        // Auto-respuesta con IA si está habilitada
        if (conv.isAutoReply && conv.status === 'active') {
          console.log(`[WA] Auto-reply enabled for ${contactPhone}, calling agent...`)
          triggerAgentReply(orgId, conv, textContent, contactPhone)
        }
      } catch (err) {
        console.error('[WA] Error processing message:', err)
      }
    }
  })
}

// ============ Agent Auto-Reply ============
async function triggerAgentReply(orgId, conv, messageText, contactPhone) {
  try {
    const recentMsgs = db.prepare(`
      SELECT direction, text, senderType FROM WhatsAppMessage
      WHERE conversationId = ?
      ORDER BY createdAt DESC LIMIT 20
    `).all(conv.id).reverse()

    const history = recentMsgs.map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.text || ''
    }))

    // Llama al agente del CRM (Next.js) con el secreto interno del .env compartido
    const internalSecret = process.env.INTERNAL_API_SECRET
    const agentUrl = process.env.NEXT_APP_URL || 'http://localhost:3000'
    const response = await fetch(`${agentUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        message: messageText,
        clientId: conv.clientId,
        conversationHistory: history,
        source: 'whatsapp',
      }),
    })

    if (!response.ok) {
      console.error('[Agent] Error:', response.status)
      return
    }

    const data = await response.json()
    const replyText = data.content || data.message

    if (!replyText) return

    await sendWhatsAppMessage(contactPhone, replyText)
    saveMessage(conv.id, orgId, 'outbound', connectedPhone || '', contactPhone, replyText, 'agent')

    console.log(`[Agent] Reply sent to ${contactPhone}: ${replyText.substring(0, 50)}...`)
  } catch (err) {
    console.error('[Agent] Auto-reply error:', err)
  }
}

// ============ Send Message ============
async function sendWhatsAppMessage(jid, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  const waJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  const sent = await sock.sendMessage(waJid, { text })
  return sent
}

// ============ HTTP API Server ============
const server = createServer(async (req, res) => {
  // CORS restringido a mismo origen (el frontend pasa por el proxy de Next)
  const origin = req.headers.origin || req.headers.referer || ''
  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000']
  const requestHost = req.headers.host || ''
  if (origin && !allowedOrigins.some(o => origin.startsWith(o)) && !requestHost.startsWith('localhost') && !requestHost.startsWith('127.0.0.1')) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'http://localhost:3000')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // SEGURIDAD (auditoría crítica #2/#4): TODOS los métodos exigen el secreto
  // interno (antes los GET de lectura estaban abiertos y exponían conversaciones).
  const providedAuth = req.headers.authorization?.replace('Bearer ', '') || ''

  if (req.method !== 'OPTIONS' && providedAuth !== INTERNAL_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <INTERNAL_API_SECRET> header' }))
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  try {
    if (req.method === 'GET' && path === '/status') {
      jsonResponse(res, { status: connectionStatus, phone: connectedPhone, lastUpdate: lastConnectionUpdate, orgLinked: !!linkedOrgId })
      return
    }

    if (req.method === 'GET' && path === '/qr') {
      if (connectionStatus === 'connected') {
        jsonResponse(res, { status: 'connected', qr: null, phone: connectedPhone })
      } else if (qrCodeData) {
        jsonResponse(res, { status: 'waiting_qr', qr: qrCodeData, qrText: qrCodeText })
      } else {
        jsonResponse(res, { status: connectionStatus, qr: null })
      }
      return
    }

    if (req.method === 'POST' && path === '/connect') {
      // Vinculación multi-tenant: el proxy (con sesión JWT de una org) indica a qué
      // organización pertenece esta sesión de WhatsApp. Se valida contra la BD.
      const body = await parseBody(req)
      if (body.orgId) {
        if (!orgExists(body.orgId)) {
          jsonResponse(res, { error: 'Organización no encontrada' }, 400)
          return
        }
        linkedOrgId = body.orgId
        persistLinkedOrg(linkedOrgId)
        console.log(`[ORG] Sesión vinculada a organización: ${linkedOrgId}`)
      } else if (!linkedOrgId) {
        jsonResponse(res, { error: 'orgId requerido: no se conecta una sesión de WhatsApp sin organización (aislamiento multi-tenant)' }, 400)
        return
      }
      if (connectionStatus === 'connected') {
        jsonResponse(res, { status: 'connected', phone: connectedPhone, orgLinked: true })
      } else {
        connectToWhatsApp()
        jsonResponse(res, { status: 'connecting', message: 'Iniciando conexión...', orgLinked: true })
      }
      return
    }

    if (req.method === 'POST' && path === '/disconnect') {
      if (sock) {
        await sock.logout()
        sock = null
      }
      connectionStatus = 'disconnected'
      qrCodeData = null
      qrCodeText = null
      connectedPhone = null
      linkedOrgId = null
      try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
      jsonResponse(res, { status: 'disconnected', message: 'WhatsApp desconectado' })
      return
    }

    if (req.method === 'POST' && path === '/send') {
      const body = await parseBody(req)
      const { to, text } = body

      if (!to || !text) {
        jsonResponse(res, { error: 'to y text son requeridos' }, 400)
        return
      }
      if (connectionStatus !== 'connected') {
        jsonResponse(res, { error: 'WhatsApp no conectado' }, 400)
        return
      }

      const sent = await sendWhatsAppMessage(to, text)
      jsonResponse(res, { success: true, messageId: sent?.key?.id })
      return
    }

    if (req.method === 'GET' && path === '/conversations') {
      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }
      const orgId = getOrgId()
      if (!orgId) {
        jsonResponse(res, { conversations: [], orgLinked: false })
        return
      }
      const conversations = db.prepare(`
        SELECT c.*, cl.name as clientName
        FROM WhatsAppConversation c
        LEFT JOIN Client cl ON c.clientId = cl.id
        WHERE c.organizationId = ?
        ORDER BY c.lastMessageAt DESC
      `).all(orgId)
      jsonResponse(res, { conversations })
      return
    }

    if (req.method === 'GET' && path.startsWith('/conversations/')) {
      const convId = path.split('/conversations/')[1]
      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }

      const conv = db.prepare(`
        SELECT c.*, cl.name as clientName
        FROM WhatsAppConversation c
        LEFT JOIN Client cl ON c.clientId = cl.id
        WHERE c.id = ? AND c.organizationId = ?
      `).get(convId, getOrgId())

      if (!conv) {
        jsonResponse(res, { error: 'Conversación no encontrada' }, 404)
        return
      }

      const messages = db.prepare(`
        SELECT * FROM WhatsAppMessage
        WHERE conversationId = ?
        ORDER BY createdAt ASC
      `).all(convId)

      db.prepare('UPDATE WhatsAppMessage SET isRead = 1 WHERE conversationId = ? AND isRead = 0').run(convId)
      db.prepare('UPDATE WhatsAppConversation SET unreadCount = 0 WHERE id = ?').run(convId)

      jsonResponse(res, { conversation: { ...conv, messages } })
      return
    }

    if (req.method === 'PUT' && path.startsWith('/conversations/')) {
      const convId = path.split('/conversations/')[1]
      const body = await parseBody(req)

      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }

      const updates = []
      const values = []
      if (body.isAutoReply !== undefined) {
        updates.push('isAutoReply = ?')
        values.push(body.isAutoReply ? 1 : 0)
      }
      if (body.status !== undefined) {
        updates.push('status = ?')
        values.push(body.status)
      }
      if (body.transferredTo !== undefined) {
        updates.push('transferredTo = ?')
        values.push(body.transferredTo)
      }
      if (updates.length > 0) {
        updates.push("updatedAt = datetime('now')")
        values.push(convId)
        db.prepare(`UPDATE WhatsAppConversation SET ${updates.join(', ')} WHERE id = ?`).run(...values)
      }

      jsonResponse(res, { success: true })
      return
    }

    jsonResponse(res, { error: 'Not found' }, 404)
  } catch (err) {
    console.error('[HTTP] Error:', err)
    jsonResponse(res, { error: err.message }, 500)
  }
})

function jsonResponse(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

// ============ Start ============
server.listen(PORT, () => {
  console.log(`\n🟢 CRM ALBRA - WhatsApp Daemon`)
  console.log(`   API: http://localhost:${PORT}`)
  console.log(`   Status: http://localhost:${PORT}/status`)
  console.log(`   QR: http://localhost:${PORT}/qr\n`)

  // Auto-conecta si existe sesión previa (restaurando la org vinculada)
  if (fs.existsSync(AUTH_DIR)) {
    console.log('[WA] Existing session found, connecting...')
    loadLinkedOrgFromDisk()
    if (!linkedOrgId) console.warn('[ORG] Sesión previa SIN organización vinculada — los mensajes entrantes se descartarán hasta reconectar desde la UI')
    connectToWhatsApp()
  } else {
    console.log('[WA] No session found. Waiting for /connect request...')
    connectionStatus = 'disconnected'
  }
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[WA] Shutting down...')
  if (sock) {
    sock.end()
  }
  if (db) {
    db.close()
  }
  server.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n[WA] SIGTERM received, shutting down...')
  if (sock) sock.end()
  if (db) db.close()
  server.close()
  process.exit(0)
})
