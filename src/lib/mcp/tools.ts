/**
 * CRM ALBRA — Herramientas MCP (Task 27, Opción B: el CRM como Servidor MCP).
 *
 * Cada herramienta opera ESTRICTAMENTE sobre ctx.orgId (aislamiento multi-
 * tenant: la organización SIEMPRE viene de la API key autenticada, jamás de
 * los argumentos del cliente). Los handlers reutilizan la misma lógica que
 * las rutas API (auditoría, timeline, workflows, envío por daemon) para que
 * una operación hecha por una IA externa sea indistinguible de una hecha
 * desde la UI.
 */

import { db } from '@/lib/db'
import {
  listInbox,
  getInboxMessages,
  sendInboxMessage,
  normalizeWaPhone,
  type InboxChannel,
} from '@/lib/inbox'
import { auditAndTimeline } from '@/lib/api-helpers'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { assignLeadRoundRobin } from '@/lib/lead-routing'
import type { McpContext, McpTool } from './protocol'

// ---------- Helpers de argumentos ----------

function s(args: Record<string, unknown>, key: string): string | null {
  const v = args[key]
  if (v === undefined || v === null) return null
  const str = String(v).trim()
  return str === '' ? null : str
}

function required(args: Record<string, unknown>, key: string): string {
  const v = s(args, key)
  if (!v) throw new Error(`Falta el campo requerido: ${key}`)
  return v
}

function nOrNull(args: Record<string, unknown>, key: string): number | null {
  const v = args[key]
  if (v === undefined || v === null || v === '') return null
  const num = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(num) ? num : null
}

function limitOf(args: Record<string, unknown>, fallback: number, max: number): number {
  const v = nOrNull(args, 'limit')
  if (v === null) return fallback
  return Math.min(Math.max(Math.trunc(v), 1), max)
}

/** Usuario sintético para trazabilidad de operaciones hechas vía MCP. */
const MCP_USER = 'mcp-api'
const MCP_SOURCE = 'integration'

// ---------- Herramientas: Clientes ----------

const listClients: McpTool = {
  name: 'list_clients',
  description:
    'Lista clientes de la organización con búsqueda opcional (nombre, correo, teléfono o cédula/DNI). Devuelve id, nombre, contacto, estado y conteo de oportunidades.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto de búsqueda (nombre, correo, teléfono o cédula)' },
      status: { type: 'string', enum: ['prospect', 'active', 'inactive'], description: 'Filtro por estado' },
      limit: { type: 'number', description: 'Máximo a devolver (1-50, por defecto 20)' },
    },
  },
  async handler(args, ctx) {
    const query = s(args, 'query')
    const status = s(args, 'status')
    const limit = limitOf(args, 20, 50)
    const clients = await db.client.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(status ? { status } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query } },
                { email: { contains: query } },
                { phone: { contains: query } },
                { cedula: { contains: query } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { _count: { select: { opportunities: true } } },
    })
    return {
      total: clients.length,
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        cedula: c.cedula,
        status: c.status,
        source: c.source,
        lastContactAt: c.lastContactAt,
        opportunitiesCount: c._count.opportunities,
      })),
    }
  },
}

