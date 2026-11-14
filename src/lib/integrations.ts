import { createHmac, timingSafeEqual, randomBytes } from 'crypto'
import { db } from './db'
import { assignLeadRoundRobin } from './lead-routing'
import { decryptSecret, encryptSecret } from './crypto'
import type { Integration } from '@prisma/client'

/**
 * Helpers compartidos de integraciones (Telegram / Instagram / WhatsApp / Google).
 * - Fila Integration por organización (get-or-create)
 * - Normalización de clientes de canales (find-or-create por teléfono/ID de plataforma)
 * - Validación de firmas de webhooks (Meta X-Hub-Signature-256, Telegram secret token)
 * - Envío por APIs oficiales (WhatsApp Cloud, Telegram Bot, Instagram Graph) con degradación elegante
 */

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/[^\d+]/g, '')
}

/** Obtiene (o crea) la fila Integration de la organización */
export async function getIntegration(orgId: string): Promise<Integration> {
  const existing = await db.integration.findUnique({ where: { organizationId: orgId } })
  if (existing) return existing
  return db.integration.create({ data: { organizationId: orgId } })
}

/**
 * Estado de Telegram guardado como JSON cifrado en telegramBotTokenEnc
 * (el schema no tiene campos extra; un solo blob cifrado = token + metadata).
 */
export interface TelegramState {
  token?: string
  botUsername?: string
  autoReply?: boolean
}

export function parseTelegramState(enc: string | null | undefined): TelegramState {
  const raw = decryptSecret(enc)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as TelegramState
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return {}
  } catch {
    // valor legacy: token plano
    return { token: raw }
  }
}

export function encodeTelegramState(state: TelegramState): string | null {
  return encryptSecret(JSON.stringify(state))
}

/** All channel auto-replies are opt-in globally; tenant preferences can further disable them. */
export function isChannelAutoReplyGloballyEnabled(): boolean {
  return process.env.CHANNEL_AUTOREPLY_ENABLED === 'true'
}

export function isTelegramAutoReplyEnabled(state: TelegramState): boolean {
  return isChannelAutoReplyGloballyEnabled() && state.autoReply !== false && !!state.token
}

/**
 * Estado de Instagram guardado como JSON cifrado en instagramTokenEnc:
 * { token, webhookVerifyToken, webhookSecret, metaAppId }
 */
export interface InstagramState {
  token?: string
  webhookVerifyToken?: string
  /** App Secret de Meta: HMAC del webhook y client_secret del OAuth */
  webhookSecret?: string
  /** App ID público de la app de Meta (client_id del OAuth "Conectar mediante Meta") */
  metaAppId?: string
}

export function parseInstagramState(enc: string | null | undefined): InstagramState {
  const raw = decryptSecret(enc)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as InstagramState
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return { token: raw }
  } catch {
    return { token: raw }
  }
}

export function encodeInstagramState(state: InstagramState): string | null {
  return encryptSecret(JSON.stringify(state))
}

/**
 * Estado de Facebook guardado como JSON cifrado en facebookTokenEnc:
 * { pageToken, webhookVerifyToken, pageId?, pageName?, userEmail? }.
 * El App Secret de Meta (HMAC del webhook) vive cifrado en metaAppSecretEnc y se
 * comparte con Instagram (misma app). pageId/pageName/userEmail los registra el
 * OAuth "Conectar mediante Meta" (quedan como base de un futuro selector de
 * Página multi-página; la activa siempre la primera).
 */
export interface FacebookState {
  pageToken?: string
  webhookVerifyToken?: string
  pageId?: string
  pageName?: string
  userEmail?: string
}

export function parseFacebookState(enc: string | null | undefined): FacebookState {
  const raw = decryptSecret(enc)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as FacebookState
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return { pageToken: raw }
  } catch {
    return { pageToken: raw }
  }
}

export function encodeFacebookState(state: FacebookState): string | null {
  return encryptSecret(JSON.stringify(state))
}

/**
 * Base URL de la Graph API de Meta. Override SOLO para pruebas E2E con mock local
 * (META_GRAPH_BASE); en producción siempre la oficial.
 */
