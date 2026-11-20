import { db } from './db'

/**
 * Bandeja omnicanal (Fase 4 del plan maestro).
 *
 * Unifica en una sola lista las conversaciones de los 4 canales:
 *   - WhatsApp (daemon Baileys) → tabla WhatsAppConversation/WhatsAppMessage
 *   - Telegram  → TimelineEvent type="telegram" agrupado por cliente
 *   - Instagram → TimelineEvent type="instagram" agrupado por cliente
 *   - Facebook  → TimelineEvent type="facebook" agrupado por cliente (Messenger de la Página)
 *
 * Decisiones de diseño:
 *  - Cada conversación tiene una `key` estable: "wa:<convId>" | "tg:<clientId>" | "ig:<clientId>".
 *    Es el único identificador que viaja al frontend y vuelve en cada petición.
 *  - El merge es READ-ONLY sobre las fuentes (no migra datos): Telegram/Instagram
 *    ya viven como timeline y WhatsApp como tablas propias; la bandeja es una
 *    vista coherente encima. Cero riesgo de duplicación o pérdida.
 *  - (M7, criterio 2026-11-20) UNIFICACIÓN DE LA DOBLE BANDEJA: conviven dos
 *    generaciones de modelo (tablas WhatsApp* del daemon legacy y el modelo
 *    canónico Channel*) y un mismo contacto podía aparecer DOS veces. El
 *    criterio vigente es "CANÓNICO PRIMERO, LEGACY COMO RESPALDO" (la opción
 *    recomendada del plan, reversible sin perder datos; pendiente de firma
 *    A10 del propietario): ver dedupeInboxConversations() y
 *    docs/CRITERIO-BANDEJA-UNICA.md. El historial completo sigue visible en
 *    la ficha 360 — la dedup es SOLO de vista, nunca borra datos.
 *  - Nunca lanza: si un canal falla, se degrada a lista vacía de ese canal.
 */

export type InboxChannel = 'whatsapp' | 'telegram' | 'instagram' | 'facebook' | 'tiktok'

export interface InboxConversation {
  key: string
  /** Nombre seguro de la cuenta conectada; solo presente en conversaciones canónicas. */
  connectionName?: string | null
  /** Id de la conexión canónica (ChannelConnection); null en las legacy. (F3) */
  connectionId?: string | null
  channel: InboxChannel
  channelLabel: 'WhatsApp' | 'Telegram' | 'Instagram' | 'Messenger' | 'TikTok'
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
  deliveryStatus?: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'delivery_failed' | 'unknown'
}

const CHANNEL_LABELS: Record<InboxChannel, InboxConversation['channelLabel']> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  facebook: 'Messenger',
  tiktok: 'TikTok',
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
  const prefix = channel === 'whatsapp' ? 'wa' : channel === 'telegram' ? 'tg' : channel === 'instagram' ? 'ig' : 'fb'
  return `${prefix}:${id}`
}

/** Parseo estricto: devuelve null ante cualquier key malformada (fail-closed). */
export function parseInboxKey(key: string): { channel: InboxChannel | null; id: string } | null {
  if (typeof key !== 'string' || key.length < 3 || key.length > 200) return null
  const idx = key.indexOf(':')
  if (idx < 1) return null
  const prefix = key.slice(0, idx)
  const id = key.slice(idx + 1)
  if (!id || /[\s]/.test(id)) return null
  if (prefix === 'cc') return { channel: null, id }
  if (prefix === 'wa') return { channel: 'whatsapp', id }
  if (prefix === 'tg') return { channel: 'telegram', id }
  if (prefix === 'ig') return { channel: 'instagram', id }
  if (prefix === 'fb') return { channel: 'facebook', id }
  return null
}

function safeMetadata(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function safeParseMetadataObject(raw: string | null | undefined): Record<string, unknown> {
  return safeMetadata(raw)
}

// ---------- (M7) unificación de la doble bandeja (puros, testeables) ----------

/**
 * TRUE si la key pertenece al modelo CANÓNICO (ChannelConversation) —
 * la generación nueva con outbox durable, estado de entrega y conexión
 * explícita. Las legacy (wa:/tg:/ig:/fb:) son la generación anterior.
 */
export function isCanonicalInboxKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith('cc:')
}