const createClient: McpTool = {
  name: 'create_client',
  description:
    'Crea un cliente nuevo (prospecto) en la organización. Dispara las mismas automatizaciones y registros de auditoría que la creación manual.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre del cliente o contacto' },
      phone: { type: 'string', description: 'Teléfono con código de país (ej. +57 300 111 0000). Recomendado para poder escribirle por WhatsApp.' },
      email: { type: 'string', description: 'Correo electrónico' },
      cedula: { type: 'string', description: 'Cédula / DNI / identificación fiscal' },
      address: { type: 'string', description: 'Dirección' },
      notes: { type: 'string', description: 'Notas internas sobre el cliente' },
      source: { type: 'string', description: 'Origen del cliente (por defecto "api")' },
    },
    required: ['name'],
  },
  async handler(args, ctx) {
    const name = required(args, 'name')
    const phone = s(args, 'phone')
    if (!phone) throw new Error('El campo phone es obligatorio para poder contactar al cliente (usa el formato +57…)')

    const assignedToId = await assignLeadRoundRobin(ctx.orgId)
    const created = await db.client.create({
      data: {
        organizationId: ctx.orgId,
        name,
        phone,
        email: s(args, 'email'),
        cedula: s(args, 'cedula'),
        address: s(args, 'address'),
        notes: s(args, 'notes'),
        status: 'prospect',
        source: s(args, 'source') ?? 'api',
        lastContactAt: new Date(),
        assignedToId,
      },
    })

    await auditAndTimeline({
      orgId: ctx.orgId,
      userId: null,
      action: 'created',
      entity: 'client',
      entityId: created.id,
      details: { name: created.name, via: 'mcp' },
      clientId: created.id,
      timelineType: 'system',
      timelineTitle: `Cliente creado vía MCP: ${created.name}`,
      source: MCP_SOURCE,
    })
    await runWorkflowsForTrigger({
      orgId: ctx.orgId,
      type: 'client_created',
      payload: {
        clientId: created.id,
        id: created.id,
        name: created.name,
        clientName: created.name,
        phone: created.phone,
        email: created.email,
        source: created.source,
        status: created.status,
      },
    })
    return {
      created: true,
      client: { id: created.id, name: created.name, phone: created.phone, status: created.status },
    }
  },
}

const getClient: McpTool = {
  name: 'get_client',
  description:
    'Detalle completo de un cliente: datos de contacto, oportunidades abiertas, cotizaciones recientes y últimos 20 eventos de su historial (timeline).',
  inputSchema: {
    type: 'object',
    properties: { clientId: { type: 'string', description: 'ID del cliente (list_clients lo devuelve)' } },
    required: ['clientId'],
  },
  async handler(args, ctx) {
    const clientId = required(args, 'clientId')
    const client = await db.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId } })
    if (!client) throw new Error('Cliente no encontrado en esta organización')

    const [opportunities, quotes, timeline] = await Promise.all([
      db.opportunity.findMany({
        where: { organizationId: ctx.orgId, clientId },
        include: { stage: { select: { name: true, isWon: true, isLost: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.quote.findMany({
        where: { organizationId: ctx.orgId, clientId },
        select: { id: true, number: true, total: true, currency: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      db.timelineEvent.findMany({
        where: { organizationId: ctx.orgId, clientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, title: true, description: true, createdAt: true },
      }),
    ])

    return {
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
        cedula: client.cedula,
        address: client.address,
        notes: client.notes,
        status: client.status,
        source: client.source,
        lastContactAt: client.lastContactAt,
        createdAt: client.createdAt,
      },
      opportunities: opportunities.map((o) => ({
        id: o.id,
        title: o.title,
        amount: o.amount,
        currency: o.currency,
        status: o.status,
        stage: o.stage?.name ?? null,
      })),
      quotes,
      timeline,
    }
  },
}

const addClientNote: McpTool = {
  name: 'add_client_note',
  description:
    'Agrega una nota al historial del cliente (queda en su timeline y en la auditoría). Útil para registrar llamadas, acuerdos o contexto de la conversación.',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'ID del cliente' },
      note: { type: 'string', description: 'Texto de la nota' },
    },
    required: ['clientId', 'note'],
  },
  async handler(args, ctx) {
    const clientId = required(args, 'clientId')
    const note = required(args, 'note')
    const client = await db.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId }, select: { id: true, name: true } })
    if (!client) throw new Error('Cliente no encontrado en esta organización')

    const history = await db.clientHistory.create({
      data: { organizationId: ctx.orgId, clientId, type: 'note', title: 'Nota vía MCP', description: note.slice(0, 2000), userId: null },
    })
    await auditAndTimeline({
      orgId: ctx.orgId,
      userId: null,
      action: 'created',
      entity: 'client_note',
      entityId: history.id,
      details: { clientId, via: 'mcp' },
      clientId,
      timelineType: 'note',
      timelineTitle: 'Nota (MCP)',
      timelineDescription: note.slice(0, 300),
      source: MCP_SOURCE,
    })
    return { created: true, noteId: history.id }
  },
}

// ---------- Herramientas: Pipeline ----------

