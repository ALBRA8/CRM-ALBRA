import { z } from 'zod'
import { db } from '../db'
import { assignLeadRoundRobin } from '../lead-routing'
import { auditAndTimeline } from '../api-helpers'

/**
 * CAPA DE ACCIONES CRM (CHALECO) — contrato canónico de acciones de negocio.
 *
 * Extraída del antiguo /api/chat (agente propietario, eliminado). Estas
 * operaciones son del PUESTO (CRM), no del trabajador: cualquier host
 * autorizado — un agente general, otro agente, un servicio, un script — puede
 * ejecutarlas a través de:
 *
 *   - REST:  POST /api/crm/actions  (JWT de usuario o API key de la org)
 *   - MCP:   tools del servidor /api/mcp (create_client, create_opportunity, …)
 *   - UI:    los propios módulos del CRM
 *
 * Cada acción declara:
 *   kind     → 'read' (solo consulta) | 'write' (muta datos comerciales)
 *   permiso  → capability RBAC que exige el endpoint REST
 *   schema   → zod: valida los params ANTES de tocar la BD; un parámetro
 *              inválido produce error de campo estructurado, nunca una
 *              escritura degradada en silencio.
 *
 * Herramientas SENSIBLES que NO existen por diseño: envío masivo, borrado,
 * movimientos de dinero. El catálogo es create_/schedule_/add_note + 2 reads.
 */

export const CRM_ACTIONS: Record<
  string,
  { kind: 'read' | 'write'; permiso: string; schema: z.ZodType }
> = {
  create_client: {
    kind: 'write',
    permiso: 'clients.write',
    schema: z.object({
      name: z.string().min(1).max(120),
      phone: z.string().max(40).optional(),
      email: z.string().max(160).optional(),
    }),
  },
  create_opportunity: {
    kind: 'write',
    permiso: 'opportunities.write',
    schema: z.object({
      clientId: z.string().max(64).optional(),
      title: z.string().min(1).max(160),
      amount: z.coerce.number().min(0).max(1_000_000_000_000).optional(),
    }),
  },
  schedule_reservation: {
    kind: 'write',
    permiso: 'reservations.write',
    schema: z.object({
      clientId: z.string().max(64).optional(),
      title: z.string().min(1).max(160),
      startsAt: z.string().min(4).max(40),
    }),
  },
  add_note: {
    kind: 'write',
    permiso: 'clients.write',
    schema: z.object({ clientId: z.string().max(64), content: z.string().min(1).max(2000) }),
  },
  quote_summary: {
    kind: 'read',
    permiso: 'quotes.read',
    schema: z.object({ clientId: z.string().max(64) }),
  },
  list_recent_clients: {
    kind: 'read',
    permiso: 'clients.read',
    schema: z.object({}),
  },
}

export interface CrmActionMeta {
  name: string
  kind: 'read' | 'write'
  permiso: string
  params: Record<string, string>
  description: string
}

/** Catálogo auto-descriptivo para hosts (usado por GET /api/crm/actions). */
export function crmActionsCatalog(): CrmActionMeta[] {
  return [
    {
      name: 'create_client',
      kind: 'write',
      permiso: 'clients.write',
      params: { name: 'string (1-120)', phone: 'string? (máx 40)', email: 'string? (máx 160)' },
      description: 'Registra un cliente nuevo (status prospect, entra al round-robin de leads).',
    },
    {
      name: 'create_opportunity',
      kind: 'write',
      permiso: 'opportunities.write',
      params: { clientId: 'string?', title: 'string (1-160)', amount: 'number?' },
      description: 'Crea una oportunidad abierta en la primera etapa del pipeline.',
    },
    {
      name: 'schedule_reservation',
      kind: 'write',
      permiso: 'reservations.write',
      params: { clientId: 'string?', title: 'string (1-160)', startsAt: 'string ISO 8601' },
      description: 'Agenda una cita/reserva y dispara el workflow reservation_created.',
    },
    {
      name: 'add_note',
      kind: 'write',
      permiso: 'clients.write',
      params: { clientId: 'string', content: 'string (1-2000)' },
      description: 'Agrega una nota al timeline del cliente.',
    },
    {
      name: 'quote_summary',
      kind: 'read',
      permiso: 'quotes.read',
      params: { clientId: 'string' },
      description: 'Resume las últimas 10 cotizaciones del cliente con su total.',
    },
    {
      name: 'list_recent_clients',
      kind: 'read',
      permiso: 'clients.read',
      params: {},
      description: 'Lista los últimos 10 clientes de la organización con sus ids.',
    },
  ]
}

