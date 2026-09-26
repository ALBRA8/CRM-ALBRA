import { createHmac, timingSafeEqual, randomBytes } from 'crypto'
import { db } from './db'
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

/**
 * Estado de Instagram guardado como JSON cifrado en instagramTokenEnc:
 * { token, webhookVerifyToken, webhookSecret }
 */
export interface InstagramState {
  token?: string
  webhookVerifyToken?: string
  webhookSecret?: string
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
  const created = await db.client.create({
    data: {
      organizationId: orgId,
      name: (name || '').trim() || `Contacto ${platformKey}`,
      phone: platformKey,
      status: 'prospect',
      source,
      lastContactAt: new Date(),
    },
    select: { id: true, name: true, phone: true },
  })
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
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(opts.phoneId)}/messages`, {
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
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${opts.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: opts.chatId, text: opts.text.slice(0, 4096) }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (res.ok && data.ok) return { ok: true }
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
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages`, {
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