/**
 * Identidad de deduplicación de una conversación: canal + handle normalizado.
 *  - WhatsApp: SOLO dígitos (el daemon guarda E.164 sin '+' y el webhook
 *    canónico guarda normalizePhone, que puede incluir '+'): las dos formas
 *    deben colisionar en la MISMA identidad.
 *  - Telegram/Instagram/Facebook/TikTok: handle tal cual, recortado
 *    (conservador: ante la duda NO se unifica — un falso negativo solo
 *    muestra dos filas como hoy; un falso positivo ocultaría un hilo).
 * Devuelve null si no hay handle útil: sin identidad no se deduplica nada.
 */
export function inboxIdentity(
  conversation: Pick<InboxConversation, 'channel' | 'contactHandle'>,
): string | null {
  if (!conversation || typeof conversation.contactHandle !== 'string') return null
  const handle = conversation.contactHandle.trim()
  if (!handle) return null
  if (conversation.channel === 'whatsapp') {
    const digits = normalizeWaPhone(handle)
    return digits ? `whatsapp:${digits}` : null
  }
  return `${conversation.channel}:${handle}`
}

/**
 * (M7 / F3-T03) Criterio de unificación de la doble bandeja.
 *
 * DECISIÓN POR DEFECTO — reversible — pendiente de firma A10 del propietario:
 *   "CANÓNICO PRIMERO, LEGACY COMO RESPALDO".
 *
 * Reglas, en orden:
 *  1. Las canónicas (cc:*) SIEMPRE pasan: son el modelo a futuro. Entre sí
 *     NO se deduplican — dos números conectados de la org son dos hilos
 *     reales, y cada fila ya muestra su cuenta (connectionName).
 *  2. Una legacy (wa:/tg:/ig:/fb:) se OCULTA si existe una canónica con la
 *     MISMA identidad (canal + handle): el contacto aparece UNA sola vez, con
 *     canal y cuenta claros. Su historial sigue íntegro en la ficha 360 y en
 *     el dashboard: aquí solo se deja de repetir la fila.
 *  3. Legacy duplicada dentro de su propia generación (defensa defensiva,
 *     p. ej. dos filas daemon del mismo teléfono): gana la MÁS RECIENTE
 *     (la lista llega ordenada desc por lastMessageAt; se conserva la
 *     primera aparición).
 *  4. Sin identidad útil (handle vacío/raro): pasa tal cual — nunca se
 *     oculta información por una normalización dudosa (fail-open
 *     informativo; el peaje de equivocarse aquí es mostrar una fila extra).
 *
 * REVERSIBILIDAD: función pura aplicada SOLO en la vista (listInbox). Girar
 * el criterio a "daemon primero" es invertir las reglas 1 y 2; restaurar el
 * comportamiento anterior es no llamarla. Sin migraciones ni borrados.
 */