const listPipelineStages: McpTool = {
  name: 'list_pipeline_stages',
  description:
    'Lista las etapas del pipeline comercial en orden, indicando cuál cuenta como ganada (isWon) o perdida (isLost) y cuántas oportunidades hay en cada una.',
  inputSchema: { type: 'object', properties: {} },
  async handler(_args, ctx) {
    const stages = await db.pipelineStage.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { opportunities: true } } },
    })
    return {
      stages: stages.map((st) => ({
        id: st.id,
        name: st.name,
        order: st.order,
        isWon: st.isWon,
        isLost: st.isLost,
        probability: st.probability,
        opportunitiesCount: st._count.opportunities,
      })),
    }
  },
}

const listOpportunities: McpTool = {
  name: 'list_opportunities',
  description: 'Lista oportunidades (negocios) con su etapa, cliente y monto. Filtrable por estado, etapa o cliente.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['open', 'won', 'lost'], description: 'Estado de la oportunidad' },
      stageId: { type: 'string', description: 'Filtrar por etapa (list_pipeline_stages)' },
      clientId: { type: 'string', description: 'Filtrar por cliente' },
      limit: { type: 'number', description: 'Máximo a devolver (1-50, por defecto 20)' },
    },
  },
  async handler(args, ctx) {
    const status = s(args, 'status')
    const stageId = s(args, 'stageId')
    const clientId = s(args, 'clientId')
    const opportunities = await db.opportunity.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(status ? { status } : {}),
        ...(stageId ? { stageId } : {}),
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limitOf(args, 20, 50),
      include: {
        stage: { select: { name: true, isWon: true, isLost: true } },
        client: { select: { id: true, name: true, phone: true } },
      },
    })
    return {
      total: opportunities.length,
      opportunities: opportunities.map((o) => ({
        id: o.id,
        title: o.title,
        amount: o.amount,
        currency: o.currency,
        status: o.status,
        stage: o.stage?.name ?? null,
        stageId: o.stageId,
        client: o.client ? { id: o.client.id, name: o.client.name, phone: o.client.phone } : null,
        expectedCloseDate: o.expectedCloseDate,
      })),
    }
  },
}

const createOpportunity: McpTool = {
  name: 'create_opportunity',
  description:
    'Crea una oportunidad comercial para un cliente. Si no se indica etapa, entra a la primera del pipeline. Registra timeline y auditoría igual que la UI.',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'ID del cliente (create_client o list_clients)' },
      title: { type: 'string', description: 'Título del negocio (ej. "Venta de asesoría contable")' },
      amount: { type: 'number', description: 'Valor estimado del negocio' },
      currency: { type: 'string', description: 'Moneda ISO (por defecto la de la organización)' },
      notes: { type: 'string', description: 'Notas iniciales' },
    },
    required: ['title'],
  },
  async handler(args, ctx) {
    const title = required(args, 'title')
    const clientId = s(args, 'clientId')
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId }, select: { id: true } })
      if (!client) throw new Error('Cliente no encontrado en esta organización')
    }
    const stage = await db.pipelineStage.findFirst({ where: { organizationId: ctx.orgId }, orderBy: { order: 'asc' } })
    const settings = await db.settings.findUnique({ where: { organizationId: ctx.orgId }, select: { currency: true } })

    const created = await db.opportunity.create({
      data: {
        organizationId: ctx.orgId,
        title,
        clientId: clientId ?? null,
        stageId: stage?.id ?? null,
        amount: nOrNull(args, 'amount') ?? 0,
        currency: s(args, 'currency') ?? settings?.currency ?? 'USD',
        probability: stage ? Math.round(stage.probability * 100) : 50,
        status: 'open',
        notes: s(args, 'notes'),
        source: 'api',
        createdById: null,
      },
    })

    await auditAndTimeline({
      orgId: ctx.orgId,
      userId: null,
      action: 'created',
      entity: 'opportunity',
      entityId: created.id,
      details: { name: created.title, amount: created.amount, via: 'mcp' },
      clientId: created.clientId,
      opportunityId: created.id,
      timelineType: 'system',
      timelineTitle: `Nueva oportunidad vía MCP: ${created.title}`,
      source: MCP_SOURCE,
    })
    return { created: true, opportunity: { id: created.id, title: created.title, amount: created.amount, stage: stage?.name ?? null } }
  },
}

