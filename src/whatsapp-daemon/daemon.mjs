#!/usr/bin/env node
/**
 * CRM ALBRA - WhatsApp Daemon
 * Conexión por QR (protocolo WhatsApp Web) usando @whiskeysockets/baileys
 * Corre como proceso separado en puerto 3002
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
const PORT = 3002

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

// ============ Database Helper ============
// We use better-sqlite3 directly to avoid Prisma overhead in the daemon
import Database from 'better-sqlite3'

// Resolve DB path portably: absolute DATABASE_URL wins; otherwise resolve
// relative to this file (src/whatsapp-daemon -> <project root>/db/custom.db),
// independent of the working directory the daemon is started from.
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

function getOrCreateConversation(userId, contactPhone, contactName) {
  if (!db) return null

  let conv = db.prepare('SELECT * FROM WhatsAppConversation WHERE userId = ? AND contactPhone = ?').get(userId, contactPhone)

  if (!conv) {
    // Find or create client
    let client = db.prepare('SELECT * FROM Client WHERE userId = ? AND phone = ?').get(userId, contactPhone)

    if (!client) {
      const clientId = generateId()
      db.prepare(`
        INSERT INTO Client (id, userId, name, phone, source, temperature, score, isActive, lastContactAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'whatsapp', 'Tibio', 10, 1, datetime('now'), datetime('now'), datetime('now'))
      `).run(clientId, userId, contactName || contactPhone, contactPhone)
      client = { id: clientId }
    }

    const convId = generateId()
    db.prepare(`
      INSERT INTO WhatsAppConversation (id, userId, clientId, contactPhone, contactName, lastMessage, lastMessageAt, lastMessageFrom, unreadCount, isAutoReply, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, NULL, datetime('now'), 'contact', 1, 1, 'active', datetime('now'), datetime('now'))
    `).run(convId, userId, client.id, contactPhone, contactName || contactPhone)

    conv = { id: convId, clientId: client.id, userId, contactPhone, contactName, isAutoReply: 1, status: 'active' }
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

function saveMessage(conversationId, userId, direction, fromNumber, toNumber, text, senderType, waMessageId = null) {
  if (!db) return null

  const msgId = generateId()
  db.prepare(`
    INSERT INTO WhatsAppMessage (id, conversationId, userId, waMessageId, direction, fromNumber, toNumber, text, messageType, senderType, isRead, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, datetime('now'))
  `).run(msgId, conversationId, userId, waMessageId, direction, fromNumber, toNumber, text, senderType, direction === 'outbound' ? 1 : 0)

  // Update conversation last message
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

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  // Create silent logger
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
      // Generate QR code
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

      // Also print to terminal
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
        // Clear auth files
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

      // Get connected phone number
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
        // Skip if no text content
        const textContent = msg.message?.conversation ||
                           msg.message?.extendedTextMessage?.text ||
                           null

        if (!textContent) continue

        // Skip status broadcasts and group messages
        const from = msg.key.remoteJid
        if (from === 'status@broadcast' || from.includes('@g.us')) continue

        const contactPhone = from.split('@')[0]
        const contactName = msg.pushName || contactPhone
        const waMessageId = msg.key.id

        console.log(`[WA] Message from ${contactName} (${contactPhone}): ${textContent.substring(0, 50)}...`)

        // Find userId - use the first user in DB (single-tenant for now)
        let userId = null
        if (db) {
          const user = db.prepare('SELECT id FROM User LIMIT 1').get()
          userId = user?.id
        }

        if (!userId) {
          console.warn('[WA] No user found in DB, skipping message')
          continue
        }

        // Get or create conversation
        const conv = getOrCreateConversation(userId, contactPhone, contactName)
        if (!conv) continue

        // Save inbound message
        saveMessage(conv.id, userId, 'inbound', contactPhone, connectedPhone || '', textContent, 'contact', waMessageId)

        // Update client last contact
        if (conv.clientId && db) {
          db.prepare('UPDATE Client SET lastContactAt = datetime(\'now\'), updatedAt = datetime(\'now\') WHERE id = ?').run(conv.clientId)
        }

        // Auto-reply with AI if enabled
        if (conv.isAutoReply && conv.status === 'active') {
          console.log(`[WA] Auto-reply enabled for ${contactPhone}, calling agent...`)
          triggerAgentReply(userId, conv, textContent, contactPhone)
        }
      } catch (err) {
        console.error('[WA] Error processing message:', err)
      }
    }
  })
}

// ============ Agent Auto-Reply ============
async function triggerAgentReply(userId, conv, messageText, contactPhone) {
  try {
    // Get recent messages for context
    const recentMsgs = db.prepare(`
      SELECT direction, text, senderType FROM WhatsAppMessage
      WHERE conversationId = ?
      ORDER BY createdAt DESC LIMIT 20
    `).all(conv.id).reverse()

    const history = recentMsgs.map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.text || ''
    }))

    // Call the agent API (internal request to Next.js)
    const internalSecret = process.env.INTERNAL_API_SECRET || 'crm-albra-internal-2024'
    const agentUrl = 'http://localhost:3000/api/chat'
    const response = await fetch(agentUrl, {
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

    // Send reply via WhatsApp
    await sendWhatsAppMessage(contactPhone, replyText)

    // Save outbound message
    saveMessage(conv.id, userId, 'outbound', connectedPhone || '', contactPhone, replyText, 'agent')

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
  // CORS - Restrict to same-origin only for security
  const origin = req.headers.origin || req.headers.referer || ''
  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000']
  const requestHost = req.headers.host || ''
  // Allow requests from same server or localhost
  if (origin && !allowedOrigins.some(o => origin.startsWith(o)) && !requestHost.startsWith('localhost') && !requestHost.startsWith('127.0.0.1')) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'http://localhost:3000')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // Verify internal secret for mutating operations
  const daemonSecret = process.env.INTERNAL_API_SECRET || 'crm-albra-internal-2024'
  const providedAuth = req.headers.authorization?.replace('Bearer ', '') || ''
  const urlSecret = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('secret')

  // Auth check: POST endpoints require secret, GET endpoints are open (read-only)
  if (req.method === 'POST' && providedAuth !== daemonSecret && urlSecret !== daemonSecret) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <secret> header or ?secret= param' }))
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
    // GET /status - Connection status
    if (req.method === 'GET' && path === '/status') {
      jsonResponse(res, {
        status: connectionStatus,
        phone: connectedPhone,
        lastUpdate: lastConnectionUpdate,
      })
      return
    }

    // GET /qr - Get QR code
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

    // POST /connect - Start connection (generate new QR)
    if (req.method === 'POST' && path === '/connect') {
      if (connectionStatus === 'connected') {
        jsonResponse(res, { status: 'connected', phone: connectedPhone })
      } else {
        connectToWhatsApp()
        jsonResponse(res, { status: 'connecting', message: 'Iniciando conexión...' })
      }
      return
    }

    // POST /disconnect - Disconnect
    if (req.method === 'POST' && path === '/disconnect') {
      if (sock) {
        await sock.logout()
        sock = null
      }
      connectionStatus = 'disconnected'
      qrCodeData = null
      qrCodeText = null
      connectedPhone = null

      // Clear auth files
      try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}

      jsonResponse(res, { status: 'disconnected', message: 'WhatsApp desconectado' })
      return
    }

    // POST /send - Send message
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

    // GET /conversations - List conversations
    if (req.method === 'GET' && path === '/conversations') {
      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }

      const userId = url.searchParams.get('userId')
      let query = `
        SELECT c.*, cl.name as clientName, cl.temperature as clientTemperature
        FROM WhatsAppConversation c
        LEFT JOIN Client cl ON c.clientId = cl.id
      `
      const params = []
      if (userId) {
        query += ' WHERE c.userId = ?'
        params.push(userId)
      }
      query += ' ORDER BY c.lastMessageAt DESC'

      const conversations = db.prepare(query).all(...params)
      jsonResponse(res, { conversations })
      return
    }

    // GET /conversations/:id - Get conversation with messages
    if (req.method === 'GET' && path.startsWith('/conversations/')) {
      const convId = path.split('/conversations/')[1]
      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }

      const conv = db.prepare(`
        SELECT c.*, cl.name as clientName, cl.temperature as clientTemperature
        FROM WhatsAppConversation c
        LEFT JOIN Client cl ON c.clientId = cl.id
        WHERE c.id = ?
      `).get(convId)

      if (!conv) {
        jsonResponse(res, { error: 'Conversación no encontrada' }, 404)
        return
      }

      const messages = db.prepare(`
        SELECT * FROM WhatsAppMessage
        WHERE conversationId = ?
        ORDER BY createdAt ASC
      `).all(convId)

      // Mark as read
      db.prepare('UPDATE WhatsAppMessage SET isRead = 1 WHERE conversationId = ? AND isRead = 0').run(convId)
      db.prepare('UPDATE WhatsAppConversation SET unreadCount = 0 WHERE id = ?').run(convId)

      jsonResponse(res, { conversation: { ...conv, messages } })
      return
    }

    // PUT /conversations/:id - Update conversation
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

    // 404
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

  // Auto-connect if session exists
  if (fs.existsSync(AUTH_DIR)) {
    console.log('[WA] Existing session found, connecting...')
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
