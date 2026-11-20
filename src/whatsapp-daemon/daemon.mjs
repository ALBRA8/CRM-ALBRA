#!/usr/bin/env node
/**
 * CRM ALBRA - WhatsApp Daemon (Baileys) — MULTI-ORGANIZACIÓN
 * Conexión por QR (protocolo WhatsApp Web) usando @whiskeysockets/baileys.
 * Corre como proceso separado en el puerto 3002 (WHATSAPP_DAEMON_URL).
 *
 * P0.1 ORDEN MAESTRA (fix/saas-security-and-stabilization):
 *  YA NO existe una sesión global compartida. Cada organización tiene su
 *  PROPIA sesión de WhatsApp con credenciales aisladas en .wa-auth/<orgId>/
 *  y su propio socket, estado, QR, teléfono, reintentos y errores.
 *
 *  - Toda operación (conectar, QR, estado, enviar, desconectar, conversaciones)
 *    recibe orgId y opera EXCLUSIVAMENTE sobre la sesión de esa organización.
 *  - Los eventos de una sesión (messages.upsert, reconexiones) están cerrados
 *    sobre SU orgId: un callback jamás escribe datos de otra organización.
 *  - /send exige orgId; el envío sin orgId (hosts standalone como WP/ULTRA)
 *    solo se admite cuando hay EXACTAMENTE UNA sesión conectada (ambiguación
 *    imposible). Con dos o más conectadas se rechaza con 409.
 *  - La migración del layout legado (una carpeta global) es un MOVIMIENTO a
 *    la carpeta de su organización: nunca se borra información de sesión.
 *
 * Arranque: npm run wa:daemon  ó  node src/whatsapp-daemon/daemon.mjs
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, fetchLatestBaileysVersion, downloadContentFromMessage, Browsers } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import qrcodeTerminal from 'qrcode-terminal'
import { createServer } from 'http'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { authDirFor, planBootRestore, decideUnscopedSend, validateOrgId } from './session-registry.mjs'
import { createCipheriv, createHash, randomBytes } from 'crypto'
import { ensureIdempotencyTable, reserveDaemonSend, markDaemonSendDone, markDaemonSendFailed } from './idempotency.mjs'
import { safeSecretEqual, normalizeOrigin, isOriginAllowed } from './security-helpers.mjs'
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, assertStreamLimit, isAllowedImageMime, normalizeMime, audioMediaKind } from './media-guard.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUTH_ROOT = join(__dirname, '.wa-auth') // raíz: una carpeta por organización dentro
const PORT = Number(process.env.WHATSAPP_DAEMON_PORT || 3002)
// (reparación 2026-11-17, FASE 1.C) el daemon escucha POR DEFECTO en 127.0.0.1:
// es un servicio interno (lo consume el servidor Next por localhost) y jamás
// debe quedar expuesto a la red. HOST admite override para despliegues
// específicos (p. ej. contenedor con proxy interno).
const HOST = process.env.HOST || '127.0.0.1'

// El daemon es un proceso Node independiente: carga el .env del proyecto para
// compartir DATABASE_URL e INTERNAL_API_SECRET con el servidor Next.js.
// (reparación 2026-11-17) ENV_FILE permite apuntar a OTRO archivo de entorno
// (pruebas herméticas con datos ficticios, instancias aisladas) sin tocar el
// .env real del proyecto.
try {
  process.loadEnvFile(process.env.ENV_FILE || join(__dirname, '..', '..', '.env'))
  console.log('[ENV] .env del proyecto cargado')
} catch {
  console.warn('[ENV] Sin .env en la raíz — usa variables de entorno del proceso')
}

// SEGURIDAD (auditoría crítica #2/#4): sin secreto interno no arranca.
// Evita que el daemon quede expuesto con una clave hardcodeada conocida.
// P0.4: además de longitud, RECHAZA valores de ejemplo/dummy conocidos
// (plantilla .env.example, marcadores REPLACE_WITH_*, dummies de CI).
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET
if (!INTERNAL_SECRET || INTERNAL_SECRET.length < 24) {
  console.error('[ENV] INTERNAL_API_SECRET no configurado (mínimo 24 caracteres). El daemon no arranca por seguridad.')
  process.exit(1)
}
const KNOWN_INSECURE_SECRETS = new Set([
  'cambia-esto-secreto-interno-daemon',
  'replace_with_strong_random_secret',
  'changeme',
  'change-me',
  'ci-dummy-internal-test-only-0123456789abcdef',
  'albra-dev-token',
])
if (KNOWN_INSECURE_SECRETS.has(INTERNAL_SECRET.trim().toLowerCase())) {
  console.error('[ENV] INTERNAL_API_SECRET es un valor de ejemplo/dummy conocido. El daemon no arranca: genera uno con `openssl rand -hex 32`.')
  process.exit(1)
}

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT] Error:', err.message)
})
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED] Rejection:', err)
})

// ============ Sessions (UNA POR ORGANIZACIÓN) ============
/**
 * Mapa orgId → sesión. Cada sesión posee TODO su estado sin compartirllo:
 *   { orgId, sock, status, qrCodeData, qrCodeText, phone, lastUpdate,
 *     lastError, retries, inFlight }
 * Ninguna operación acepta "la sesión global": o se nombra la organización,
 * o la política de /send sin orgId resuelve la única conectada (ver registry).
 */
const sessions = new Map()

function getOrCreateSession(orgId) {
  let s = sessions.get(orgId)
  if (!s) {
    s = {
      orgId,
      sock: null,
      status: 'disconnected', // disconnected | connecting | waiting_qr | qr_expired | connected
      qrCodeData: null,
      qrCodeText: null,
      qrGeneratedAt: null,
      qrExpiresAt: null,
      reconnectTimeout: null,
      phone: null,
      lastUpdate: null,
      lastError: null,
      retries: 0,
      inFlight: false,
    }
    sessions.set(orgId, s)
  }
  return s
}

function sessionList() {
  return [...sessions.values()].map((s) => ({
    orgId: s.orgId,
    status: s.status,
    phone: s.phone,
    lastUpdate: s.lastUpdate,
    lastError: s.lastError,
  }))
}

/** Agregado compatible con consumidores legacy (doctor, panel, proxy viejo). */
function aggregateStatus() {
  const list = [...sessions.values()]
  const connected = list.find((s) => s.status === 'connected')
  const pending = list.find((s) => s.status === 'connecting' || s.status === 'waiting_qr')
  const withError = list.find((s) => s.lastError)
  return {
    status: connected ? 'connected' : pending ? pending.status : 'disconnected',
    phone: connected?.phone ?? null,
    lastUpdate: connected?.lastUpdate ?? pending?.lastUpdate ?? null,
    orgLinked: list.length > 0,
    // Con exactamente una sesión se mantiene el contrato antiguo (linkedOrgId);
    // con varias, el campo único es ambiguo → null y el detalle vive en sessions[].
    linkedOrgId: list.length === 1 ? list[0].orgId : null,
    lastError: withError?.lastError ?? null,
  }
}

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
  // B2 residual: tabla aditiva de idempotencia para /send (sin DDL destructivo).
  ensureIdempotencyTable(db)
  console.log(`[DB] Connected to: ${DB_PATH}`)
} catch (err) {
  console.error('[DB] Failed to connect:', err.message)
}

