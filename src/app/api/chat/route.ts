import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields, auditAndTimeline } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { llmChat, extractJson } from '@/lib/ai'
import { recordTimelineEvent } from '@/lib/timeline'
import { buildNichoContext } from '@/lib/integrations'
import { buildKnowledgeContext } from '@/lib/knowledge'

/**
 * POST /api/chat — AGENTE COMERCIAL con herramientas (tool-calling por JSON).
 *
 * El LLM responde JSON: {"reply": "..."} o {"action": "...", "params": {...}}.
 * Las acciones se ejecutan DIRECTAMENTE en la BD (multi-tenant) y el resultado
 * se devuelve al LLM para redactar la respuesta final. Máximo 3 iteraciones.
 *
 * Respuesta: { content, reply, actions: [{ type, summary }] } (chat-page.tsx lee `content`).
 */

const MAX_ITERATIONS = 3

interface AgentAction {
  type: string
  summary: string
}

interface AgentDecision {
  reply?: string
  action?: string
  params?: Record<string, unknown>
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

// ---------- Ejecución de acciones en BD ----------

async function executeAgentAction(
  orgId: string,
  userId: string | null,
  action: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; summary: string; data?: unknown; clientId?: string | null }> {
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
          source: 'agent',
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
        details: { via: 'agent', name: client.name },
        clientId: client.id,
        timelineType: 'system',
        timelineTitle: `Cliente creado por el agente IA: ${client.name}`,
        source: 'agent',
      })
      try {
        const { runWorkflowsForTrigger } = await import('@/lib/workflow-engine')
        await runWorkflowsForTrigger({ orgId, type: 'client_created', payload: { ...client, source: 'agent' } as unknown as Record<string, unknown> })
      } catch (err) {
        console.error('[chat] workflow client_created', err)
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
          source: 'agent',
          createdById: userId,
        },
      })
      await auditAndTimeline({
        orgId,
        userId,
        action: 'created',
        entity: 'opportunity',
        entityId: opp.id,
        details: { via: 'agent', title: opp.title, amount },
        clientId,
        opportunityId: opp.id,
        timelineType: 'stage_change',
        timelineTitle: `Oportunidad creada por el agente IA: ${opp.title}`,
        source: 'agent',
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
        details: { via: 'agent', title, startsAt: startsAt.toISOString() },
        clientId,
        reservationId: reservation.id,
        timelineType: 'meeting',
        timelineTitle: `Cita agendada por el agente IA: ${title}`,
        timelineDescription: startsAt.toLocaleString('es-CO'),
        source: 'agent',
      })
      try {
        const { runWorkflowsForTrigger } = await import('@/lib/workflow-engine')
        await runWorkflowsForTrigger({
          orgId,
          type: 'reservation_created',
          payload: { reservationId: reservation.id, clientId, title, startsAt: startsAt.toISOString() },
        })
      } catch (err) {
        console.error('[chat] workflow reservation_created', err)
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
        data: { organizationId: orgId, clientId, type: 'note', title: 'Nota del agente IA', description: content.slice(0, 2000), userId },
      })
      await auditAndTimeline({
        orgId,
        userId,
        action: 'created',
        entity: 'client_history',
        details: { via: 'agent' },
        clientId,
        timelineType: 'note',
        timelineTitle: 'Nota agregada por el agente IA',
        timelineDescription: content.slice(0, 300),
        source: 'agent',
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

// ---------- Contexto de la organización ----------

async function buildOrgContext(orgId: string, selectedClientId?: string): Promise<string> {
  const [nichoCtx, recentClients, openOpps, memories, stages, knowledgeCtx] = await Promise.all([
    buildNichoContext(orgId),
    db.client.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, name: true, status: true, phone: true, lastContactAt: true },
    }),
    db.opportunity.findMany({
      where: { organizationId: orgId, status: 'open' },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { id: true, title: true, amount: true, clientId: true, stageId: true },
    }),
    db.agentMemory.findMany({
      where: { organizationId: orgId },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: 15,
      select: { content: true, clientId: true },
    }),
    db.pipelineStage.findMany({
      where: { organizationId: orgId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true },
    }),
    buildKnowledgeContext(orgId),
  ])

  let selected = ''
  if (selectedClientId) {
    const client = await db.client.findFirst({
      where: { id: selectedClientId, organizationId: orgId },
      select: { id: true, name: true, phone: true, email: true, status: true, notes: true, lastContactAt: true },
    })
    if (client) {
      const clientOpps = await db.opportunity.findMany({
        where: { organizationId: orgId, clientId: client.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, amount: true, status: true },
      })
      selected = `\nCLIENTE SELECCIONADO (contexto activo del chat):\n${JSON.stringify({ ...client, opportunities: clientOpps })}`
    }
  }

  return `CONTEXTO DEL NEGOCIO:
${nichoCtx}
ETAPAS DEL PIPELINE: ${JSON.stringify(stages)}
CLIENTES RECIENTES: ${JSON.stringify(recentClients)}
OPORTUNIDADES ABIERTAS: ${JSON.stringify(openOpps)}
MEMORIAS DEL AGENTE: ${JSON.stringify(memories.map((m) => m.content))}${selected}${knowledgeCtx}`
}

