import { createHmac, timingSafeEqual, randomBytes, createHash } from 'crypto'
import { db } from './db'
import { assignLeadRoundRobin } from './lead-routing'
import { decryptSecret, encryptSecret } from './crypto'

/**
 * Helpers compartidos de integraciones (Telegram / Instagram / WhatsApp / Google).
 * - Vista ensamblada de integraciones (getIntegration) sobre el modelo CANÓNICO:
 *   las credenciales de canales viven en ChannelConnection (credentialsEnc cifrado
 *   + webhookSecretHash para atribución de webhooks) y Google en GoogleIntegration.
 *   (2026-11-21) La tabla Integration fue retirada; la vista mantiene la MISMA
 *   forma para que las rutas de configuración conserven su contrato.
 * - Normalización de clientes de canales (find-or-create por teléfono/ID de plataforma)
 * - Validación de firmas de webhooks (Meta X-Hub-Signature-256, Telegram secret token)
 * - Envío por APIs oficiales (WhatsApp Cloud, Telegram Bot, Instagram Graph) con degradación elegante
 */

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/[^\d+]/g, '')
}

export function sha256HexLookup(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ============ Vista ensamblada canónica (reemplazo de Integration) ============

export interface AssembledIntegration {
  organizationId: string
  telegramBotTokenEnc: string | null
  telegramSecret: string | null
  telegramSecretHash: string | null
  instagramTokenEnc: string | null
  instagramAccountId: string | null
  googleRefreshTokenEnc: string | null
  googleClientJsonEnc: string | null
  googleEmail: string | null
  metaAppSecretEnc: string | null
  whatsappPhoneId: string | null
  whatsappCloudTokenEnc: string | null
  facebookTokenEnc: string | null
  facebookPageId: string | null
  facebookPageName: string | null
  facebookUserEmail: string | null
  tiktokTokenEnc: string | null
  agentLeadsSecretEnc: string | null
  enableWhatsApp: boolean
  enableTelegram: boolean
  enableInstagram: boolean
  enableFacebook: boolean
  enableTikTok: boolean
  enableGoogle: boolean
}

function safeJsonParse<T>(raw: string | null | undefined): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

interface WhatsAppCloudCredentialsBlob {
  accessToken?: string
  appSecret?: string | null
  webhookVerifyToken?: string | null
}

/** Credenciales de una conexión WhatsApp Cloud canónica (credentialsEnc). */
export function parseWhatsAppCloudCredentials(credentialsEnc: string | null | undefined): WhatsAppCloudCredentialsBlob {
  const raw = decryptSecret(credentialsEnc)
  const parsed = safeJsonParse<WhatsAppCloudCredentialsBlob>(raw)
  if (parsed && typeof parsed === 'object') return parsed
  return raw ? { accessToken: raw } : {}
}

/**
 * Vista ensamblada de la configuración de integraciones de la organización,
 * con la MISMA forma que tenía la fila Integration: cada campo se resuelve
 * desde su hogar canónico (ChannelConnection / GoogleIntegration / Settings).
 * Nunca lanza: si un canal no está conectado, sus campos son null/false.
 */
export async function getIntegration(orgId: string): Promise<AssembledIntegration> {
  const [connections, google, settings] = await Promise.all([
    db.channelConnection.findMany({
      where: { organizationId: orgId, channel: { in: ['telegram', 'instagram', 'facebook', 'whatsapp', 'tiktok'] } },
      orderBy: { updatedAt: 'desc' },
    }),
    db.googleIntegration.findUnique({ where: { organizationId: orgId } }),
    db.settings.findUnique({ where: { organizationId: orgId }, select: { agentLeadsSecretEnc: true } }),
  ])

  const telegram = connections.find((c) => c.channel === 'telegram' && c.provider === 'telegram_bot') || null
  const instagram = connections.find((c) => c.channel === 'instagram' && c.provider === 'meta_graph') || null
  // Messenger vive como channel='messenger' (convención del helper de webhooks y del backfill);
  // se tolera 'facebook' por compatibilidad con filas antiguas.
  const facebook = connections.find((c) => (c.channel === 'messenger' || c.channel === 'facebook') && c.provider === 'meta_graph') || null
  const whatsappCloud = connections.find((c) => c.channel === 'whatsapp' && c.provider === 'meta_cloud' && c.status === 'connected')
    || connections.find((c) => c.channel === 'whatsapp' && c.provider === 'meta_cloud')
    || null
  const tiktok = connections.find((c) => c.channel === 'tiktok') || null

  const telegramState = telegram ? parseTelegramState(telegram.credentialsEnc) : {}
  const instagramState = instagram ? parseInstagramState(instagram.credentialsEnc) : {}
  const facebookState = facebook ? parseFacebookState(facebook.credentialsEnc) : {}
  const whatsappCreds = whatsappCloud ? parseWhatsAppCloudCredentials(whatsappCloud.credentialsEnc) : {}
  const tiktokState = tiktok ? parseTikTokState(tiktok.credentialsEnc) : {}

  const metaAppSecret = instagramState.webhookSecret || facebookState.appSecret || whatsappCreds.appSecret || null

  return {
    organizationId: orgId,
    telegramBotTokenEnc: telegram?.credentialsEnc ?? null,
    telegramSecret: telegramState.webhookSecret ? encryptSecret(telegramState.webhookSecret) : null,
    telegramSecretHash: telegram?.webhookSecretHash ?? null,
    instagramTokenEnc: instagram?.credentialsEnc ?? null,
    instagramAccountId: instagram?.externalAccountId ?? null,
    googleRefreshTokenEnc: google?.googleRefreshTokenEnc ?? null,
    googleClientJsonEnc: google?.googleClientJsonEnc ?? null,
    googleEmail: google?.googleEmail ?? null,
    metaAppSecretEnc: metaAppSecret ? encryptSecret(metaAppSecret) : null,
    whatsappPhoneId: whatsappCloud?.externalAccountId ?? null,
    whatsappCloudTokenEnc: whatsappCreds.accessToken ? encryptSecret(whatsappCreds.accessToken) : null,
    facebookTokenEnc: facebook?.credentialsEnc ?? null,
    facebookPageId: facebook?.externalAccountId ?? facebookState.pageId ?? null,
    facebookPageName: facebookState.pageName ?? null,
    facebookUserEmail: facebookState.userEmail ?? null,
    tiktokTokenEnc: tiktok?.credentialsEnc ?? null,
    agentLeadsSecretEnc: settings?.agentLeadsSecretEnc ?? null,
    enableWhatsApp: !!(whatsappCreds.accessToken || whatsappCloud),
    enableTelegram: !!telegramState.token,
    enableInstagram: !!instagramState.token,
    enableFacebook: !!facebookState.pageToken,
    enableTikTok: !!tiktokState.accessToken,
    enableGoogle: !!(google?.googleRefreshTokenEnc || google?.calendarSyncEnabled),
  }
}

/** Entrada genérica para crear/actualizar una conexión canónica por blob cifrado. */
export interface UpsertChannelConnectionInput {
  orgId: string
  channel: string
  provider: string
  providerAccountKey: string
  externalAccountId?: string | null
  displayName?: string | null
  credentialsEnc: string | null
  webhookSecretHash?: string | null
  status?: string
  metadata?: Record<string, unknown>
  eventType?: string
  eventDetail?: string
}

/**
 * Crea o actualiza la ChannelConnection canónica de un canal por
 * providerAccountKey (idempotente; nunca borra filas). Audit evento best-effort.
 */
export async function upsertChannelConnection(input: UpsertChannelConnectionInput): Promise<void> {
  const status = input.status || 'connected'
  const externalAccountId = input.externalAccountId || input.providerAccountKey
  const data = {
    externalAccountId,
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.credentialsEnc !== undefined && input.credentialsEnc !== null ? { credentialsEnc: input.credentialsEnc } : {}),
    ...(input.webhookSecretHash !== undefined ? { webhookSecretHash: input.webhookSecretHash } : {}),
    status,
    ...(input.metadata ? { metadata: JSON.stringify(input.metadata) } : {}),
  }
  const connection = await db.channelConnection.upsert({
    where: { providerAccountKey: input.providerAccountKey },
    create: {
      organizationId: input.orgId,
      channel: input.channel,
      provider: input.provider,
      providerAccountKey: input.providerAccountKey,
      credentialsEnc: input.credentialsEnc || '',
      ...data,
    },
    update: data,
  })
  try {
    await db.channelConnectionEvent.create({
      data: {
        organizationId: input.orgId,
        connectionId: connection.id,
        type: input.eventType || 'connected',
        detail: input.eventDetail || `upsert:${input.providerAccountKey}`,
      },
    })
  } catch (err) {
    console.error('[integrations] evento de conexión falló (best-effort)', err instanceof Error ? err.message : err)
  }
}