function orgExists(orgId) {
  if (!db || !orgId) return false
  return !!db.prepare('SELECT id FROM Organization WHERE id = ?').get(orgId)
}

function generateId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

// ============ Modelo canónico (unificación de las 3 generaciones) ============
// El daemon YA NO escribe en WhatsAppConversation/WhatsAppMessage: escribe en
// ChannelConversation/ChannelMessage bajo una ChannelConnection canónica
// provider='whatsapp_baileys' por organización (una por org, una sola).

const BAILEYS_PROVIDER = 'whatsapp_baileys'

/** Cifrado AES-256-GCM formato v1 (mismo contrato que src/lib/crypto.ts). */
function encryptSecretV1(plain) {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.APP_SECRET
  if (!raw) return null
  try {
    const key = createHash('sha256').update(raw).digest()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
  } catch {
    return null
  }
}

function safeParseMetadata(raw) {
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

function metadataClientId(conv) {
  const meta = safeParseMetadata(conv?.metadata)
  return typeof meta.clientId === 'string' ? meta.clientId : null
}

/**
 * Crea o verifica la ChannelConnection canónica de la sesión Baileys de la
 * organización (channel='whatsapp', provider='whatsapp_baileys'). Idempotente:
 * la clave de proveedor es estable por organización. Devuelve el id de la
 * conexión o null (fail-closed sin bloquear el flujo del daemon).
 */
function ensureBaileysChannelConnection(orgId, phone) {
  if (!db || !orgId || !orgExists(orgId)) return null
  try {
    const key = `whatsapp_baileys:${orgId}`
    const credentialsEnc = encryptSecretV1(JSON.stringify({ provider: BAILEYS_PROVIDER, organizationId: orgId })) || 'daemon-managed'
    const existing = db.prepare('SELECT id, organizationId, channel, status FROM ChannelConnection WHERE providerAccountKey = ?').get(key)
    if (existing) {
      if (existing.organizationId !== orgId || existing.channel !== 'whatsapp') return null
      if (existing.status !== 'connected' || phone) {
        db.prepare("UPDATE ChannelConnection SET status = 'connected', externalAccountId = COALESCE(?, externalAccountId), credentialsEnc = ?, lastVerifiedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?")
          .run(phone || null, credentialsEnc, existing.id)
      }
      return existing.id
    }
    const id = generateId()
    db.prepare(`
      INSERT INTO ChannelConnection (id, organizationId, channel, provider, providerAccountKey, externalAccountId, displayName, status, credentialsEnc, metadata, createdAt, updatedAt)
      VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, 'connected', ?, ?, datetime('now'), datetime('now'))
    `).run(id, orgId, BAILEYS_PROVIDER, key, phone || orgId, 'WhatsApp QR (Baileys)', credentialsEnc, JSON.stringify({ source: 'daemon_baileys' }))
    db.prepare(`
      INSERT INTO ChannelConnectionEvent (id, organizationId, connectionId, type, detail, createdAt)
      VALUES (?, ?, ?, 'connected', 'whatsapp_baileys_session_connected', datetime('now'))
    `).run(generateId(), orgId, id)
    return id
  } catch (err) {
    console.error('[WA] No se pudo registrar la ChannelConnection canónica:', err?.message || err)
    return null
  }
}

/** Mapa la fila canónica al contrato que consume la página WhatsApp (daemon-proxy). */
function mapDaemonConversation(row) {
  const meta = safeParseMetadata(row.metadata)
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactPhone: row.externalContactKey,
    contactName: row.contactName,
    clientId: typeof meta.clientId === 'string' ? meta.clientId : null,
    clientName: row.clientName ?? null,
    lastMessage: row.lastMessage,
    lastMessageAt: row.lastMessageAt,
    lastMessageFrom: row.lastDirection === 'in' ? 'contact' : (row.lastSenderType || 'user'),
    unreadCount: row.unreadCount,
    isAutoReply: meta.isAutoReply !== false ? 1 : 0,
    status: row.status,
    transferredTo: typeof meta.transferredTo === 'string' ? meta.transferredTo : null,
    isAutoReplyMetadataStored: true,
  }
}

function getOrCreateConversation(orgId, contactPhone, contactName) {
  if (!db || !orgId) return null

  const connectionId = ensureBaileysChannelConnection(orgId, sessionPhone(orgId))
  if (!connectionId) return null

  let conv = db.prepare('SELECT * FROM ChannelConversation WHERE connectionId = ? AND externalContactKey = ?').get(connectionId, contactPhone)

  if (!conv) {
    // Busca o crea el cliente de la organización (mismo flujo que el legado)
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
    const metadata = JSON.stringify({ clientId: client.id, isAutoReply: true, transferredTo: null })
    db.prepare(`
      INSERT INTO ChannelConversation (id, organizationId, connectionId, channel, externalContactKey, contactName, lastMessage, lastMessageAt, unreadCount, status, metadata, createdAt, updatedAt)
      VALUES (?, ?, ?, 'whatsapp', ?, ?, NULL, datetime('now'), 0, 'active', ?, datetime('now'), datetime('now'))
    `).run(convId, orgId, connectionId, contactPhone, contactName || contactPhone, metadata)

    conv = { id: convId, organizationId: orgId, connectionId, clientId: client.id, externalContactKey: contactPhone, isAutoReply: 1, status: 'active', unreadCount: 0, metadata }
  } else {
    // Reactiva conversaciones cerradas al llegar un mensaje nuevo (como el legado)
    if (conv.status === 'closed') {
      db.prepare("UPDATE ChannelConversation SET status = 'active', updatedAt = datetime('now') WHERE id = ?").run(conv.id)
    }
  }

  return conv
}

function saveMessage(conversationId, orgId, direction, fromNumber, toNumber, text, senderType, waMessageId = null, messageType = 'text') {
  if (!db) return null

  // DEDUP (P0): Baileys puede re-entregar el mismo mensaje (y los salientes
  // que nosotros mismos guardamos vuelven por messages.upsert). Sin este
  // guard habría mensajes duplicados en el hilo y doble respuesta IA.
  if (waMessageId) {
    const dup = db.prepare('SELECT 1 FROM ChannelMessage WHERE conversationId = ? AND externalMessageId = ? LIMIT 1').get(conversationId, waMessageId)
    if (dup) return null
  }

  const msgId = generateId()
  const dir = direction === 'outbound' ? 'out' : 'in'
  db.prepare(`
    INSERT INTO ChannelMessage (id, conversationId, externalMessageId, direction, senderType, body, messageType, metadata, createdAt)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, ''), ?, ?, datetime('now'))
  `).run(
    msgId, conversationId, waMessageId, dir, senderType, text, messageType,
    JSON.stringify({ from: fromNumber, to: toNumber, ...(direction === 'outbound' ? { deliveryStatus: 'sent' } : {}) })
  )

  // Actualiza el último mensaje de la conversación (+no leído SOLO en entrantes)
  db.prepare(`
    UPDATE ChannelConversation
    SET lastMessage = substr(COALESCE(?, ''), 1, 100),
        lastMessageAt = datetime('now'),
        unreadCount = unreadCount + ?,
        updatedAt = datetime('now')
    WHERE id = ?
  `).run(text, dir === 'in' ? 1 : 0, conversationId)

  return msgId
}