/**
 * Réplica fiel de la semántica de PUT /api/opportunities/[id]: mover a etapa
 * ganada/perdida ajusta el estado, y ganar crea la Transaction de ingreso.
 */
async function closeOrStageOpportunity(opts: {
  orgId: string
  oppId: string
  stageId?: string | null
  status?: string | null
  fromMcp: boolean
}): Promise<Record<string, unknown>> {
  const existing = await db.opportunity.findFirst({ where: { id: opts.oppId, organizationId: opts.orgId }, include: { stage: true } })
  if (!existing) throw new Error('Oportunidad no encontrada en esta organización')

  const data: Record<string, unknown> = {}
  let newStage = existing.stage
  let stageChanged = false

  if (opts.stageId && opts.stageId !== existing.stageId) {
    const stage = await db.pipelineStage.findFirst({ where: { id: opts.stageId, organizationId: opts.orgId } })
    if (!stage) throw new Error('Etapa no válida para esta organización')
    newStage = stage
    data.stageId = stage.id
  }

  if (newStage && newStage.id !== (existing.stage?.id ?? null)) {
    stageChanged = true
    if (newStage.isWon && existing.status !== 'won') {
      data.status = 'won'
      data.closedAt = new Date()
    } else if (newStage.isLost && existing.status !== 'lost') {
      data.status = 'lost'
      data.closedAt = new Date()
    }
  }

  if (!opts.stageId && opts.status && ['open', 'won', 'lost'].includes(opts.status) && opts.status !== existing.status) {
    data.status = opts.status
    data.closedAt = opts.status === 'open' ? null : new Date()
    stageChanged = true // dispara timeline/workflow igual que un cambio de etapa
  }

  if (Object.keys(data).length === 0) {
    return { updated: false, reason: 'No hay cambios (ya está en esa etapa/estado)', opportunity: { id: existing.id, status: existing.status, stage: existing.stage?.name ?? null } }
  }

  const fromName = existing.stage?.name ?? 'Sin etapa'
  const toName = (data.stageId ? newStage?.name : undefined) ?? (data.status === 'won' ? 'Ganada' : data.status === 'lost' ? 'Perdida' : fromName)

  await auditAndTimeline({
    orgId: opts.orgId,
    userId: null,
    action: 'stage_changed',
    entity: 'opportunity',
    entityId: existing.id,
    details: { name: existing.title, from: fromName, to: toName, via: opts.fromMcp ? 'mcp' : undefined },
    clientId: existing.clientId,
    opportunityId: existing.id,
    timelineType: 'stage_change',
    timelineTitle: `Etapa: ${fromName} → ${toName}`,
    timelineDescription: existing.title,
    source: MCP_SOURCE,
  })
  await runWorkflowsForTrigger({
    orgId: opts.orgId,
    type: 'opportunity_stage_changed',
    payload: {
      opportunityId: existing.id,
      clientId: existing.clientId,
      fromStage: fromName,
      toStage: toName,
      title: existing.title,
      amount: existing.amount,
    },
  })

  const updated = await db.opportunity.update({ where: { id: existing.id }, data, include: { stage: true } })

  let transactionCreated = false
  if (updated.status === 'won' && existing.status !== 'won' && updated.amount > 0) {
    await db.transaction.create({
      data: {
        organizationId: opts.orgId,
        type: 'ingreso',
        category: 'venta',
        description: `Cierre de oportunidad: ${updated.title}`,
        amount: updated.amount,
        currency: updated.currency,
        clientId: updated.clientId,
        date: new Date(),
      },
    })
    transactionCreated = true
  }

  return {
    updated: true,
    opportunity: { id: updated.id, title: updated.title, status: updated.status, stage: updated.stage?.name ?? null },
    transactionCreated,
  }
}