export function dedupeInboxConversations(conversations: InboxConversation[]): InboxConversation[] {
  if (!Array.isArray(conversations)) return []

  // Identidades que ya tiene cobertura canónica.
  const canonicalIdentities = new Set<string>()
  for (const c of conversations) {
    if (!isCanonicalInboxKey(c.key)) continue
    const id = inboxIdentity(c)
    if (id) canonicalIdentities.add(id)
  }

  const out: InboxConversation[] = []
  const seenLegacy = new Set<string>()
  for (const c of conversations) {
    const id = inboxIdentity(c)
    if (isCanonicalInboxKey(c.key)) {
      out.push(c)
      continue
    }
    // Regla 4: sin identidad, pasa sin deduplicar.
    if (!id) {
      out.push(c)
      continue
    }
    // Regla 2: legacy tapada por una canónica de la misma identidad.
    if (canonicalIdentities.has(id)) continue
    // Regla 3: duplicada dentro de su generación (primera aparición gana).
    if (seenLegacy.has(id)) continue
    seenLegacy.add(id)
    out.push(c)
  }
  return out
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

// (UNIFICACIÓN 2026-11-21) La fuente legacy del daemon (tabla
// WhatsAppConversation) fue retirada: el daemon Baileys escribe directamente en
// ChannelConversation/ChannelMessage y la bandeja lee SOLO del modelo canónico
// (+ timeline para TG/IG/FB hasta que esos canales tengan conversaciones canónicas).

/**
 * Conversaciones derivadas de timeline (Telegram e Instagram).
 * Agrupa por cliente y calcula último mensaje + no leídos (metadata.direction==='in' sin readAt).
 */
async function listTimelineConversations(
  orgId: string,
  channel: 'telegram' | 'instagram' | 'facebook',
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

/** Conversaciones nuevas: identidad estable por ChannelConversation y conexión exacta. */
async function listCanonicalChannelConversations(orgId: string, limit: number): Promise<InboxConversation[]> {
  try {
    const rows = await db.channelConversation.findMany({
      where: { organizationId: orgId, status: 'active', connection: { is: { organizationId: orgId } } },
      include: {
        connection: { select: { id: true, organizationId: true, displayName: true, status: true, channel: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { direction: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    })
    return rows
      // (UNIFICACIÓN) Messenger vive como channel='messenger' en las conexiones;
      // la bandeja lo presenta como 'facebook'.
      .filter((row) => ['whatsapp', 'instagram', 'facebook', 'messenger', 'telegram', 'tiktok'].includes(row.channel))
      .map((row) => ({
        key: 'cc:' + row.id,
        channel: (row.channel === 'messenger' ? 'facebook' : row.channel) as InboxChannel,
        channelLabel: CHANNEL_LABELS[row.channel as InboxChannel] || 'WhatsApp',
        connectionId: row.connection.id ?? null,
        connectionName: row.connection.displayName || null,
        contactName: row.contactName || row.externalContactKey,
        contactHandle: row.externalContactKey,
        clientId: null,
        lastMessage: row.lastMessage || '',
        lastMessageAt: row.lastMessageAt?.toISOString() || null,
        lastMessageFrom: row.messages[0]?.direction === 'out' ? 'out' as const : 'in' as const,
        unreadCount: row.unreadCount,
        isAutoReply: false,
      }))
  } catch (err) {
    console.error('[inbox] conversaciones canónicas no disponibles', err)
    return []
  }
}

// ---------- (F3) filtros por canal, cuenta y búsqueda (puros, testeables) ----------

export interface InboxFilters {
  /** Canal exacto. `undefined` = todos los canales. */
  channel?: InboxChannel
  /** Cuenta conectada (ChannelConnection id). `undefined` = todas las cuentas. */
  connectionId?: string
  /** Búsqueda libre sobre contacto, handle y último mensaje. `''`/`undefined` = sin filtro. */
  query?: string
}

const SEARCHABLE_FIELDS = ['contactName', 'contactHandle', 'lastMessage'] as const

/**
 * Normaliza texto para búsqueda: minúsculas y sin acentos (NFD + strip de
 * diacríticos). Así "José" coincide con "jose" y "+57 300" con "57300"
 * (el número se busca con o sin '+', aunque con espacios intermedios la
 * coincidencia es por subcadena del texto normalizado).
 */
export function normalizeSearchText(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return ''
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * (F3 / F3-T04) Aplica los filtros de bandeja ANTES del recorte por límite:
 * la ventana de resultados queda llena de conversaciones que CUMPLEN el
 * filtro (el recorte client-side previo mostraba ventanas medio vacías).
 *
 * Reglas:
 *  - `channel`: igualdad exacta del canal.
 *  - `connectionId`: solo coinciden las canónicas enlazadas a ESA cuenta; las
 *    legacy (sin conexión explícita) quedan fuera — no se puede afirmar de
 *    qué cuenta vinieron sin inventar datos.
 *  - `query`: subcadena sobre nombre de contacto, handle y último mensaje,
 *    normalizada (sin acentos, minúsculas). Con query corta (<1 tras
 *    normalizar) se ignora, no filtra todo.
 */
export function filterInboxConversations(
  conversations: InboxConversation[],
  filters: InboxFilters,
): InboxConversation[] {
  if (!Array.isArray(conversations)) return []
  const channel = filters?.channel
  const connectionId = filters?.connectionId
  const query = normalizeSearchText(filters?.query)
  return conversations.filter((c) => {
    if (channel && c.channel !== channel) return false
    if (connectionId && c.connectionId !== connectionId) return false
    if (query.length >= 1) {
      const haystack = SEARCHABLE_FIELDS.map((f) => normalizeSearchText(c[f])).join('\n')
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

/** Lista unificada, ordenada por actividad reciente y UNIFICADA por contacto (M7).
 *  (UNIFICACIÓN 2026-11-21) La fuente WhatsApp es EXCLUSIVAMENTE canónica
 *  (cc:*, escrita por el daemon Baileys y los webhooks); el historial legacy
 *  queda visible en la ficha 360. (F3) los filtros se aplican ANTES del recorte. */
export async function listInbox(orgId: string, limit = 100, filters: InboxFilters = {}): Promise<InboxConversation[]> {
  const [canonical, tg, ig, fb] = await Promise.all([
    listCanonicalChannelConversations(orgId, limit),
    listTimelineConversations(orgId, 'telegram', limit),
    listTimelineConversations(orgId, 'instagram', limit),
    listTimelineConversations(orgId, 'facebook', limit),
  ])
  return filterInboxConversations(
    dedupeInboxConversations(
      [...canonical, ...tg, ...ig, ...fb]
        .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')),
    ),
    filters,
  ).slice(0, limit)
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
  // WhatsApp: resolución canónica. El vínculo conversación↔cliente vive en
  // ChannelConversation.metadata.clientId (escrito por el daemon/webhooks) con
  // respaldo por teléfono normalizado del cliente.
  try {
    const client = await db.client.findUnique({ where: { id: clientId }, select: { phone: true } })
    const waConversations = await db.channelConversation.findMany({
      where: {
        organizationId: orgId,
        channel: 'whatsapp',
        status: 'active',
        connection: { is: { organizationId: orgId, status: 'connected' } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      select: { id: true, externalContactKey: true, metadata: true },
    })
    const phoneDigits = normalizeWaPhone(client?.phone)
    const conv =
      waConversations.find((c) => safeParseMetadataObject(c.metadata).clientId === clientId) ||
      waConversations.find((c) => phoneDigits && normalizeWaPhone(c.externalContactKey) === phoneDigits)
    if (conv) {
      options.push({
        key: `cc:${conv.id}`,
        channel: 'whatsapp',
        channelLabel: 'WhatsApp',
        contactHandle: conv.externalContactKey,
      })
    }
  } catch (err) {
    console.error('[inbox] canal whatsapp (cliente) no disponible', err)
  }

  try {
    const events = await db.timelineEvent.findMany({
      where: { organizationId: orgId, clientId, type: { in: ['telegram', 'instagram', 'facebook', 'tiktok'] } },
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
    const fb = events.find((e) => {
      const m = safeMetadata(e.metadata)
      return e.type === 'facebook' && !!(m.senderId || m.recipientId)
    })
    if (fb) {
      const m = safeMetadata(fb.metadata)
      options.push({
        key: makeInboxKey('facebook', clientId),
        channel: 'facebook',
        channelLabel: 'Messenger',
        contactHandle: String(m.senderId || m.recipientId),
      })
    }
    const tt = events.find((e) => {
      const m = safeMetadata(e.metadata)
      return e.type === 'tiktok' && !!m.canonicalConversationId && !!m.conversationId
    })
    if (tt) {
      const m = safeMetadata(tt.metadata)
      options.push({
        key: `cc:${String(m.canonicalConversationId)}`,
        channel: 'tiktok',
        channelLabel: 'TikTok',
        contactHandle: String(m.conversationId),
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

  if (key.startsWith('cc:')) {
    const conversation = await db.channelConversation.findFirst({
      where: { id: parsed.id, organizationId: orgId, connection: { is: { organizationId: orgId } } },
      select: { id: true, channel: true, connection: { select: { organizationId: true, status: true, channel: true } } },
    })
    if (!conversation || conversation.connection.status !== 'connected' || conversation.channel !== conversation.connection.channel) return []
    const [rows, pending] = await Promise.all([
      db.channelMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, direction: true, senderType: true, body: true, createdAt: true, messageType: true, metadata: true },
      }),
      db.channelOutboundMessage.findMany({
        where: { conversationId: conversation.id, status: { in: ['queued', 'sending', 'failed', 'unknown'] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, body: true, status: true, createdAt: true },
      }),
    ])
    const persisted = rows.reverse().map((message) => ({
      id: message.id,
      direction: message.direction === 'out' ? 'out' as const : 'in' as const,
      senderType: message.senderType === 'agent' ? 'agent' as const : message.senderType === 'user' ? 'user' as const : 'contact' as const,
      text: message.body,
      createdAt: message.createdAt.toISOString(),
      ...(message.messageType === 'voice' ? { messageType: 'voice' } : {}),
      ...(() => {
        try {
          const metadata = message.metadata ? JSON.parse(message.metadata) as { deliveryStatus?: string } : {}
          return ['sent', 'delivered', 'read'].includes(metadata.deliveryStatus || '')
            ? { deliveryStatus: metadata.deliveryStatus as 'sent' | 'delivered' | 'read' }
            : metadata.deliveryStatus === 'failed'
              ? { deliveryStatus: 'delivery_failed' as const }
              : {}
        } catch {
          return {}
        }
      })(),
    }))
    const pendingMessages = pending.map((message) => ({
      id: `outbox:${message.id}`,
      direction: 'out' as const,
      senderType: 'user' as const,
      text: message.body,
      createdAt: message.createdAt.toISOString(),
      deliveryStatus: message.status as 'queued' | 'sending' | 'failed' | 'unknown',
    }))
    return [...persisted, ...pendingMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  if (!parsed.channel) return []

  if (parsed.channel === 'whatsapp') {
    // (UNIFICACIÓN 2026-11-21) Las keys legacy 'wa:<id>' fueron retiradas junto
    // con las tablas del daemon; el historial Baileys vive bajo 'cc:<id>'.
    return []
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
    if (key.startsWith('cc:')) {
      const conversation = await db.channelConversation.findFirst({
        where: { id: parsed.id, organizationId: orgId, connection: { is: { organizationId: orgId } } },
        select: { channel: true, connection: { select: { organizationId: true, channel: true, status: true } } },
      })
      if (!conversation || conversation.connection.status !== 'connected' || conversation.channel !== conversation.connection.channel) return
      await db.channelConversation.updateMany({
        where: {
          id: parsed.id,
          organizationId: orgId,
          connection: { is: { organizationId: orgId, status: 'connected' } },
        },
        data: { unreadCount: 0 },
      })
      return
    }
    if (!parsed.channel) return
    if (parsed.channel === 'whatsapp') {
      // Keys legacy 'wa:' retiradas: nada que marcar (no-op).
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
 * Los envíos legacy directos se han retirado. El endpoint de bandeja solo
 * admite conversaciones canónicas y persiste una intención en la outbox.
 */
export async function sendInboxMessage(opts: {
  orgId: string
  userId: string
  key: string
  contactHandle: string
  clientId?: string | null
  text: string
}): Promise<InboxSendResult> {
  if (opts.key.startsWith('cc:')) {
    return { ok: false, error: 'Usa el endpoint de la bandeja para encolar la conversación canónica.' }
  }
  return { ok: false, error: 'El envío legacy está deshabilitado; usa una conversación canónica de la outbox.' }
}