// ============ Media (ASR y visión vía endpoints internos del CRM) ============
// El daemon solo descarga el media (Baileys) con TECHO DURO de bytes (port de
// fix/whatsapp-production-media): la transcripción vive en el servidor Next
// (POST /api/whatsapp/transcribe) y la descripción de imágenes en
// (POST /api/whatsapp/describe-image), ambos con X-Internal-Secret.

async function downloadWaAudio(content) {
  // audioMessage y pttMessage son tipo 'audio'; documento de audio va como 'document'
  const mediaType = audioMediaKind(content.mimetype)
  const stream = await downloadContentFromMessage(content, mediaType)
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    assertStreamLimit(total, MAX_AUDIO_BYTES, 'El audio')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Descarga una imagen de WhatsApp con allowlist de formato y techo de 8 MiB. */
async function downloadWaImage(content) {
  const mime = normalizeMime(content?.mimetype)
  if (!isAllowedImageMime(mime)) throw new Error('Formato de imagen no soportado')
  const stream = await downloadContentFromMessage(content, 'image')
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    assertStreamLimit(total, MAX_IMAGE_BYTES, 'La imagen')
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)
  if (!buffer.length) throw new Error('Imagen vacía')
  return { buffer, mime }
}

async function transcribeViaApi(audioBuffer, orgId) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const agentUrl = process.env.NEXT_APP_URL || 'http://localhost:3000'
  const res = await fetch(`${agentUrl}/api/whatsapp/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': internalSecret, 'X-WhatsApp-Org-Id': orgId },
    body: JSON.stringify({ audioBase64: audioBuffer.toString('base64'), mime: 'audio/ogg' }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`transcribe ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return (data.text || '').trim() || null
}

/** Visión vía el endpoint interno del CRM: la imagen se valida (magic bytes,
 * techo de píxeles) y se describe UNA vez; al agente solo llega TEXTO. */
async function describeImageViaApi(buffer, mime, orgId, caption) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const agentUrl = process.env.NEXT_APP_URL || 'http://localhost:3000'
  const res = await fetch(`${agentUrl}/api/whatsapp/describe-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': internalSecret },
    body: JSON.stringify({
      imageBase64: buffer.toString('base64'),
      mime,
      caption: caption ? String(caption).slice(0, 200) : undefined,
      orgId,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`describe-image ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return (data.text || '').trim() || null
}

/**
 * Reintento de conexión con backoff POR SESIÓN: 3s, 6s, 9s... hasta 15s.
 * El fallo de una organización NUNCA toca las sesiones de las demás.
 */
function scheduleReconnect(s, reason) {
  if (s.reconnectTimeout) {
    clearTimeout(s.reconnectTimeout)
    s.reconnectTimeout = null
  }
  // Si no está conectado y el QR no fue escaneado tras varios intentos, pausar
  // para no saturar a WhatsApp y no provocar bloqueos de IP (código 428).
  if (s.retries >= 3 && s.status !== 'connected') {
    s.status = 'qr_expired'
    s.lastError = 'El código QR expiró por inactividad. Haz clic en "Refrescar QR" para generar uno nuevo.'
    console.warn(`[WA:${s.orgId.slice(-6)}] Límite de reintentos alcanzado sin escaneo. Esperando acción del usuario.`)
    return
  }
  s.retries++
  const delay = Math.min(3000 * s.retries, 15000)
  if (reason) {
    s.lastError = reason
    console.warn(`[WA:${s.orgId.slice(-6)}] ${reason}`)
  }
  console.log(`[WA:${s.orgId.slice(-6)}] Reintento de conexión en ${delay / 1000}s (intento ${s.retries})...`)
  s.reconnectTimeout = setTimeout(() => {
    s.reconnectTimeout = null
    connectToWhatsApp(s.orgId).catch((err) => console.error('[WA] Error en reintento:', err?.message || err))
  }, delay)
}

/** Limpieza de UNA sesión: socket, estado y SOLO su carpeta de credenciales. */
function destroySession(s, { removeAuthDir = false } = {}) {
  if (s.reconnectTimeout) {
    clearTimeout(s.reconnectTimeout)
    s.reconnectTimeout = null
  }
  if (s.sock) {
    try { s.sock.end() } catch {}
    try { s.sock.removeAllListeners?.('connection.update') } catch {}
    try { s.sock.ev?.removeAllListeners?.('messages.upsert') } catch {}
    s.sock = null
  }
  s.status = 'disconnected'
  s.qrCodeData = null
  s.qrCodeText = null
  s.qrGeneratedAt = null
  s.qrExpiresAt = null
  s.phone = null
  s.lastError = null
  s.retries = 0
  sessions.delete(s.orgId)
  if (removeAuthDir) {
    try {
      const dir = authDirFor(AUTH_ROOT, s.orgId)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      console.error(`[WA:${s.orgId.slice(-6)}] No se pudo limpiar la carpeta de sesión:`, err?.message || err)
    }
  }
}