const updateOpportunity: McpTool = {
  name: 'update_opportunity',
  description:
    'Mueve una oportunidad de etapa (movePipeline) o cambia su estado a won/lost. Si pasa a ganada registra el ingreso en Finanzas y dispara las automatizaciones de cierre, igual que arrastrar la tarjeta en el pipeline.',
  inputSchema: {
    type: 'object',
    properties: {
      opportunityId: { type: 'string', description: 'ID de la oportunidad' },
      stageId: { type: 'string', description: 'Etapa destino (list_pipeline_stages)' },
      status: { type: 'string', enum: ['open', 'won', 'lost'], description: 'Alternativa a stageId: marcar ganada/perdida/reabrir' },
    },
    required: ['opportunityId'],
  },
  async handler(args, ctx) {
    const oppId = required(args, 'opportunityId')
    return closeOrStageOpportunity({
      orgId: ctx.orgId,
      oppId,
      stageId: s(args, 'stageId'),
      status: s(args, 'status'),
      fromMcp: true,
    })
  },
}

// ---------- Herramientas: Cotizaciones ----------

const listQuotes: McpTool = {
  name: 'list_quotes',
  description: 'Lista cotizaciones con su número, cliente, total y estado (draft, sent, accepted, rejected, expired).',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'] },
      clientId: { type: 'string', description: 'Filtrar por cliente' },
      limit: { type: 'number', description: 'Máximo a devolver (1-50, por defecto 20)' },
    },
  },
  async handler(args, ctx) {
    const status = s(args, 'status')
    const clientId = s(args, 'clientId')
    const quotes = await db.quote.findMany({
      where: { organizationId: ctx.orgId, ...(status ? { status } : {}), ...(clientId ? { clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limitOf(args, 20, 50),
      include: { client: { select: { id: true, name: true } }, opportunity: { select: { id: true, title: true } } },
    })
    return {
      total: quotes.length,
      quotes: quotes.map((q) => ({
        id: q.id,
        number: q.number,
        client: q.client?.name ?? null,
        opportunity: q.opportunity?.title ?? null,
        total: q.total,
        currency: q.currency,
        status: q.status,
        createdAt: q.createdAt,
      })),
    }
  },
}

const getQuote: McpTool = {
  name: 'get_quote',
  description: 'Detalle completo de una cotización: líneas (items), subtotal, impuesto, total, validez y notas.',
  inputSchema: {
    type: 'object',
    properties: { quoteId: { type: 'string', description: 'ID de la cotización (list_quotes)' } },
    required: ['quoteId'],
  },
  async handler(args, ctx) {
    const quoteId = required(args, 'quoteId')
    const quote = await db.quote.findFirst({
      where: { id: quoteId, organizationId: ctx.orgId },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true } },
        opportunity: { select: { id: true, title: true } },
        items: { orderBy: { position: 'asc' } },
      },
    })
    if (!quote) throw new Error('Cotización no encontrada en esta organización')
    return {
      quote: {
        id: quote.id,
        number: quote.number,
        status: quote.status,
        currency: quote.currency,
        subtotal: quote.subtotal,
        tax: quote.tax,
        total: quote.total,
        validUntil: quote.validUntil,
        notes: quote.notes,
        client: quote.client,
        opportunity: quote.opportunity?.title ?? null,
        items: quote.items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.subtotal })),
      },
    }
  },
}

// ---------- Herramientas: Conversaciones / WhatsApp ----------

const listConversations: McpTool = {
  name: 'list_conversations',
  description:
    'Lista las conversaciones recientes de todos los canales conectados (WhatsApp, Telegram, Instagram) con su último mensaje y no leídos.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: ['whatsapp', 'telegram', 'instagram'], description: 'Filtrar por canal' },
      limit: { type: 'number', description: 'Máximo a devolver (1-50, por defecto 20)' },
    },
  },
  async handler(args, ctx) {
    const channel = s(args, 'channel') as InboxChannel | null
    const limit = limitOf(args, 20, 50)
    const all = await listInbox(ctx.orgId, limit)
    const filtered = channel ? all.filter((c) => c.channel === channel) : all
    return {
      total: filtered.length,
      conversations: filtered.slice(0, limit).map((c) => ({
        key: c.key,
        channel: c.channel,
        contactName: c.contactName,
        contactHandle: c.contactHandle,
        clientId: c.clientId,
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        lastMessageFrom: c.lastMessageFrom,
        unreadCount: c.unreadCount,
      })),
    }
  },
}