export interface CrmActionResult {
  ok: boolean
  summary: string
  data?: unknown
  clientId?: string | null
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

/**
 * Ejecuta una acción CRM con procedencia explícita (`via`): 'crm-api' cuando
 * la invoca un host por REST, 'mcp' vía tools MCP, etc. La procedencia queda
 * registrada en auditoría y timeline (evidencia de quién movió los datos).
 */
export async function executeCrmAction(
  orgId: string,
  userId: string | null,
  action: string,
  params: Record<string, unknown>,
  via: string = 'crm-api'
): Promise<CrmActionResult> {
  switch (action) {
    case 'create_client': {
      const name = str(params.name).trim()
      if (!name) return { ok: false, summary: 'Falta el nombre del cliente' }
      const client = await db.client.create({
        data: {
          organizationId: orgId,
          name: name.slice(0, 120),
          phone: str(params.phone).trim() || null,
          email: str(params.email).trim() || null,
          status: 'prospect',
          source: via,
          // Los leads captados por hosts/automatización también entran al round-robin
          assignedToId: await assignLeadRoundRobin(orgId),
          createdById: userId,
          lastContactAt: new Date(),
        },
      })
      await auditAndTimeline({
        orgId,
        userId,
        action: 'created',
        entity: 'client',
        entityId: client.id,
        details: { via, name: client.name },
        clientId: client.id,
        timelineType: 'system',
        timelineTitle: `Cliente creado vía ${via}: ${client.name}`,
        source: via,
      })
      try {
        const { runWorkflowsForTrigger } = await import('../workflow-engine')
        await runWorkflowsForTrigger({ orgId, type: 'client_created', payload: { ...client, source: via } as unknown as Record<string, unknown> })
      } catch (err) {
        console.error('[crm-actions] workflow client_created', err)
      }
      return { ok: true, summary: `Cliente "${client.name}" creado`, data: client, clientId: client.id }
    }

    case 'create_opportunity': {
      const title = str(params.title).trim()
      if (!title) return { ok: false, summary: 'Falta el título de la oportunidad' }
      const clientId = str(params.clientId) || null
      if (clientId) {
        const client = await db.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true } })
        if (!client) return { ok: false, summary: `Cliente ${clientId} no existe en esta organización` }
      }
      const stage = await db.pipelineStage.findFirst({ where: { organizationId: orgId }, orderBy: { order: 'asc' } })
      const amount = Number(params.amount ?? 0) || 0
      const opp = await db.opportunity.create({
        data: {
          organizationId: orgId,
          title: title.slice(0, 160),
          clientId,
          stageId: stage?.id || null,
          amount,
          status: 'open',
          source: via,
          createdById: userId,
        },
      })
      await auditAndTimeline({
        orgId,
        userId,
        action: 'created',
        entity: 'opportunity',
        entityId: opp.id,
        details: { via, title: opp.title, amount },
        clientId,
        opportunityId: opp.id,
        timelineType: 'stage_change',
        timelineTitle: `Oportunidad creada vía ${via}: ${opp.title}`,
        source: via,
      })
      return { ok: true, summary: `Oportunidad "${opp.title}" creada (${amount || 0} USD)`, data: opp, clientId }
    }

    case 'schedule_reservation': {
      const title = str(params.title).trim()
      const startsAtRaw = str(params.startsAt)
      if (!title || !startsAtRaw) return { ok: false, summary: 'Faltan título o fecha de la reserva' }
      const startsAt = new Date(startsAtRaw)
      if (Number.isNaN(startsAt.getTime())) return { ok: false, summary: `Fecha inválida: ${startsAtRaw}` }
      const clientId = str(params.clientId) || null
      if (clientId) {
        const client = await db.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true } })
        if (!client) return { ok: false, summary: `Cliente ${clientId} no existe en esta organización` }
      }
      const reservation = await db.reservation.create({
        data: {
          organizationId: orgId,
          clientId,
          title: title.slice(0, 160),
          startsAt,
          status: 'scheduled',
          userId,
        },
      })
      await auditAndTimeline({
        orgId,
        userId,
        action: 'created',
        entity: 'reservation',
        entityId: reservation.id,
        details: { via, title, startsAt: startsAt.toISOString() },
        clientId,
        reservationId: reservation.id,
        timelineType: 'meeting',
        timelineTitle: `Cita agendada vía ${via}: ${title}`,
        timelineDescription: startsAt.toLocaleString('es-CO'),
        source: via,
      })
      try {
        const { runWorkflowsForTrigger } = await import('../workflow-engine')
        await runWorkflowsForTrigger({
          orgId,
          type: 'reservation_created',
          payload: { reservationId: reservation.id, clientId, title, startsAt: startsAt.toISOString() },
        })
      } catch (err) {
        console.error('[crm-actions] workflow reservation_created', err)
      }
      return { ok: true, summary: `Cita "${title}" agendada para ${startsAt.toLocaleString('es-CO')}`, data: reservation, clientId }
    }

    case 'add_note': {
      const clientId = str(params.clientId)
      const content = str(params.content).trim()
      if (!clientId || !content) return { ok: false, summary: 'Faltan clientId o contenido de la nota' }
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true, name: true } })
      if (!client) return { ok: false, summary: `Cliente ${clientId} no existe en esta organización` }
      await db.clientHistory.create({
        data: { organizationId: orgId, clientId, type: 'note', title: `Nota vía ${via}`, description: content.slice(0, 2000), userId },
      })
      await auditAndTimeline({
        orgId,
        userId,
        action: 'created',
        entity: 'client_history',
        details: { via },
        clientId,
        timelineType: 'note',
        timelineTitle: `Nota agregada vía ${via}`,
        timelineDescription: content.slice(0, 300),
        source: via,
      })
      return { ok: true, summary: `Nota agregada a ${client.name}`, clientId }
    }

    case 'quote_summary': {
      const clientId = str(params.clientId)
      if (!clientId) return { ok: false, summary: 'Falta clientId' }
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true, name: true } })
      if (!client) return { ok: false, summary: `Cliente ${clientId} no existe en esta organización` }
      const quotes = await db.quote.findMany({
        where: { organizationId: orgId, clientId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { number: true, status: true, total: true, currency: true, createdAt: true },
      })
      if (quotes.length === 0) return { ok: true, summary: `${client.name} no tiene cotizaciones`, data: { quotes: [] }, clientId }
      const total = quotes.reduce((acc, q) => acc + q.total, 0)
      return {
        ok: true,
        summary: `${client.name} tiene ${quotes.length} cotizaciones por ${total.toFixed(2)}`,
        data: { quotes },
        clientId,
      }
    }

    case 'list_recent_clients': {
      const clients = await db.client.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, phone: true, email: true, status: true, lastContactAt: true, createdAt: true },
      })
      return { ok: true, summary: `${clients.length} clientes recientes`, data: { clients } }
    }

    default:
      return { ok: false, summary: `Acción desconocida: ${action}` }
  }
}