export function metaGraphBase(): string {
  const base = (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/+$/, '')
  return base
}

/**
 * Base URL del diálogo OAuth de Meta. Override SOLO para pruebas E2E con mock
 * local (META_DIALOG_BASE); en producción siempre la oficial.
 */
export function metaDialogBase(): string {
  const base = (process.env.META_DIALOG_BASE || 'https://www.facebook.com').replace(/\/+$/, '')
  return base
}

/** Versión de la Graph API usada por todas las llamadas Meta del CRM. */
export const META_GRAPH_VERSION = 'v21.0'

/** Comparación estricta en tiempo constante */
export function safeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Valida la firma X-Hub-Signature-256 de Meta sobre el body crudo */
export function verifyMetaSignature(rawBody: string, appSecret: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const received = signatureHeader.slice('sha256='.length)
  try {
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(received, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Encuentra o crea el cliente asociado a un contacto de canal externo.
 * El `platformKey` (ej: "573001234567", "tg:12345", "ig:98765") se guarda en phone
 * para poder deduplicar en siguientes mensajes. Siempre aislado por organización.
 */
export async function findOrCreateChannelClient(opts: {
  orgId: string
  platformKey: string
  name?: string | null
  source: string
}): Promise<{ id: string; name: string; phone: string | null } | null> {
  const { orgId, platformKey, name, source } = opts
  if (!platformKey) return null
  const existing = await db.client.findFirst({
    where: { organizationId: orgId, phone: platformKey },
    select: { id: true, name: true, phone: true },
  })
  if (existing) return existing
  let created: { id: string; name: string; phone: string | null; assignedToId?: string | null }
  try {
    created = await db.client.create({
      data: {
        organizationId: orgId,
        name: (name || '').trim() || `Contacto ${platformKey}`,
        phone: platformKey,
        status: 'prospect',
        source,
        // Fase 2: leads de WhatsApp/Telegram/Instagram/landing entran al round-robin
        assignedToId: await assignLeadRoundRobin(orgId),
        lastContactAt: new Date(),
      },
      select: { id: true, name: true, phone: true, assignedToId: true },
    })
  } catch (err) {
    // (A2-21, auditoría 2026-11-11) Carrera benigna: dos webhooks concurrentes
    // del MISMO contacto se pasan el findFirst mutuamente y ambos intentan
    // crear. Con el índice único parcial (organizationId, phone) el perdedor
    // recibe P2002 → re-leer al ganador en vez de 500 (Meta reintentaría y
    // duplicaría timeline/respuestas). Sin índice, el catch es inocuo.
    if ((err as { code?: string } | null)?.code === 'P2002') {
      const winner = await db.client.findFirst({
        where: { organizationId: orgId, phone: platformKey },
        select: { id: true, name: true, phone: true },
      })
      if (winner) return winner
    }
    throw err
  }
  // El workflow engine reacciona a nuevos leads de canales
  try {
    const { runWorkflowsForTrigger } = await import('./workflow-engine')
    await runWorkflowsForTrigger({
      orgId,
      type: 'client_created',
      payload: { ...created, source } as Record<string, unknown>,
    })
  } catch (err) {
    console.error('[integrations] workflow client_created falló', err)
  }
  return created
}

/** Envío vía WhatsApp Cloud API (Graph). Devuelve null si no está configurado/falló. */
export async function sendWhatsAppCloud(opts: {
  token: string
  phoneId: string
  to: string
  text: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${metaGraphBase()}/v21.0/${encodeURIComponent(opts.phoneId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: opts.to.replace(/[^\d]/g, ''),
        type: 'text',
        text: { preview_url: false, body: opts.text.slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } }
    if (res.ok && data?.messages?.[0]?.id) return { ok: true, id: data.messages[0].id }
    return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Envío vía Telegram Bot API. Devuelve null-ish con error si falla. */
export async function sendTelegramBotMessage(opts: {
  token: string
  chatId: string | number
  text: string
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    // TELEGRAM_API_BASE: override SOLO para pruebas E2E con mock local; en producción
    // siempre la oficial (https://api.telegram.org).
    const apiBase = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')
    const res = await fetch(`${apiBase}/bot${opts.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: opts.chatId, text: opts.text.slice(0, 4096) }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } }
    if (res.ok && data.ok && Number.isInteger(data.result?.message_id)) return { ok: true, messageId: String(data.result!.message_id) }
    return { ok: false, error: data.description || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Envío vía Instagram Graph API (messaging). Requiere token + accountId. */
export async function sendInstagramGraphMessage(opts: {
  token: string
  accountId: string
  recipientId: string
  text: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${metaGraphBase()}/v21.0/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({
        recipient: { id: opts.recipientId },
        message: { text: opts.text.slice(0, 2000) },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (res.ok) return { ok: true }
    return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Envío vía Facebook Messenger (Graph API de la Página). Requiere pageToken + pageId. */
export async function sendFacebookGraphMessage(opts: {
  token: string
  pageId: string
  recipientId: string
  text: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${metaGraphBase()}/v21.0/${encodeURIComponent(opts.pageId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({
        recipient: { id: opts.recipientId },
        messaging_type: 'RESPONSE',
        message: { text: opts.text.slice(0, 2000) },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (res.ok) return { ok: true }
    return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Contexto de nicho para prompts del agente (NichoConfig → texto) */
export async function buildNichoContext(orgId: string): Promise<string> {
  const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId } })
  if (!nicho) return 'Negocio de servicios profesionales. Tono profesional y cercano.'
  const extras: Record<string, unknown> = {}
  try {
    if (nicho.raw) Object.assign(extras, JSON.parse(nicho.raw))
  } catch {
    /* raw libre opcional */
  }
  let services: string[] = []
  try {
    services = nicho.services ? (JSON.parse(nicho.services) as string[]) : []
  } catch {
    services = []
  }
  const parts = [
    `Marca: ${nicho.brandingName}`,
    `Rubro: ${nicho.rubro}`,
    `Personalidad: ${nicho.personality}`,
    nicho.tone ? `Tono: ${nicho.tone}` : '',
    nicho.workingHours ? `Horario: ${nicho.workingHours}` : '',
    services.length ? `Servicios: ${services.join(', ')}` : '',
    typeof extras.estrategia === 'string' ? `Estrategia: ${extras.estrategia}` : '',
    Array.isArray(extras.reglas_oro) ? `Reglas de oro: ${(extras.reglas_oro as string[]).join(' | ')}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

/** Palabras que transfieren a humano (handoff) según NichoConfig */
export async function getHandoffKeywords(orgId: string): Promise<string[]> {
  const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { handoffKeywords: true } })
  try {
    return nicho?.handoffKeywords ? (JSON.parse(nicho.handoffKeywords) as string[]) : []
  } catch {
    return []
  }
}

/** Secret aleatorio para validar webhooks (Telegram) */
export function generateWebhookSecret(): string {
  return randomBytes(24).toString('hex')
}

// ==================== TIKTOK (wiring-ready) ====================
// Los DMs por API de TikTok (Business Messaging API) están vetados al programa
// de socios (TikTok Marketing Partner). Este bloque deja el canal COMPLETO:
// OAuth Login Kit + config cifrada + webhook con verificación + envío por
// endpoint configurable. Se activa sin cambios de código cuando TikTok
// apruebe la app de la organización y se registre sendEndpoint.

export interface TikTokState {
  /** Token de acceso Login Kit (corto ~24h; renovar con refreshToken) */
  accessToken?: string
  refreshToken?: string
  openId?: string
  displayName?: string
  /** client_key público de la app de TikTok */
  appKey?: string
  appSecret?: string
  webhookVerifyToken?: string
  /** Scopes extra aprobados por TikTok (además de user_info.basic) */
  extraScopes?: string
  /** Endpoint de envío del Business Messaging API (lo asigna TikTok al aprobar) */
  sendEndpoint?: string
}

export function parseTikTokState(enc: string | null | undefined): TikTokState {
  const raw = decryptSecret(enc)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as TikTokState
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return { accessToken: raw }
  } catch {
    return { accessToken: raw }
  }
}

export function encodeTikTokState(state: TikTokState): string | null {
  return encryptSecret(JSON.stringify(state))
}

/** Base del Login Kit / autorización de TikTok. Override SOLO para tests con mock. */
export function tiktokAuthBase(): string {
  return (process.env.TIKTOK_AUTH_BASE || 'https://www.tiktok.com').replace(/\/+$/, '')
}

/** Base de la Open API de TikTok. Override SOLO para tests con mock. */
export function tiktokApiBase(): string {
  return (process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com').replace(/\/+$/, '')
}

/**
 * Envía texto por el endpoint oficial Business Messaging API v1.3.
 * Requiere aprobación/acceso de Business Messaging y los IDs reales de la
 * cuenta (open_id) y conversación; nunca acepta endpoints configurables.
 */
export async function sendTikTokBusinessMessage(opts: {
  state: TikTokState
  conversationId: string
  text: string
  fetchImpl?: typeof fetch
}): Promise<{ ok: boolean; providerMessageId?: string; error?: string; notAuthorized?: boolean }> {
  const { state } = opts
  if (!state.accessToken || !state.openId || !opts.conversationId || !opts.text.trim()) {
    return {
      ok: false,
      notAuthorized: true,
      error: 'TikTok Business Messaging requiere acceso aprobado, access token, open_id y conversation_id.',
    }
  }
  const fetchImpl = opts.fetchImpl || fetch
  try {
    const res = await fetchImpl('https://business-api.tiktok.com/open_api/v1.3/business/message/send/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': state.accessToken,
      },
      body: JSON.stringify({
        business_id: state.openId,
        recipient_type: 'CONVERSATION',
        recipient: opts.conversationId,
        message_type: 'TEXT',
        text: { body: opts.text.slice(0, 6000) },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json().catch(() => ({})) as {
      code?: number
      message?: string
      data?: { message?: { message_id?: string } }
    }
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` }
    if (data.code !== 0) return { ok: false, error: typeof data.code === 'number' ? `TIKTOK_CODE_${data.code}` : 'TIKTOK_INVALID_RESPONSE' }
    const providerMessageId = data.data?.message?.message_id
    if (typeof providerMessageId !== 'string' || !providerMessageId) {
      return { ok: false, error: 'TIKTOK_RESPONSE_MISSING_MESSAGE_ID' }
    }
    return { ok: true, providerMessageId }
  } catch {
    return { ok: false, error: 'TIKTOK_NETWORK_RESULT_UNCERTAIN' }
  }
}

/**
 * Verifica el header oficial TikTok-Signature: "t=<unix>,s=<hex>".
 * TikTok firma HMAC-SHA256 de "<timestamp>.<raw body>" con el App Secret.
 */
export const TIKTOK_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000
const TIKTOK_WEBHOOK_FUTURE_SKEW_MS = 30 * 1000

export function isTikTokWebhookTimestampFresh(timestamp: string | null, now = Date.now()): boolean {
  if (!timestamp || !/^\d{10}$/.test(timestamp)) return false
  const timestampMs = Number(timestamp) * 1000
  const ageMs = now - timestampMs
  return Number.isFinite(timestampMs) &&
    ageMs <= TIKTOK_WEBHOOK_MAX_AGE_MS &&
    ageMs >= -TIKTOK_WEBHOOK_FUTURE_SKEW_MS
}

export function verifyTikTokSignature(
  rawBody: string,
  appSecret: string,
  signatureHeader: string | null,
  legacyTimestamp?: string | null,
): boolean {
  if (!signatureHeader) return false
  let timestamp = legacyTimestamp || ''
  let signature = signatureHeader
  if (!legacyTimestamp) {
    const parts: Record<string, string> = {}
    for (const part of signatureHeader.split(',')) {
      const separator = part.indexOf('=')
      if (separator <= 0) continue
      parts[part.slice(0, separator).trim()] = part.slice(separator + 1).trim()
    }
    timestamp = parts.t || ''
    signature = parts.s || ''
  }
  if (!isTikTokWebhookTimestampFresh(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', appSecret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  return safeEquals(expected, signature.toLowerCase())
}