// ============ WhatsApp Connection (por organización) ============
async function connectToWhatsApp(orgId) {
  // P0.1: orgId obligatorio, seguro y con organización viva en BD.
  if (!validateOrgId(orgId)) throw new Error('orgId inválido')
  if (!orgExists(orgId)) throw new Error('Organización no encontrada')

  const s = getOrCreateSession(orgId)

  // Evitar duplicidad: si ya hay un intento en curso o ya está conectada, no
  // se crea un segundo socket para la misma organización.
  if (s.inFlight) return
  if (s.sock && s.status === 'connected') return

  if (s.reconnectTimeout) {
    clearTimeout(s.reconnectTimeout)
    s.reconnectTimeout = null
  }

  s.inFlight = true
  s.status = 'connecting'
  s.lastUpdate = new Date().toISOString()

  try {
  const dir = authDirFor(AUTH_ROOT, orgId)

  // Hardening: si la sesión no está verificada como conectada, comprobar creds.json en disco.
  // Si no hay un inicio de sesión completo previo, purgar archivos temporales residuales
  // para que el intercambio criptográfico del QR comience desde un estado limpio.
  const credsFile = join(dir, 'creds.json')
  let isLinkedOnDisk = false
  if (fs.existsSync(credsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credsFile, 'utf8'))
      if (parsed?.me?.id) isLinkedOnDisk = true
    } catch {}
  }
  if (!isLinkedOnDisk && fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }

  const { state, saveCreds } = await useMultiFileAuthState(dir) // eslint-disable-line react-hooks/rules-of-hooks

  // Versión de WhatsApp Web: con timeout de 3.5s para no congelar la UI si hay latencia externa.
  let version = null
  try {
    const fetchPromise = fetchLatestWaWebVersion().catch(() => fetchLatestBaileysVersion())
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
    const fetched = await Promise.race([fetchPromise, timeoutPromise])
    version = fetched?.version
    if (version) {
      console.log(`[WA:${orgId.slice(-6)}] Using WhatsApp Web version: ${version.join('.')}`)
    }
  } catch (err) {
    console.warn(`[WA:${orgId.slice(-6)}] No se pudo consultar la versión de WhatsApp Web; se usa la versión embebida de Baileys:`, err?.message || err)
  }

  // Logger silencioso (Baileys es muy verboso)
  const silentLogger = { level: 'silent', fatal: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {} }
  silentLogger.child = () => silentLogger

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: silentLogger,
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    qrTimeout: 40000,
  })
  s.sock = sock

  // TODOS los handlers están cerrados sobre `s` (y su orgId): el aislamiento
  // entre organizaciones no depende de variables globales.
  sock.ev.on('connection.update', async (update) => {
    // La sesión pudo ser desconectada mientras llegaba este evento:
    // si ya no es la socket viva de la sesión, ignorar el callback huérfano.
    if (s.sock !== sock) return
    const { connection, lastDisconnect, qr } = update
    s.lastUpdate = new Date().toISOString()

    if (qr) {
      s.status = 'waiting_qr'
      s.qrCodeText = qr
      s.qrGeneratedAt = Date.now()
      s.qrExpiresAt = Date.now() + 25000 // 25s de validez

      try {
        s.qrCodeData = await QRCode.toDataURL(qr, {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })
      } catch (err) {
        console.error('[WA] QR generation error:', err)
      }

      qrcodeTerminal.generate(qr, { small: true })
      console.log(`[WA:${orgId.slice(-6)}] QR Code generated - scan with WhatsApp`)
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(`[WA:${orgId.slice(-6)}] Connection closed. Status: ${statusCode}, Reconnect: ${shouldReconnect}`)

      if (statusCode === DisconnectReason.loggedOut) {
        // Logout: la sesión de ESA organización muere y se limpia SOLO su carpeta.
        destroySession(s, { removeAuthDir: true })
      } else {
        if (s.sock) {
          try { s.sock.end() } catch {}
          try { s.sock.removeAllListeners?.('connection.update') } catch {}
          try { s.sock.ev?.removeAllListeners?.('messages.upsert') } catch {}
          s.sock = null
        }
        s.status = 'disconnected'
        if (shouldReconnect) {
          scheduleReconnect(s, `Conexión cerrada (código ${statusCode ?? 'desconocido'}). Reintentando automáticamente.`)
        }
      }
    } else if (connection === 'open') {
      s.status = 'connected'
      s.qrCodeData = null
      s.qrCodeText = null
      s.qrGeneratedAt = null
      s.qrExpiresAt = null
      s.lastError = null
      s.retries = 0
      if (s.reconnectTimeout) {
        clearTimeout(s.reconnectTimeout)
        s.reconnectTimeout = null
      }
      console.log(`[WA:${orgId.slice(-6)}] Connected successfully!`)

      try {
        const me = sock.user
        if (me?.id) {
          s.phone = me.id.split(':')[0]
          console.log(`[WA:${orgId.slice(-6)}] Phone: ${s.phone}`)
        }
      } catch {}
      // Registro en el inventario canónico (ChannelConnection provider='whatsapp_baileys')
      ensureBaileysChannelConnection(orgId, s.phone || null)
    }
  })

  sock.ev.on('creds.update', saveCreds)

  // Registro de mensajes entrantes — SIEMPRE con la org de ESTA sesión.
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        // Ignora estados y grupos (antes de procesar contenido/media)
        const from = msg.key.remoteJid
        if (from === 'status@broadcast' || from.includes('@g.us')) continue

        // FIX auditoría pre-venta #1: mensajes que el DUEÑO envía desde el
        // teléfono vinculado (msg.key.fromMe). Antes se procesaban como si
        // fueran del cliente y el bot se auto-respondía frente al cliente
        // real. Ahora se registran como 'outbound' del vendedor (senderType
        // 'user', igual que la bandeja) para que queden en el historial que
        // ve la IA, pero NUNCA disparan auto-respuesta.
        const isOwner = !!msg.key.fromMe

        // FIX BARRERA 3 (GO explícito del operador, 2026-10-28): WhatsApp moderno
        // puede remitir chats 1:1 con un JID interno @lid en remoteJid. Responder a
        // LID@s.whatsapp.net apunta a una dirección inexistente y el envío se pierde
        // silenciosamente (log "Reply sent" sin entrega real). En mensajes entrantes
        // msg.key.senderPn trae el JID telefónico real del remitente: se usa como
        // destinatario. Fallback: remoteJid (comportamiento previo). Los mensajes del
        // dueño (fromMe) no cambian: su remitente es el propio negocio, no el contacto.
        const contactPhone = isOwner
          ? from.split('@')[0]
          : (msg.key.senderPn || from).split('@')[0]
        const contactName = isOwner ? contactPhone : (msg.pushName || contactPhone)
        const waMessageId = msg.key.id

        // P0.1: la org es la DUEÑA DE ESTA SESIÓN — no hay getOrgId() global.
        // Sin org de la sesión, el mensaje se descarta (fail-closed).
        const orgId = s.orgId
        if (!orgExists(orgId)) {
          console.warn(`[WA:${orgId.slice(-6)}] Mensaje descartado: la organización de esta sesión ya no existe.`)
          continue
        }

        let textContent = msg.message?.conversation ||
                          msg.message?.extendedTextMessage?.text ||
                          null
        let messageType = 'text'
        let voiceTranscribed = false // la IA solo responde a voz con transcripción
        let imageAnalyzed = false // igual para imágenes: solo con análisis real

        // Notas de voz (audioMessage/ptt/documento de audio): antes se descartaban
        // silenciosamente. Ahora se descargan (techo 25 MiB), se transcriben vía el
        // endpoint interno de ASR (con la org de la sesión) y se guardan como
        // messageType='voice'.
        // Imágenes (port de fix/whatsapp-production-media): se descargan con
        // allowlist de formato y techo de 8 MiB, se analizan UNA vez vía el
        // endpoint interno de visión y se guardan como messageType='image'.
        if (!textContent) {
          const audioContent = msg.message?.audioMessage ||
                               msg.message?.pttMessage ||
                               (msg.message?.documentMessage?.mimetype?.startsWith('audio/') ? msg.message.documentMessage : null)
          const imageContent = msg.message?.imageMessage ||
                               (msg.message?.documentMessage?.mimetype?.startsWith('image/') ? msg.message.documentMessage : null)

          if (audioContent) {
            messageType = 'voice'
            let transcribed = null
            try {
              const buf = await downloadWaAudio(audioContent)
              if (buf && buf.length > 0) transcribed = await transcribeViaApi(buf, orgId)
            } catch (err) {
              console.error('[WA] Nota de voz sin transcribir:', err?.message || err)
            }
            if (transcribed) {
              textContent = transcribed
              voiceTranscribed = true
              console.log(`[WA:${orgId.slice(-6)}] Nota de voz transcrita de ${contactPhone}: ${transcribed.substring(0, 50)}...`)
            } else {
              // Fail-open a humano: el mensaje NO se pierde; queda visible en la
              // bandeja para gestión manual y la IA no responde sola.
              textContent = '🎤 Nota de voz (no se pudo transcribir automáticamente)'
              console.warn(`[WA:${orgId.slice(-6)}] Nota de voz de ${contactPhone} guardada sin transcripción`)
            }
          } else if (imageContent) {
            messageType = 'image'
            let described = null
            try {
              const { buffer, mime } = await downloadWaImage(imageContent)
              described = await describeImageViaApi(buffer, mime, orgId, imageContent.caption)
            } catch (err) {
              console.error('[WA] Imagen sin analizar:', err?.message || err)
            }
            if (described) {
              textContent = `🖼 Imagen: ${described}`
              imageAnalyzed = true
              console.log(`[WA:${orgId.slice(-6)}] Imagen analizada de ${contactPhone}: ${described.substring(0, 50)}...`)
            } else {
              // Fail-open a humano, mismo patrón que la voz: el caption (si hay)
              // da contexto mínimo y la IA NO inventa una descripción.
              const caption = imageContent.caption ? String(imageContent.caption).slice(0, 200) : ''
              textContent = caption
                ? `🖼 Imagen (sin análisis automático), nota del cliente: "${caption}"`
                : '🖼 Imagen (no se pudo analizar automáticamente)'
              console.warn(`[WA:${orgId.slice(-6)}] Imagen de ${contactPhone} guardada sin análisis`)
            }
          } else {
            continue // ni texto ni audio ni imagen: se ignora como antes (stickers, etc.)
          }
        }

        console.log(`[WA:${orgId.slice(-6)}] ${isOwner ? 'Mensaje del dueño hacia' : 'Message from'} ${contactName} (${contactPhone}): ${textContent.substring(0, 50)}...`)

        const conv = getOrCreateConversation(orgId, contactPhone, contactName)
        if (!conv) continue

        saveMessage(
          conv.id, orgId,
          isOwner ? 'outbound' : 'inbound',
          isOwner ? (s.phone || '') : contactPhone,
          contactPhone,
          textContent,
          isOwner ? 'user' : 'contact',
          waMessageId,
          messageType
        )

        // Actualiza último contacto del cliente (solo con mensajes del cliente)
        const convClientId = metadataClientId(conv)
        if (!isOwner && convClientId && db) {
          db.prepare("UPDATE Client SET lastContactAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(convClientId)
        }

        // Auto-respuesta con IA si está habilitada (voz: solo si se transcribió;
        // imagen: solo si se analizó — el agente nunca inventa contenido de media).
        // JAMÁS para mensajes del dueño (fromMe): el bot no se responde a sí mismo.
        if (!isOwner && conv.isAutoReply && conv.status === 'active' && (
          (messageType !== 'voice' && messageType !== 'image') || voiceTranscribed || imageAnalyzed
        )) {
          console.log(`[WA:${orgId.slice(-6)}] Auto-reply enabled for ${contactPhone}, calling agent...`)
          // FIX BARRERA 3 complemento (mismo GO): WhatsApp no siempre incluye
          // senderPn en el key del mensaje (verificado con mensaje real 19:49 UTC).
          // El destinatario de la respuesta es entonces el JID ORIGINAL del
          // remitente (p. ej. ...@lid): la dirección exacta por la que WhatsApp
          // entregó el mensaje y sobre la que ya existe sesión cifrada.
          // senderPn (JID telefónico completo) mantiene prioridad si está presente.
          triggerAgentReply(orgId, conv, textContent, msg.key.senderPn || from)
        }
      } catch (err) {
        console.error('[WA] Error processing message:', err)
      }
    }
  })

  s.retries = 0
  } catch (err) {
    // Falta de red, auth corrupta, etc.: NUNCA dejar el status en 'connecting'.
    s.status = 'disconnected'
    s.sock = null
    scheduleReconnect(s, `No se pudo iniciar la conexión con WhatsApp: ${err?.message || err}`)
  } finally {
    s.inFlight = false
  }
}