const SYSTEM_PROMPT = `Eres el AGENTE COMERCIAL de CRM ALBRA: "Inteligencia Comercial que Trabaja por Ti".
Trabajas dentro de un CRM multi-tenant y puedes ejecutar acciones reales sobre los datos del negocio.

REGLAS DE RESPUESTA (obligatorio): responde SIEMPRE con un único objeto JSON válido, sin texto fuera del JSON:
- Para responder al usuario: {"reply": "<respuesta en español, cordial y concisa>"}
- Para ejecutar una acción: {"action": "<nombre>", "params": { ... }}

ACCIONES DISPONIBLES:
- create_client { name, phone?, email? } — registra un cliente nuevo (prospect)
- create_opportunity { clientId, title, amount? } — crea oportunidad en la primera etapa
- schedule_reservation { clientId, title, startsAt } — agenda una cita (startsAt en ISO 8601)
- add_note { clientId, content } — agrega una nota al timeline del cliente
- quote_summary { clientId } — resume las cotizaciones del cliente
- list_recent_clients {} — lista los últimos 10 clientes con sus ids

POLÍTICA:
- Si el usuario pide crear/agendar/registrar algo, usa la acción correspondiente en lugar de decir que no puedes.
- Si faltan datos obligatorios (ej. nombre para crear cliente), pregunta primero en un {"reply"}.
- Los ids de cliente aparecen en el CONTEXTO; úsalos tal cual.
- Nunca inventes datos del contexto. Sé breve y orientado a resultados.`

// ---------- Handler ----------

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { message?: string; clientId?: string; source?: string }
    requireFields(body as unknown as Record<string, unknown>, ['message'])
    const message = String(body.message).slice(0, 4000)
    const selectedClientId = body.clientId || undefined

    // Auth: JWT normal (usuario en la app) O secreto interno compartido con el
    // daemon de WhatsApp (canal sin sesión de navegador).
    // SEGURIDAD (auditoría Antigravity, crítico #2): sin fallback hardcodeado — si
    // INTERNAL_API_SECRET no está en .env, el canal interno queda deshabilitado.
    // SEGURIDAD (crítico #1): el orgId SIEMPRE se resuelve desde el clientId que
    // envía el daemon; se eliminó el fallback a la primera organización.
    const internalSecret = process.env.INTERNAL_API_SECRET
    const providedSecret = req.headers.get('x-internal-secret') || ''
    let auth: { orgId: string; userId: string | null }
    if (internalSecret && providedSecret && providedSecret === internalSecret) {
      if (!selectedClientId) {
        return json({ error: 'clientId requerido para el canal interno (aislamiento multi-tenant)' }, { status: 400 })
      }
      const client = await db.client.findUnique({ where: { id: selectedClientId }, select: { organizationId: true } })
      if (!client?.organizationId) return json({ error: 'Cliente no encontrado' }, { status: 404 })
      auth = { orgId: client.organizationId, userId: null }
    } else {
      auth = requireAuth(req)
    }

    // Verificar cliente seleccionado pertenece a la org
    if (selectedClientId) {
      const client = await db.client.findFirst({ where: { id: selectedClientId, organizationId: auth.orgId }, select: { id: true } })
      if (!client) return json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    const orgContext = await buildOrgContext(auth.orgId, selectedClientId)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${orgContext}` },
      { role: 'user', content: message },
    ]

    const executedActions: AgentAction[] = []
    let reply = ''
    let lastActionError = ''

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const raw = await llmChat(auth.orgId, messages, { jsonMode: true, temperature: 0.4 })
      const decision = extractJson<AgentDecision>(raw)

      if (decision && typeof decision.action === 'string' && decision.action) {
        const params = (decision.params && typeof decision.params === 'object' ? decision.params : {}) as Record<string, unknown>
        const result = await executeAgentAction(auth.orgId, auth.userId, decision.action, params)
        if (result.ok) executedActions.push({ type: decision.action, summary: result.summary })
        else lastActionError = result.summary
        messages.push({ role: 'assistant', content: JSON.stringify({ action: decision.action, params }) })
        messages.push({
          role: 'user',
          content: `RESULTADO_HERRAMIENTA (${decision.action}): ${JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data ?? null })}\nContinúa: si necesitas otra acción responde {"action":...}; si ya puedes responderle al usuario responde {"reply":"..."}.`,
        })
        continue
      }

      if (decision && typeof decision.reply === 'string' && decision.reply.trim()) {
        reply = decision.reply.trim()
        break
      }

      // El LLM respondió texto plano (no JSON): úsalo como respuesta final
      if (raw && raw.trim()) {
        reply = raw.replace(/```json|```/g, '').trim()
        break
      }
    }

    // Si agotó iteraciones ejecutando acciones sin redactar respuesta, cierra con resumen
    if (!reply) {
      const finalRaw = await llmChat(
        auth.orgId,
        [
          ...messages,
          {
            role: 'user',
            content: 'Ya ejecutaste las acciones. Redacta ahora la respuesta final para el usuario con {"reply":"..."} en español.',
          },
        ],
        { jsonMode: true, temperature: 0.4 }
      ).catch(() => '')
      const finalDecision = extractJson<AgentDecision>(finalRaw || '')
      reply =
        (finalDecision?.reply && String(finalDecision.reply).trim()) ||
        (executedActions.length
          ? `Listo: ${executedActions.map((a) => a.summary).join('. ')}.`
          : lastActionError || 'No pude procesar la solicitud en este momento. Intenta de nuevo.')
    }

    // Timeline de la conversación (source=agent)
    await recordTimelineEvent({
      orgId: auth.orgId,
      clientId: selectedClientId || null,
      type: 'system',
      title: 'Conversación con el agente IA',
      description: message.slice(0, 300),
      metadata: {
        reply: reply.slice(0, 1000),
        actions: executedActions,
        userId: auth.userId,
      },
      source: 'agent',
      userId: auth.userId,
    })

    return json({ content: reply, reply, actions: executedActions })
  })
}
