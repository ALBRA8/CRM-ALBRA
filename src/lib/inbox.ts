import { db } from './db'
import { decryptSecret } from './crypto'
import { sendTelegramBotMessage, sendInstagramGraphMessage, getIntegration, parseTelegramState, parseInstagramState } from './integrations'
import { recordTimelineEvent } from './timeline'

/**
 * Bandeja omnicanal (Fase 4 del plan maestro).
 *
 * Unifica en una sola lista las conversaciones de los 3 canales:
 *   - WhatsApp (daemon Baileys) → tabla WhatsAppConversation/WhatsAppMessage
 *   - Telegram  → TimelineEvent type="telegram" agrupado por cliente
 *   - Instagram → TimelineEvent type="instagram" agrupado por cliente
 *
 * Decisiones de diseño:
 *  - Cada conversación tiene una `key` estable: "wa:<convId>" | "tg:<clientId>" | "ig:<clientId>".
 *    Es el único identificador que viaja al frontend y vuelve en cada petición.
 *  - El merge es READ-ONLY sobre las fuentes (no migra datos): Telegram/Instagram
 *    ya viven como timeline y WhatsApp como tablas propias; la bandeja es una
 *    vista coherente encima. Cero riesgo de duplicación o pérdida.
 *  - WhatsApp manda en la conversación "global": si el mismo teléfono aparece en
 *    timeline whatsapp (Cloud API) y en el daemon, se prioriza la del daemon
 *    (es el canal principal del producto) y el timeline queda en la ficha del cliente.
 *  - Nunca lanza: si un canal falla, se degrada a lista vacía de ese canal.
 */

export type InboxChannel = 'whatsapp' | 'telegram' | 'instagram'

export interface InboxConversation {
  key: string
  channel: InboxChannel
  channelLabel: 'WhatsApp' | 'Telegram' | 'Instagram'
  contactName: string
  /** Handle real para ENVIAR: teléfono WA / chatId TG / recipientId IG. */
  contactHandle: string
  clientId: string | null
  lastMessage: string
  lastMessageAt: string | null
  /** 'in' = entrante (contacto), 'out' = saliente (agente o usuario). */
  lastMessageFrom: 'in' | 'out'
  unreadCount: number
  isAutoReply: boolean
}

export interface InboxMessage {
  id: string
  direction: 'in' | 'out'
  senderType: 'contact' | 'agent' | 'user'
  text: string
  createdAt: string
  /** 'voice' si es una nota de voz transcrita (chip 🎙 en la UI). */
  messageType?: string
}

const CHANNEL_LABELS: Record<InboxChannel, InboxConversation['channelLabel']> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
}

/** Prefijo de la key del canal WhatsApp directo (sin conversación previa). */
const WA_NEW_PREFIX = 'wa-new'

/**
 * Normaliza un teléfono al formato que usa el daemon (E.164 sin '+', solo
 * dígitos: '573001110000'). Quita TODO lo que no sea dígito (espacios, '+',
 * guiones…). Devuelve null si no quedan dígitos suficientes (fail-closed):
 * nunca se ofrece/envía a un teléfono basura.
 */
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 7 ? digits : null
}

/**
 * Parseo de la key del canal WhatsApp directo "wa-new:<teléfono>".
 * Devuelve el teléfono normalizado o null si la key no es wa-new:/el teléfono
 * es inválido (fail-closed). Es la key que ofrece el diálogo de IA de cierre
 * cuando el cliente tiene teléfono pero NUNCA ha tenido conversación: el envío
 * crea la conversación bajo demanda (find-or-create).
 */
export function parseWaNewKey(key: string): string | null {
  if (typeof key !== 'string' || !key.startsWith(`${WA_NEW_PREFIX}:`)) return null
  return normalizeWaPhone(key.slice(WA_NEW_PREFIX.length + 1))
}

// ---------- helpers de key (puros, testeables) ----------

export function makeInboxKey(channel: InboxChannel, id: string): string {
  const prefix = channel === 'whatsapp' ? 'wa' : channel === 'telegram' ? 'tg' : 'ig'
  return `${prefix}:${id}`
}