// ============ Auto-Respuesta IA del CRM (workflow de canal) ============
async function triggerAgentReply(orgId, conv, messageText, replyJid) {
  try {
    const recentMsgs = db.prepare(`
      SELECT direction, body AS text, senderType FROM ChannelMessage
      WHERE conversationId = ?
      ORDER BY createdAt DESC LIMIT 20
    `).all(conv.id).reverse()

    const history = recentMsgs.map(m => ({
      role: m.direction === 'in' ? 'user' : 'assistant',
      content: m.text || ''
    }))

    // Llama a la auto-respuesta del CRM (Next.js) con el secreto interno del .env compartido
    const internalSecret = process.env.INTERNAL_API_SECRET
    const crmUrl = process.env.NEXT_APP_URL || 'http://localhost:3000'
    const response = await fetch(`${crmUrl}/api/whatsapp/auto-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        message: messageText,
        clientId: metadataClientId(conv),
        conversationHistory: history,
        source: 'whatsapp',
      }),
    })

    if (!response.ok) {
      console.error('[auto-reply] Error:', response.status)
      return
    }

    const data = await response.json()
    const replyText = data.reply || data.content || data.message

    if (!replyText) return

    await sendWhatsAppMessage(orgId, replyJid, replyText)
    saveMessage(conv.id, orgId, 'outbound', sessionPhone(orgId) || '', replyJid.split('@')[0], replyText, 'agent')

    console.log(`[auto-reply:${orgId.slice(-6)}] Reply sent to ${replyJid}: ${replyText.substring(0, 50)}...`)
  } catch (err) {
    console.error('[auto-reply] Auto-reply error:', err)
  }
}

// ============ Send Message (por organización) ============
function sessionPhone(orgId) {
  return sessions.get(orgId)?.phone ?? null
}

async function sendWhatsAppMessage(orgId, jid, text) {
  const s = sessions.get(orgId)
  if (!s || !s.sock || s.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  const waJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  const sent = await s.sock.sendMessage(waJid, { text })
  return sent
}

// ============ HTTP API Server ============
const server = createServer(async (req, res) => {
  // CORS restringido a mismo origen (el frontend pasa por el proxy de Next).
  // (reparación 2026-11-17, FASE 1.C) Validación EXACTA de origen: se parsea con
  // new URL(...).origin y se compara contra la lista permitida SIN prefijos.
  // El antiguo `origin.startsWith(permitido)` aceptaba orígenes maliciosos como
  // `http://localhost:3000.attacker.com`. Las llamadas servidor-a-servidor
  // (el proxy de Next) no envían Origin/Referer y no pasan por este filtro.
  const rawOrigin = req.headers.origin || req.headers.referer || ''
  const origin = normalizeOrigin(rawOrigin)
  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000']
  // origin === ''  → petición servidor-a-servidor sin Origin/Referer (proxy Next)
  // origin === null → header PRESENTE pero no parseable: RECHAZAR (no omitir)
  // origin válida  → coincidencia EXACTA contra la lista permitida
  if (rawOrigin && (origin === null || !isOriginAllowed(origin, allowedOrigins))) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'http://localhost:3000')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  // SEGURIDAD (auditoría crítica #2/#4): TODOS los métodos exigen el secreto
  // interno (antes los GET de lectura estaban abiertos y exponían conversaciones).
  // (reparación 2026-11-17, FASE 1.C) Comparación timing-safe vía SHA-256 de
  // longitud fija: ni el contenido ni la LONGITUD del secreto se filtran por tiempo.
  const providedAuth = req.headers.authorization?.replace('Bearer ', '') || ''

  if (req.method !== 'OPTIONS' && !safeSecretEqual(providedAuth, INTERNAL_SECRET)) {
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

  /**
   * P0.1 — resolución de organización para la operación.
   * Devuelve el orgId a usar o escribe la respuesta de error y devuelve null.
   * Reglas:
   *  - orgId explícito → validar formato seguro y existencia en BD.
   *  - sin orgId (hosts standalone) → SOLO si hay exactamente UNA sesión
   *    conectada (decideUnscopedSend). Con varias: 409. Con cero: 400.
   */
  function resolveOrgForWrite(body, res) {
    const explicit = typeof body?.orgId === 'string' ? body.orgId : (url.searchParams.get('orgId') || '')
    if (explicit) {
      if (!validateOrgId(explicit) || !orgExists(explicit)) {
        jsonResponse(res, { error: 'Organización no encontrada o identificador inválido' }, 400)
        return null
      }
      return explicit
    }
    const decision = decideUnscopedSend(sessionList())
    if (!decision.allow) {
      jsonResponse(res, { error: decision.reason }, decision.code)
      return null
    }
    return decision.orgId
  }

  try {
    if (req.method === 'GET' && path === '/status') {
      // Contrato legacy (status/phone/orgLinked/linkedOrgId) + detalle multi-org.
      // El proxy verifica la propiedad de la sesión con sessions[] por orgId.
      jsonResponse(res, { ...aggregateStatus(), sessions: sessionList() })
      return
    }

    if (req.method === 'GET' && path === '/qr') {
      // El QR es de UNA organización: se pide por orgId (o la única sesión).
      const requested = url.searchParams.get('orgId') || ''
      let orgId = null
      if (requested) {
        if (!validateOrgId(requested) || !orgExists(requested)) {
          jsonResponse(res, { error: 'Organización no encontrada o identificador inválido' }, 400)
          return
        }
        orgId = requested
      } else {
        const list = [...sessions.values()]
        if (list.length === 1) orgId = list[0].orgId
        else {
          jsonResponse(res, { error: 'orgId requerido para consultar el QR (aislamiento multi-tenant)' }, 400)
          return
        }
      }
      const s = sessions.get(orgId)
      if (!s) {
        jsonResponse(res, { status: 'disconnected', qr: null, orgId })
        return
      }
      if (s.status === 'connected') {
        jsonResponse(res, { status: 'connected', qr: null, phone: s.phone, orgId })
      } else if (s.status === 'qr_expired') {
        jsonResponse(res, { status: 'qr_expired', qr: null, orgId, message: s.lastError })
      } else if (s.qrCodeData) {
        const now = Date.now()
        const ttl = s.qrExpiresAt ? Math.max(0, Math.round((s.qrExpiresAt - now) / 1000)) : 25
        jsonResponse(res, {
          status: 'waiting_qr',
          qr: s.qrCodeData,
          qrText: s.qrCodeText,
          qrGeneratedAt: s.qrGeneratedAt || null,
          ttlSeconds: ttl,
          orgId,
        })
      } else {
        jsonResponse(res, { status: s.status, qr: null, orgId, lastError: s.lastError })
      }
      return
    }

    if (req.method === 'POST' && path === '/connect') {
      // P0.1: la sesión se crea PARA la organización pedida (orgId obligatorio).
      // Cada org tiene la suya: ya no existe el rebinding entre organizaciones.
      const body = await parseBody(req)
      const orgId = typeof body.orgId === 'string' ? body.orgId : ''
      if (!validateOrgId(orgId)) {
        jsonResponse(res, { error: 'orgId requerido: no se conecta una sesión de WhatsApp sin organización (aislamiento multi-tenant)' }, 400)
        return
      }
      if (!orgExists(orgId)) {
        jsonResponse(res, { error: 'Organización no encontrada' }, 400)
        return
      }
      const force = body.force === true
      const s = sessions.get(orgId)
      if (s && s.status === 'connected' && !force) {
        jsonResponse(res, { status: 'connected', phone: s.phone, orgId, orgLinked: true })
      } else if (s && !force && (s.inFlight || s.status === 'connecting' || s.status === 'waiting_qr')) {
        // Ya hay una conexión en curso para esta org: no duplicar sockets.
        jsonResponse(res, { status: s.status, message: 'La conexión de esta organización ya está en curso', orgId, orgLinked: true })
      } else {
        if (s && force) {
          destroySession(s, { removeAuthDir: true })
        }
        connectToWhatsApp(orgId).catch((err) => console.error('[WA] Error al conectar:', err?.message || err))
        jsonResponse(res, { status: 'connecting', message: 'Iniciando conexión...', orgId, orgLinked: true })
      }
      return
    }

    if ((req.method === 'POST' && (path === '/disconnect' || path === '/logout'))) {
      // Desconecta SOLO la sesión de la organización pedida. Fail-closed:
      // sin orgId no se toca NADA (ya no hay una sesión global que cerrar).
      const body = await parseBody(req)
      const orgId = typeof body.orgId === 'string' ? body.orgId : (url.searchParams.get('orgId') || '')
      if (!validateOrgId(orgId)) {
        jsonResponse(res, { error: 'orgId requerido: indica la organización de la sesión a desconectar' }, 400)
        return
      }
      const s = sessions.get(orgId)
      if (s) {
        // logout() lanza si el socket no llegó a abrirse: la limpieza SIEMPRE procede.
        if (s.sock) {
          try { await s.sock.logout() } catch (err) {
            console.warn(`[WA:${orgId.slice(-6)}] logout falló (se limpia igualmente):`, err?.message || err)
            try { s.sock.end() } catch {}
          }
        }
        destroySession(s, { removeAuthDir: true })
      } else {
        // Sin sesión viva: limpiar restos de credenciales de esa org si existen
        try {
          const dir = authDirFor(AUTH_ROOT, orgId)
          if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
        } catch {}
      }
      jsonResponse(res, { status: 'disconnected', message: 'WhatsApp desconectado', orgId })
      return
    }

    if (req.method === 'POST' && path === '/send') {
      const body = await parseBody(req)
      const { to, text } = body

      if (!to || !text) {
        jsonResponse(res, { error: 'to y text son requeridos' }, 400)
        return
      }

      // P0.1: el envío SIEMPRE resuelve primero la organización dueña de la
      // sesión por la que saldrá el mensaje. Jamás se usa el socket de otra org.
      const orgId = resolveOrgForWrite(body, res)
      if (!orgId) return

      // B2 residual (producción real F6): idempotencia PERSISTENTE por organización.
      // La clave llega en body.idempotencyKey o en el header X-Correlation-Id.
      // Reserva ANTES del envío; claves en curso/vencidas jamás reenvían.
      const idemKey = body.idempotencyKey || req.headers['x-correlation-id'] || null
      if (idemKey && db) {
        const reservation = reserveDaemonSend(db, orgId, idemKey, Date.now())
        if (reservation.action === 'in_flight') {
          jsonResponse(res, { status: 'IN_FLIGHT', message: 'Envío equivalente en curso con esta clave; no se reenvía.' }, 409)
          return
        }
        if (reservation.action === 'uncertain') {
          jsonResponse(res, { status: 'UNCERTAIN', message: 'Resultado previo desconocido (lease vencido); requiere reconciliación. No se reenvía automáticamente.', messageId: reservation.messageId ?? null }, 409)
          return
        }
        if (reservation.action === 'done') {
          jsonResponse(res, { success: true, messageId: reservation.messageId, orgId, deduplicated: true })
          return
        }
      }

      const s = sessions.get(orgId)
      if (!s || s.status !== 'connected') {
        if (idemKey && db) markDaemonSendFailed(db, orgId, idemKey, Date.now())
        jsonResponse(res, { error: `WhatsApp no conectado para la organización (${orgId.slice(-6)})` }, 400)
        return
      }

      let sent
      try {
        sent = await sendWhatsAppMessage(orgId, to, text)
      } catch (sendErr) {
        if (idemKey && db) markDaemonSendFailed(db, orgId, idemKey, Date.now())
        throw sendErr
      }
      if (idemKey && db) markDaemonSendDone(db, orgId, idemKey, sent?.key?.id ?? null, Date.now())

      // Persistencia del saliente (P0): las respuestas manuales de la bandeja
      // deben aparecer en el hilo. Antes /send enviaba y NO guardaba → el
      // historial quedaba incompleto para el vendedor y para la IA.
      if (db) {
        try {
          const digits = String(to).replace(/\D+/g, '')
          const connectionId = ensureBaileysChannelConnection(orgId, s.phone)
          let conv = null
          if (connectionId) {
            conv = db.prepare('SELECT id FROM ChannelConversation WHERE connectionId = ? AND externalContactKey = ?').get(connectionId, to)
            if (!conv && digits) {
              const candidates = db.prepare('SELECT id, externalContactKey FROM ChannelConversation WHERE connectionId = ?').all(connectionId)
              conv = candidates.find((c) => String(c.externalContactKey || '').replace(/\D+/g, '') === digits) || null
            }
          }
          if (!conv) {
            // Conversación/cliente nuevos: misma vía que los entrantes (round-robin NO aplica aquí; queda prospect)
            const contactName = body.contactName || to
            conv = getOrCreateConversation(orgId, to, contactName)
          }
          if (conv) {
            saveMessage(conv.id, orgId, 'outbound', s.phone || '', to, text, 'user', sent?.key?.id || null)
          }
        } catch (persistErr) {
          console.error('[WA] No se pudo persistir el mensaje saliente:', persistErr?.message || persistErr)
        }
      }

      jsonResponse(res, { success: true, messageId: sent?.key?.id, orgId })
      return
    }

    if (req.method === 'GET' && path === '/conversations') {
      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }
      // P0.1: FAIL-CLOSED — sin orgId no se devuelve NINGUNA conversación.
      // (Antes se respondía con la org de la sesión global.)
      const orgId = url.searchParams.get('orgId') || ''
      if (!validateOrgId(orgId)) {
        jsonResponse(res, { error: 'orgId requerido (aislamiento multi-tenant)' }, 400)
        return
      }
      const conversations = db.prepare(`
        SELECT c.id, c.organizationId, c.externalContactKey AS contactPhone, c.contactName,
               c.lastMessage, c.lastMessageAt, c.unreadCount, c.status, c.metadata,
               (SELECT m.direction FROM ChannelMessage m WHERE m.conversationId = c.id ORDER BY m.createdAt DESC LIMIT 1) AS lastDirection,
               (SELECT m.senderType FROM ChannelMessage m WHERE m.conversationId = c.id ORDER BY m.createdAt DESC LIMIT 1) AS lastSenderType,
               cl.name as clientName
        FROM ChannelConversation c
        LEFT JOIN Client cl ON json_extract(c.metadata, '$.clientId') = cl.id
        WHERE c.organizationId = ?
          AND c.connectionId IN (SELECT id FROM ChannelConnection WHERE organizationId = ? AND provider = 'whatsapp_baileys')
        ORDER BY c.lastMessageAt DESC
      `).all(orgId, orgId)
      jsonResponse(res, { conversations: conversations.map(mapDaemonConversation), orgId })
      return
    }

    if (req.method === 'GET' && path.startsWith('/conversations/')) {
      const convId = path.split('/conversations/')[1]
      if (!db) {
        jsonResponse(res, { error: 'DB not available' }, 500)
        return
      }

      // P0.1: el alcance es la organización que pide (orgId obligatorio).
      const orgId = url.searchParams.get('orgId') || ''
      if (!validateOrgId(orgId)) {
        jsonResponse(res, { error: 'orgId requerido (aislamiento multi-tenant)' }, 400)
        return
      }

      const conv = db.prepare(`
        SELECT c.id, c.organizationId, c.externalContactKey AS contactPhone, c.contactName,
               c.lastMessage, c.lastMessageAt, c.unreadCount, c.status, c.metadata,
               (SELECT m.direction FROM ChannelMessage m WHERE m.conversationId = c.id ORDER BY m.createdAt DESC LIMIT 1) AS lastDirection,
               (SELECT m.senderType FROM ChannelMessage m WHERE m.conversationId = c.id ORDER BY m.createdAt DESC LIMIT 1) AS lastSenderType,
               cl.name as clientName
        FROM ChannelConversation c
        LEFT JOIN Client cl ON json_extract(c.metadata, '$.clientId') = cl.id
        WHERE c.id = ? AND c.organizationId = ?
          AND c.connectionId IN (SELECT id FROM ChannelConnection WHERE organizationId = ? AND provider = 'whatsapp_baileys')
      `).get(convId, orgId, orgId)

      if (!conv) {
        jsonResponse(res, { error: 'Conversación no encontrada' }, 404)
        return
      }

      const messageRows = db.prepare(`
        SELECT * FROM ChannelMessage
        WHERE conversationId = ?
        ORDER BY createdAt ASC
      `).all(convId)
      const messages = messageRows.map((m) => {
        const meta = safeParseMetadata(m.metadata)
        return {
          id: m.id,
          conversationId: m.conversationId,
          waMessageId: m.externalMessageId,
          direction: m.direction === 'out' ? 'outbound' : 'inbound',
          fromNumber: typeof meta.from === 'string' ? meta.from : '',
          toNumber: typeof meta.to === 'string' ? meta.to : '',
          text: m.body,
          messageType: m.messageType,
          senderType: m.senderType,
          isRead: m.direction === 'out' ? 1 : 0,
          createdAt: m.createdAt,
        }
      })

      db.prepare("UPDATE ChannelConversation SET unreadCount = 0, updatedAt = datetime('now') WHERE id = ?").run(convId)

      jsonResponse(res, { conversation: { ...mapDaemonConversation(conv), messages } })
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
      if (body.isAutoReply !== undefined) updates.push('isAutoReply')
      if (body.status !== undefined) updates.push('status')
      if (body.transferredTo !== undefined) updates.push('transferredTo')
      if (updates.length > 0) {
        // Aislamiento multi-tenant (P0): el proxy envía orgId del JWT; el UPDATE
        // solo toca conversaciones de ESA organización. Sin esto, un usuario de
        // otra org podía pausar/alterar conversaciones ajenas por id directo.
        if (!body.orgId) {
          jsonResponse(res, { error: 'orgId requerido (aislamiento multi-tenant)' }, 400)
          return
        }
        const conv = db.prepare('SELECT id, metadata, status FROM ChannelConversation WHERE id = ? AND organizationId = ?').get(convId, body.orgId)
        if (!conv) {
          jsonResponse(res, { error: 'Conversación no encontrada' }, 404)
          return
        }
        const meta = safeParseMetadata(conv.metadata)
        if (body.isAutoReply !== undefined) meta.isAutoReply = !!body.isAutoReply
        if (body.transferredTo !== undefined) meta.transferredTo = body.transferredTo
        const setClauses = ['metadata = ?', "updatedAt = datetime('now')"]
        const setValues = [JSON.stringify(meta)]
        if (body.status !== undefined) {
          setClauses.push('status = ?')
          setValues.push(body.status)
        }
        setValues.push(convId)
        const out = db.prepare(`UPDATE ChannelConversation SET ${setClauses.join(', ')} WHERE id = ? AND organizationId = ?`).run(...setValues, body.orgId)
        if (!out || out.changes === 0) {
          jsonResponse(res, { error: 'Conversación no encontrada' }, 404)
          return
        }
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

// ============ Arranque: migración legado + restauración por organización ============

/**
 * Migración NO destructiva del layout legado (una sola carpeta global):
 * mueve los archivos de credenciales a .wa-auth/<orgId>/ y conserva el meta
 * antiguo renombrado (nunca se elimina información de sesión).
 */
function migrateLegacyAuthDir(orgId) {
  const target = authDirFor(AUTH_ROOT, orgId)
  try {
    fs.mkdirSync(target, { recursive: true })
    for (const name of fs.readdirSync(AUTH_ROOT)) {
      if (name === 'session-org.json' || validateOrgId(name)) continue // meta y carpetas por-org no se tocan
      const from = join(AUTH_ROOT, name)
      let isDir = false
      try { isDir = fs.statSync(from).isDirectory() } catch { continue }
      if (isDir) continue
      fs.renameSync(from, join(target, name))
    }
    const metaPath = join(AUTH_ROOT, 'session-org.json')
    if (fs.existsSync(metaPath)) {
      fs.renameSync(metaPath, join(AUTH_ROOT, 'migrated-session-org.json.bak'))
    }
    console.log(`[BOOT] Sesión legado migrada a .wa-auth/${orgId}/ (movimiento, sin borrado)`)
  } catch (err) {
    console.error('[BOOT] Migración legado falló (se continúa sin conectar la sesión legacy):', err?.message || err)
  }
}

function performBoot() {
  let rootIsDir = false
  let rootEntries = []
  let legacyMeta = null
  try {
    rootIsDir = fs.existsSync(AUTH_ROOT) && fs.statSync(AUTH_ROOT).isDirectory()
    if (rootIsDir) {
      rootEntries = fs.readdirSync(AUTH_ROOT)
      const metaPath = join(AUTH_ROOT, 'session-org.json')
      if (fs.existsSync(metaPath)) {
        try { legacyMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch { legacyMeta = null }
      }
    }
  } catch (err) {
    console.error('[BOOT] No se pudo inspeccionar .wa-auth/:', err?.message || err)
    return
  }

  const plan = planBootRestore({ rootEntries, rootIsDir, legacyOrgMeta: legacyMeta, orgExists })
  for (const note of plan.notes) console.log(`[BOOT] ${note}`)

  if (plan.migrate) migrateLegacyAuthDir(plan.migrate.to)

  // Restauración: cada organización con credenciales en disco recupera SU sesión.
  for (const orgId of plan.restore) {
    console.log(`[BOOT] Restaurando sesión de WhatsApp de la organización ${orgId}...`)
    connectToWhatsApp(orgId).catch((err) => console.error('[BOOT] Error restaurando sesión:', err?.message || err))
  }

  if (!rootIsDir || (plan.restore.length === 0 && !plan.migrate)) {
    console.log('[WA] No sessions found. Waiting for /connect requests...')
  }
}

// ============ Start ============
// (reparación 2026-11-17, FASE 1.C) Bind al HOST configurado (127.0.0.1 por
// defecto): el daemon NUNCA vuelve a exponerse en 0.0.0.0 por descuido.
server.listen(PORT, HOST, () => {
  console.log(`\n🟢 CRM ALBRA - WhatsApp Daemon (multi-organización)`)
  console.log(`   API: http://${HOST}:${PORT}`)
  console.log(`   Status: http://${HOST}:${PORT}/status`)
  console.log(`   Sesiones activas: ${sessions.size}\n`)
  performBoot()
})

// Graceful shutdown: cerrar TODAS las sesiones de todas las organizaciones.
process.on('SIGINT', () => {
  console.log('\n[WA] Shutting down...')
  for (const s of sessions.values()) {
    try { s.sock?.end() } catch {}
  }
  if (db) {
    db.close()
  }
  server.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n[WA] SIGTERM received, shutting down...')
  for (const s of sessions.values()) {
    try { s.sock?.end() } catch {}
  }
  if (db) db.close()
  server.close()
  process.exit(0)
})