/** Upsert de la conexión Telegram canónica (blob = estado Telegram + webhookSecret). */
export async function saveTelegramConnection(orgId: string, state: TelegramState, opts: { status?: string } = {}): Promise<void> {
  const botId = state.token?.match(/^(\d+):/)?.[1] || null
  const credentialsEnc = encodeTelegramState(state)
  if (!credentialsEnc) return
  await upsertChannelConnection({
    orgId,
    channel: 'telegram',
    provider: 'telegram_bot',
    providerAccountKey: botId ? `telegram:bot:${botId}` : `telegram:org:${orgId}`,
    externalAccountId: botId,
    credentialsEnc,
    webhookSecretHash: state.webhookSecret ? sha256HexLookup(state.webhookSecret) : null,
    status: opts.status || (state.token ? 'connected' : 'disconnected'),
    metadata: { botUsername: state.botUsername ?? null },
    eventType: state.token ? 'connected' : 'disconnected',
  })
}

/**
 * Estado de Telegram guardado como JSON cifrado en telegramBotTokenEnc
 * (el schema no tiene campos extra; un solo blob cifrado = token + metadata).
 */
export interface TelegramState {
  token?: string
  botUsername?: string
  autoReply?: boolean
  /** Secret de verificación del webhook (X-Telegram-Bot-Api-Secret-Token); su hash vive en ChannelConnection.webhookSecretHash */
  webhookSecret?: string
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
  /** App Secret de Meta compartido con Instagram (HMAC del webhook) */
  appSecret?: string
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
  accessTokenExpiresAt?: number
  refreshTokenExpiresAt?: number
  scope?: string
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

export async function refreshTikTokUserAccessToken(opts: {
  state: TikTokState
  fetchImpl?: typeof fetch
  now?: number
}): Promise<{ ok: true; state: TikTokState } | { ok: false; error: string; reauthorizationRequired?: boolean }> {
  const { state } = opts
  if (!state.appKey || !state.appSecret || !state.refreshToken) {
    return { ok: false, error: 'TIKTOK_REFRESH_CREDENTIALS_MISSING', reauthorizationRequired: !state.refreshToken }
  }

  const form = new URLSearchParams({
    client_key: state.appKey,
    client_secret: state.appSecret,
    grant_type: 'refresh_token',
    refresh_token: state.refreshToken,
  })

  try {
    const response = await (opts.fetchImpl || fetch)(`${tiktokApiBase()}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await response.json().catch(() => ({})) as {
      access_token?: string
      expires_in?: number
      refresh_token?: string
      refresh_expires_in?: number
      open_id?: string
      scope?: string
      error?: string
    }
    if (!response.ok || data.error) {
      return {
        ok: false,
        error: data.error === 'invalid_grant' ? 'TIKTOK_REFRESH_INVALID_GRANT' : `TIKTOK_REFRESH_HTTP_${response.status}`,
        reauthorizationRequired: data.error === 'invalid_grant',
      }
    }
    if (
      typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.refresh_token !== 'string' || !data.refresh_token ||
      !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0 ||
      !Number.isFinite(data.refresh_expires_in) || Number(data.refresh_expires_in) <= 0
    ) {
      return { ok: false, error: 'TIKTOK_REFRESH_INVALID_RESPONSE' }
    }

    const now = opts.now ?? Date.now()
    return {
      ok: true,
      state: {
        ...state,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: now + Number(data.expires_in) * 1000,
        refreshTokenExpiresAt: now + Number(data.refresh_expires_in) * 1000,
        openId: typeof data.open_id === 'string' && data.open_id ? data.open_id : state.openId,
        scope: typeof data.scope === 'string' ? data.scope : state.scope,
      },
    }
  } catch {
    return { ok: false, error: 'TIKTOK_REFRESH_NETWORK_UNCERTAIN' }
  }
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