const getConversation: McpTool = {
  name: 'get_conversation',
  description: 'Lee los últimos 50 mensajes de una conversación (usa la key que devuelve list_conversations).',
  inputSchema: {
    type: 'object',
    properties: { conversationKey: { type: 'string', description: 'Key de la conversación (ej. "wa:abc123", "telegram:555…")' } },
    required: ['conversationKey'],
  },
  async handler(args, ctx) {
    const key = required(args, 'conversationKey')
    const messages = await getInboxMessages(ctx.orgId, key)
    return { total: messages.length, messages: messages.slice(-50) }
  },
}

const sendWhatsapp: McpTool = {
  name: 'send_whatsapp',
  description:
    'Envía un mensaje de WhatsApp desde el número conectado de la organización. Acepta clientId (resuelve su conversación o teléfono) o un phone directo con código de país. Requiere el daemon de WhatsApp conectado.',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'ID del cliente (alternativa a phone)' },
      phone: { type: 'string', description: 'Teléfono destino con código de país (ej. "+57 300 111 0000")' },
      text: { type: 'string', description: 'Texto del mensaje (máx. 4000 caracteres)' },
    },
    required: ['text'],
  },
  async handler(args, ctx) {
    const text = required(args, 'text')
    if (text.length > 4000) throw new Error('El mensaje excede 4000 caracteres')

    let key: string
    let contactHandle: string
    let clientId: string | null = null

    const clientIdArg = s(args, 'clientId')
    if (clientIdArg) {
      const client = await db.client.findFirst({ where: { id: clientIdArg, organizationId: ctx.orgId }, select: { id: true, name: true, phone: true } })
      if (!client) throw new Error('Cliente no encontrado en esta organización')
      clientId = client.id
      const conv = await db.whatsAppConversation.findFirst({
        where: { organizationId: ctx.orgId, clientId: client.id },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, contactPhone: true },
      })
      if (conv) {
        key = `wa:${conv.id}`
        contactHandle = conv.contactPhone
      } else {
        const phone = normalizeWaPhone(client.phone)
        if (!phone) throw new Error('El cliente no tiene un teléfono válido para WhatsApp; pasa phone explícitamente')
        key = `wa-new:${phone}`
        contactHandle = phone
      }
    } else {
      const phone = normalizeWaPhone(s(args, 'phone'))
      if (!phone) throw new Error('Indica clientId o un phone válido con código de país (ej. +573001110000)')
      key = `wa-new:${phone}`
      contactHandle = phone
    }

    const result = await sendInboxMessage({ orgId: ctx.orgId, userId: MCP_USER, key, contactHandle, clientId, text })
    if (!result.ok) throw new Error(result.error ?? 'No se pudo enviar el mensaje de WhatsApp')
    return { sent: true, to: contactHandle, clientId }
  },
}

// ---------- Herramientas: Conocimiento y métricas ----------