/** Parseo estricto: devuelve null ante cualquier key malformada (fail-closed). */
export function parseInboxKey(key: string): { channel: InboxChannel; id: string } | null {
  if (typeof key !== 'string' || key.length < 3 || key.length > 200) return null
  const idx = key.indexOf(':')
  if (idx < 1) return null
  const prefix = key.slice(0, idx)
  const id = key.slice(idx + 1)
  if (!id || /[\s]/.test(id)) return null
  if (prefix === 'wa') return { channel: 'whatsapp', id }
  if (prefix === 'tg') return { channel: 'telegram', id }
  if (prefix === 'ig') return { channel: 'instagram', id }
  return null
}

function safeMetadata(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Eventos de timeline → mensajes normalizados (asc por fecha). */
export function timelineToMessages(
  events: Array<{
    id: string
    title: string
    description: string | null
    metadata: string | null
    createdAt: Date
    source: string
  }>
): InboxMessage[] {
  return events
    .map((e) => {
      const meta = safeMetadata(e.metadata)
      const direction: 'in' | 'out' = meta.direction === 'out' ? 'out' : 'in'
      return {
        id: e.id,
        direction,
        senderType: direction === 'in' ? 'contact' : e.source === 'agent' ? 'agent' : 'user',
        text: e.description || e.title || '',
        createdAt: e.createdAt.toISOString(),
        ...(meta.voice ? { messageType: 'voice' } : {}),
      } satisfies InboxMessage
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// ---------- listado unificado ----------

async function listWhatsAppConversations(orgId: string, limit: number): Promise<InboxConversation[]> {
  try {
    const rows = await db.whatsAppConversation.findMany({
      where: { organizationId: orgId, status: 'active' },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      select: {
        id: true,
        contactPhone: true,
        contactName: true,
        lastMessage: true,
        lastMessageAt: true,
        lastMessageFrom: true,
        unreadCount: true,
        isAutoReply: true,
        clientId: true,
      },
    })
    return rows.map((c) => ({
      key: makeInboxKey('whatsapp', c.id),
      channel: 'whatsapp' as const,
      channelLabel: CHANNEL_LABELS.whatsapp,
      contactName: c.contactName || c.contactPhone,
      contactHandle: c.contactPhone,
      clientId: c.clientId,
      lastMessage: c.lastMessage || '',
      lastMessageAt: c.lastMessageAt?.toISOString() || null,
      lastMessageFrom: c.lastMessageFrom === 'out' ? ('out' as const) : ('in' as const),
      unreadCount: c.unreadCount,
      isAutoReply: c.isAutoReply,
    }))
  } catch (err) {
    console.error('[inbox] canal whatsapp no disponible', err)
    return []
  }
}

/**
 * Conversaciones derivadas de timeline (Telegram e Instagram).
 * Agrupa por cliente y calcula último mensaje + no leídos (metadata.direction==='in' sin readAt).
 */
async function listTimelineConversations(
  orgId: string,
  channel: 'telegram' | 'instagram',
  limit: number
): Promise<InboxConversation[]> {
  try {
    const events = await db.timelineEvent.findMany({
      where: { organizationId: orgId, type: channel },
      orderBy: { createdAt: 'desc' },
      take: limit * 10,
    })
    const byClient = new Map<string, typeof events>()
    for (const e of events) {
      if (!e.clientId) continue
      const bucket = byClient.get(e.clientId)
      if (bucket) bucket.push(e)
      else byClient.set(e.clientId, [e])
    }

    const clientIds = [...byClient.keys()].slice(0, limit)
    if (clientIds.length === 0) return []
    const clients = await db.client.findMany({
      where: { organizationId: orgId, id: { in: clientIds } },
      select: { id: true, name: true, phone: true },
    })
    const clientById = new Map(clients.map((c) => [c.id, c]))

    return clientIds.map((clientId) => {
      const clientEvents = byClient.get(clientId)!
      const last = clientEvents[0]
      const lastMeta = safeMetadata(last.metadata)
      // Handle para enviar: el ÚLTIMO handle conocido del contacto en este canal.
      const handle =
        channel === 'telegram'
          ? String(lastMeta.chatId || '')
          : String(lastMeta.senderId || lastMeta.recipientId || '')
      const unread = clientEvents.filter((e) => {
        const meta = safeMetadata(e.metadata)
        return meta.direction === 'in' && !meta.readAt
      }).length
      const client = clientById.get(clientId)
      return {
        key: makeInboxKey(channel, clientId),
        channel,
        channelLabel: CHANNEL_LABELS[channel],
        contactName: client?.name || `Contacto ${CHANNEL_LABELS[channel]}`,
        contactHandle: handle,
        clientId,
        lastMessage: last.description || last.title || '',
        lastMessageAt: last.createdAt.toISOString(),
        lastMessageFrom: lastMeta.direction === 'out' ? ('out' as const) : ('in' as const),
        unreadCount: unread,
        isAutoReply: clientEvents.some((e) => e.source === 'agent'),
      } satisfies InboxConversation
    })
  } catch (err) {
    console.error(`[inbox] canal ${channel} no disponible`, err)
    return []
  }
}

/** Lista unificada, ordenada por actividad reciente. */
export async function listInbox(orgId: string, limit = 100): Promise<InboxConversation[]> {
  const [wa, tg, ig] = await Promise.all([
    listWhatsAppConversations(orgId, limit),
    listTimelineConversations(orgId, 'telegram', limit),
    listTimelineConversations(orgId, 'instagram', limit),
  ])
  return [...wa, ...tg, ...ig]
    .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
    .slice(0, limit)
}

// ---------- canales disponibles por cliente (IA de cierre) ----------

export interface ClientChannelOption {
  key: string
  channel: InboxChannel
  channelLabel: InboxConversation['channelLabel']
  /** Handle real para ENVIAR: teléfono WA / chatId TG / recipientId IG. */
  contactHandle: string
}

/**
 * Canales con conversación activa para UN cliente (los consume el diálogo de
 * IA de cierre para ofrecer "Enviar por …"). Misma resolución de handles que el
 * listado de la bandeja: wa:<convId> desde la tabla del daemon; tg:/ig:<clientId>
 * con el handle más reciente del timeline. Nunca lanza: un canal que falle
 * simplemente no se ofrece.
 */
export async function listClientChannels(orgId: string, clientId: string): Promise<ClientChannelOption[]> {
  const options: ClientChannelOption[] = []
  try {
    const conv = await db.whatsAppConversation.findFirst({
      where: { organizationId: orgId, clientId, status: 'active' },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, contactPhone: true },
    })
    if (conv) {
      options.push({
        key: makeInboxKey('whatsapp', conv.id),
        channel: 'whatsapp',
        channelLabel: 'WhatsApp',
        contactHandle: conv.contactPhone,
      })
    }
  } catch (err) {
    console.error('[inbox] canal whatsapp (cliente) no disponible', err)
  }
  if (!options.some((o) => o.channel === 'whatsapp')) {
    // Task 19-b: cliente SIN conversación activa pero CON teléfono → canal
    // directo "wa-new:<teléfono>". El envío crea la conversación bajo demanda
    // (find-or-create) y manda por el mismo camino daemon que wa:<convId>.
    try {
      const client = await db.client.findFirst({
        where: { organizationId: orgId, id: clientId },
        select: { phone: true },
      })
      const phone = normalizeWaPhone(client?.phone)
      if (phone) {
        options.push({
          key: `${WA_NEW_PREFIX}:${phone}`,
          channel: 'whatsapp',
          channelLabel: 'WhatsApp',
          contactHandle: phone,
        })
      }
    } catch (err) {
      console.error('[inbox] teléfono del cliente no disponible', err)
    }
  }
  try {
    const events = await db.timelineEvent.findMany({
      where: { organizationId: orgId, clientId, type: { in: ['telegram', 'instagram'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { type: true, metadata: true },
    })
    const tg = events.find((e) => e.type === 'telegram' && safeMetadata(e.metadata).chatId)
    if (tg) {
      options.push({
        key: makeInboxKey('telegram', clientId),
        channel: 'telegram',
        channelLabel: 'Telegram',
        contactHandle: String(safeMetadata(tg.metadata).chatId),
      })
    }
    const ig = events.find((e) => {
      const m = safeMetadata(e.metadata)
      return e.type === 'instagram' && !!(m.senderId || m.recipientId)
    })
    if (ig) {
      const m = safeMetadata(ig.metadata)
      options.push({
        key: makeInboxKey('instagram', clientId),
        channel: 'instagram',
        channelLabel: 'Instagram',
        contactHandle: String(m.senderId || m.recipientId),
      })
    }
  } catch (err) {
    console.error('[inbox] canales timeline (cliente) no disponibles', err)
  }
  return options
}

// ---------- hilo de mensajes ----------

export async function getInboxMessages(orgId: string, key: string): Promise<InboxMessage[]> {
  const parsed = parseInboxKey(key)
  if (!parsed) return []

  if (parsed.channel === 'whatsapp') {
    const rows = await db.whatsAppMessage.findMany({
      where: { organizationId: orgId, conversationId: parsed.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, direction: true, senderType: true, text: true, createdAt: true, messageType: true },
    })
    return rows
      .map((m) => ({
        id: m.id,
        direction: m.direction === 'outbound' || m.direction === 'out' ? ('out' as const) : ('in' as const),
        senderType: m.senderType === 'contact' ? ('contact' as const) : m.senderType === 'agent' ? ('agent' as const) : ('user' as const),
        text: m.text || '',
        createdAt: m.createdAt.toISOString(),
        ...(m.messageType === 'voice' ? { messageType: 'voice' } : {}),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  const events = await db.timelineEvent.findMany({
    where: { organizationId: orgId, type: parsed.channel, clientId: parsed.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return timelineToMessages(events)
}

/** Marca la conversación como leída (best-effort; nunca lanza). */
export async function markInboxRead(orgId: string, key: string): Promise<void> {
  const parsed = parseInboxKey(key)
  if (!parsed) return
  try {
    if (parsed.channel === 'whatsapp') {
      await db.whatsAppConversation.updateMany({
        where: { organizationId: orgId, id: parsed.id },
        data: { unreadCount: 0 },
      })
      return
    }
    // Telegram/Instagram: marcar readAt en los eventos entrantes sin leer (acotado).
    const events = await db.timelineEvent.findMany({
      where: { organizationId: orgId, type: parsed.channel, clientId: parsed.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    for (const e of events) {
      const meta = safeMetadata(e.metadata)
      if (meta.direction === 'in' && !meta.readAt) {
        await db.timelineEvent.update({
          where: { id: e.id },
          data: { metadata: JSON.stringify({ ...meta, readAt: new Date().toISOString() }) },
        })
      }
    }
  } catch (err) {
    console.error('[inbox] markInboxRead falló (no bloquea)', err)
  }
}

// ---------- envío por canal ----------

export interface InboxSendResult {
  ok: boolean
  error?: string
}

/**
 * Envía por el daemon Baileys con el contrato { to, text } y el secreto
 * server-to-server. Único camino de envío WhatsApp (lo usan tanto las
 * conversaciones existentes "wa:<convId>" como las directas "wa-new:<teléfono>").
 */
async function sendViaDaemon(to: string, text: string): Promise<InboxSendResult> {
  const daemonUrl = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return { ok: false, error: 'INTERNAL_API_SECRET no configurado en el servidor' }
  const res = await fetch(`${daemonUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ to, text }),
    signal: AbortSignal.timeout(5000),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || data.error) return { ok: false, error: data.error || `WhatsApp no pudo enviar (HTTP ${res.status})` }
  return { ok: true }
}

/**
 * Envío WhatsApp DIRECTO (Task 19-b) a un teléfono sin conversación previa:
 * primero manda por el MISMO camino daemon que "wa:<convId>" (si el daemon
 * falla no se crea nada) y, solo si el envío salió, find-or-create de la
 * conversación (unique organizationId+contactPhone) con el nombre del cliente
 * y lastMessage/lastMessageAt/lastMessageFrom ('out') igual que deja el daemon
 * en los mensajes entrantes (texto truncado a 100). Trazabilidad idéntica al
 * caso existente: sin timeline ni fila de mensaje (los dueña el daemon).
 */
async function sendWhatsAppDirect(opts: {
  orgId: string
  userId: string
  phone: string
  clientId?: string | null
  text: string
}): Promise<InboxSendResult> {
  const text = opts.text.trim().slice(0, 4000)
  if (!text) return { ok: false, error: 'El mensaje está vacío' }
  try {
    const sent = await sendViaDaemon(opts.phone, text)
    if (!sent.ok) return sent

    let contactName: string | null = null
    if (opts.clientId) {
      const client = await db.client.findFirst({
        where: { organizationId: opts.orgId, id: opts.clientId },
        select: { name: true },
      })
      contactName = client?.name || null
    }
    await db.whatsAppConversation.upsert({
      where: {
        organizationId_contactPhone: { organizationId: opts.orgId, contactPhone: opts.phone },
      },
      create: {
        organizationId: opts.orgId,
        clientId: opts.clientId || null,
        contactPhone: opts.phone,
        contactName: contactName || opts.phone,
        lastMessage: text.slice(0, 100),
        lastMessageAt: new Date(),
        lastMessageFrom: 'out',
      },
      // Ya existía conversación para ese teléfono → no se toca (igual que wa:<convId>).
      update: {},
    })
    return { ok: true }
  } catch (err) {
    console.error('[inbox] envío WhatsApp directo falló', err)
    return { ok: false, error: 'No se pudo enviar el mensaje. Intenta de nuevo.' }
  }
}

/**
 * Envía un mensaje por el canal de la conversación. Reutiliza las mismas
 * funciones de lib/integrations que los endpoints /telegram/send y /instagram/send
 * (misma trazabilidad en timeline, source="manual"), y el mismo contrato
 * { to, text } del daemon para WhatsApp (también para la key directa
 * "wa-new:<teléfono>" de clientes sin conversación previa).
 */
export async function sendInboxMessage(opts: {
  orgId: string
  userId: string
  key: string
  contactHandle: string
  clientId?: string | null
  text: string
}): Promise<InboxSendResult> {
  // Canal WhatsApp directo (Task 19-b): sin conversación previa, se crea al vuelo.
  const waNewPhone = parseWaNewKey(opts.key)
  if (waNewPhone) {
    return sendWhatsAppDirect({
      orgId: opts.orgId,
      userId: opts.userId,
      phone: waNewPhone,
      clientId: opts.clientId,
      text: opts.text,
    })
  }

  const parsed = parseInboxKey(opts.key)
  if (!parsed) return { ok: false, error: 'Conversación inválida' }
  const text = opts.text.trim().slice(0, 4000)
  if (!text) return { ok: false, error: 'El mensaje está vacío' }

  try {
    if (parsed.channel === 'whatsapp') {
      return await sendViaDaemon(opts.contactHandle, text)
    }

    const integration = await getIntegration(opts.orgId)

    if (parsed.channel === 'telegram') {
      const state = parseTelegramState(integration.telegramBotTokenEnc)
      if (!state.token) return { ok: false, error: 'Telegram no configurado. Guarda el Bot Token en Configuración → Telegram.' }
      const result = await sendTelegramBotMessage({ token: state.token, chatId: opts.contactHandle, text })
      if (!result.ok) return { ok: false, error: `Telegram no pudo enviar: ${result.error}` }
      await recordTimelineEvent({
        orgId: opts.orgId,
        clientId: opts.clientId || null,
        type: 'telegram',
        title: 'Mensaje enviado por Telegram',
        description: text.slice(0, 300),
        metadata: { chatId: String(opts.contactHandle), direction: 'out' },
        source: 'manual',
        userId: opts.userId,
      })
      return { ok: true }
    }

    // Instagram
    const igState = parseInstagramState(integration.instagramTokenEnc)
    if (!igState.token) return { ok: false, error: 'Instagram no configurado. Guarda el Access Token en Configuración → Instagram.' }
    const result = await sendInstagramGraphMessage({
      token: igState.token,
      accountId: integration.instagramAccountId || '',
      recipientId: opts.contactHandle,
      text,
    })
    if (!result.ok) return { ok: false, error: `Instagram no pudo enviar: ${result.error}` }
    await recordTimelineEvent({
      orgId: opts.orgId,
      clientId: opts.clientId || null,
      type: 'instagram',
      title: 'Mensaje enviado por Instagram',
      description: text.slice(0, 300),
      metadata: { recipientId: String(opts.contactHandle), direction: 'out' },
      source: 'manual',
      userId: opts.userId,
    })
    return { ok: true }
  } catch (err) {
    console.error('[inbox] sendInboxMessage falló', err)
    return { ok: false, error: 'No se pudo enviar el mensaje. Intenta de nuevo.' }
  }
}