const listKnowledge: McpTool = {
  name: 'list_knowledge',
  description:
    'Consulta la base de conocimiento de la organización (catálogo, FAQs, políticas) que usa el agente IA. Busca por palabra clave en título y contenido.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Palabra clave a buscar' },
      limit: { type: 'number', description: 'Máximo a devolver (1-20, por defecto 10)' },
    },
  },
  async handler(args, ctx) {
    const query = s(args, 'query')
    const docs = await db.knowledge.findMany({
      where: {
        organizationId: ctx.orgId,
        isActive: true,
        ...(query ? { OR: [{ title: { contains: query } }, { content: { contains: query } }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limitOf(args, 10, 20),
      select: { id: true, title: true, category: true, content: true, updatedAt: true },
    })
    return {
      total: docs.length,
      documents: docs.map((d) => ({ ...d, content: d.content.slice(0, 800) })),
    }
  },
}

/**
 * schedule_reservation — capability extraída del antiguo agente propietario
 * (eliminado): agendar una cita es una operación del puesto (CRM), disponible
 * ahora para cualquier host vía MCP con la misma semántica que la UI
 * (status scheduled + timeline + workflow reservation_created vía trigger).
 */
const scheduleReservation: McpTool = {
  name: 'schedule_reservation',
  description:
    'Agenda una cita/reserva para un cliente (status scheduled). Registra timeline y auditoría igual que la UI; el workflow reservation_created se dispara como el resto del CRM.',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'ID del cliente (create_client o list_clients)' },
      title: { type: 'string', description: 'Título de la cita (ej. "Reunión de presentación")' },
      startsAt: { type: 'string', description: 'Fecha/hora de inicio en ISO 8601 (ej. 2026-10-20T10:00:00-05:00)' },
    },
    required: ['title', 'startsAt'],
  },
  async handler(args, ctx) {
    const title = required(args, 'title')
    const startsAtRaw = required(args, 'startsAt')
    const startsAt = new Date(startsAtRaw)
    if (Number.isNaN(startsAt.getTime())) throw new Error(`Fecha inválida: ${startsAtRaw}`)
    const clientId = s(args, 'clientId')
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId }, select: { id: true } })
      if (!client) throw new Error('Cliente no encontrado en esta organización')
    }
    const created = await db.reservation.create({
      data: {
        organizationId: ctx.orgId,
        clientId: clientId ?? null,
        title,
        startsAt,
        status: 'scheduled',
        userId: null,
      },
    })
    await auditAndTimeline({
      orgId: ctx.orgId,
      userId: null,
      action: 'created',
      entity: 'reservation',
      entityId: created.id,
      details: { title, startsAt: startsAt.toISOString(), via: 'mcp' },
      clientId: created.clientId,
      reservationId: created.id,
      timelineType: 'meeting',
      timelineTitle: `Cita agendada vía MCP: ${title}`,
      timelineDescription: startsAt.toLocaleString('es-CO'),
      source: MCP_SOURCE,
    })
    try {
      const { runWorkflowsForTrigger } = await import('../workflow-engine')
      await runWorkflowsForTrigger({
        orgId: ctx.orgId,
        type: 'reservation_created',
        payload: { reservationId: created.id, clientId, title, startsAt: startsAt.toISOString() },
      })
    } catch (err) {
      console.error('[mcp] workflow reservation_created', err)
    }
    return { created: true, reservation: { id: created.id, title: created.title, startsAt: startsAt.toISOString(), status: created.status } }
  },
}

const getDashboardStats: McpTool = {
  name: 'get_dashboard_stats',
  description: 'Resumen ejecutivo del CRM: clientes, oportunidades abiertas y su valor, ganadas, cotizaciones enviadas/aceptadas y conversaciones sin leer.',
  inputSchema: { type: 'object', properties: {} },
  async handler(_args, ctx) {
    const [clients, oppsOpen, pipeline, oppsWon, quotesSent, quotesAccepted, unread] = await Promise.all([
      db.client.count({ where: { organizationId: ctx.orgId } }),
      db.opportunity.count({ where: { organizationId: ctx.orgId, status: 'open' } }),
      db.opportunity.aggregate({ where: { organizationId: ctx.orgId, status: 'open' }, _sum: { amount: true } }),
      db.opportunity.count({ where: { organizationId: ctx.orgId, status: 'won' } }),
      db.quote.count({ where: { organizationId: ctx.orgId, status: 'sent' } }),
      db.quote.count({ where: { organizationId: ctx.orgId, status: 'accepted' } }),
      db.whatsAppConversation.aggregate({ where: { organizationId: ctx.orgId }, _sum: { unreadCount: true } }),
    ])
    return {
      clients,
      opportunitiesOpen: oppsOpen,
      pipelineValueOpen: pipeline._sum.amount ?? 0,
      opportunitiesWon: oppsWon,
      quotesSent,
      quotesAccepted,
      unreadMessages: unread._sum.unreadCount ?? 0,
    }
  },
}

/** Registro completo de herramientas del Servidor MCP de ALBRA. */
export const CRM_TOOLS: McpTool[] = [
  listClients,
  createClient,
  getClient,
  addClientNote,
  listPipelineStages,
  listOpportunities,
  createOpportunity,
  updateOpportunity,
  scheduleReservation,
  listQuotes,
  getQuote,
  listConversations,
  getConversation,
  sendWhatsapp,
  listKnowledge,
  getDashboardStats,
]

/** Reexportado para tests y para la ruta HTTP. */
export { closeOrStageOpportunity }
export type { McpContext, McpTool } from './protocol'
