import { db } from './db'
import { recordTimelineEvent } from './timeline'

/**
 * Motor de workflows disparado por eventos (feature #1 del plan aprobado,
 * inspirado en el motor de Workflows de Twenty).
 *
 * Flujo: trigger de negocio -> filtro por condiciones -> ejecución de acciones.
 * A diferencia del modelo anterior (plantillas con run manual), aquí el motor
 * reacciona a eventos del CRM en tiempo real y deja ejecución auditable en
 * AutomationRun.
 *
 * Acciones soportadas:
 *  - create_task_like_notification: notificación interna recordatoria
 *  - send_whatsapp | send_telegram | send_email: mensajería por plantilla
 *  - create_opportunity: oportunidad para el cliente
 *  - update_client_status: cambio de estado del cliente
 *  - move_opportunity_stage: cambio de etapa de oportunidad
 *  - ai_followup: el agente IA redacta y ejecuta el seguimiento
 *  - notify_admin: notificación a admins
 */

export interface WorkflowTriggerEvent {
  orgId: string
  type:
    | 'client_created'
    | 'opportunity_stage_changed'
    | 'message_received'
    | 'reservation_created'
    | 'quote_status_changed'
    | 'schedule'
  payload: Record<string, unknown>
}

export interface Condition {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'exists' | 'not_exists' | 'in'
  value?: string
}

export interface WorkflowAction {
  type: string
  config?: Record<string, unknown>
}

// ---------- Evaluación de condiciones (estilo Twenty: composables) ----------

export function evaluateConditions(conditions: Condition[] | null | undefined, record: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((cond) => {
    const value = record[cond.field]
    switch (cond.operator) {
      case 'equals': return String(value ?? '') === String(cond.value ?? '')
      case 'not_equals': return String(value ?? '') !== String(cond.value ?? '')
      case 'contains': return String(value ?? '').toLowerCase().includes(String(cond.value ?? '').toLowerCase())
      case 'gt': return Number(value) > Number(cond.value)
      case 'lt': return Number(value) < Number(cond.value)
      case 'exists': return value !== undefined && value !== null && value !== ''
      case 'not_exists': return value === undefined || value === null || value === ''
      case 'in': {
        const list = String(cond.value ?? '').split(',').map((s) => s.trim())
        return list.includes(String(value ?? ''))
      }
      default: return true
    }
  })
}

// ---------- Ejecución de acciones ----------

async function executeAction(orgId: string, userId: string | null, action: WorkflowAction, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = action.config || {}
  switch (action.type) {
    case 'create_task_like_notification': {
      await db.notification.create({
        data: {
          organizationId: orgId,
          userId: null,
          type: 'automation',
          title: String(config.title || 'Nueva tarea de seguimiento'),
          body: renderTemplate(String(config.body || ''), ctx),
          data: JSON.stringify({ clientId: ctx.clientId ?? null, source: 'automation' }),
        },
      })
      return { notification: true }
    }
    case 'notify_admin': {
      await db.notification.create({
        data: {
          organizationId: orgId,
          type: 'automation',
          title: String(config.title || 'Aviso de automatización'),
          body: renderTemplate(String(config.body || ''), ctx),
        },
      })
      return { notified: true }
    }
    case 'send_whatsapp':
    case 'send_telegram':
    case 'send_email': {
      const channel = action.type === 'send_whatsapp' ? 'whatsapp' : action.type === 'send_telegram' ? 'telegram' : 'email'
      const templateId = config.templateId as string | undefined
      let body = String(config.body || '')
      if (templateId) {
        const tpl = await db.template.findFirst({ where: { id: templateId, organizationId: orgId } })
        if (tpl) body = tpl.body
      }
      const rendered = renderTemplate(body, ctx)
      // El envío real lo hace el módulo de integraciones; aquí registramos el intento
      // y el evento de timeline; el daemon de WhatsApp/Telegram envía si está activo.
      const { db: database } = await import('./db')
      await database.notification.create({
        data: {
          organizationId: orgId,
          type: 'automation',
          title: `Mensaje ${channel} programado`,
          body: rendered.slice(0, 500),
          data: JSON.stringify({ channel, clientId: ctx.clientId ?? null, phone: ctx.phone ?? null, email: ctx.email ?? null }),
        },
      })
      await recordTimelineEvent({
        orgId,
        clientId: (ctx.clientId as string) || null,
        type: channel,
        title: `Mensaje ${channel} (automatización)`,
        description: rendered.slice(0, 300),
        source: 'automation',
      })
      return { queued: true, channel }
    }
    case 'create_opportunity': {
      const stage = await db.pipelineStage.findFirst({ where: { organizationId: orgId }, orderBy: { order: 'asc' } })
      const opp = await db.opportunity.create({
        data: {
          organizationId: orgId,
          title: renderTemplate(String(config.title || 'Nueva oportunidad'), ctx),
          clientId: (ctx.clientId as string) || null,
          stageId: (config.stageId as string) || stage?.id || null,
          amount: Number(config.amount || 0),
          source: 'automation',
        },
      })
      return { opportunityId: opp.id }
    }
    case 'update_client_status': {
      const clientId = ctx.clientId as string | undefined
      if (clientId) {
        await db.client.updateMany({ where: { id: clientId, organizationId: orgId }, data: { status: String(config.status || 'active') } })
        return { updated: clientId }
      }
      return { skipped: 'sin clientId' }
    }
    case 'move_opportunity_stage': {
      const opportunityId = (ctx.opportunityId as string) || (config.opportunityId as string)
      const stageId = config.stageId as string
      if (opportunityId && stageId) {
        await db.opportunity.updateMany({ where: { id: opportunityId, organizationId: orgId }, data: { stageId } })
        await recordTimelineEvent({
          orgId,
          opportunityId,
          clientId: (ctx.clientId as string) || null,
          type: 'stage_change',
          title: 'Etapa actualizada por automatización',
          source: 'automation',
        })
        return { moved: opportunityId }
      }
      return { skipped: 'faltan ids' }
    }
    case 'ai_followup': {
      // El agente IA redacta el mensaje de seguimiento (acción estrella "trabaja por ti")
      const { llmChat } = await import('./ai')
      const client = ctx.clientName ? String(ctx.clientName) : 'el cliente'
      const instruction = String(config.instruction || 'Redacta un mensaje corto de seguimiento cordial en español.')
      const text = await llmChat(orgId, [
        { role: 'system', content: 'Eres un asistente comercial. Responde SOLO con el mensaje listo para enviar, sin comillas ni prefijos.' },
        { role: 'user', content: `${instruction}\nCliente: ${client}\nContexto: ${JSON.stringify(ctx).slice(0, 500)}` },
      ])
      await db.notification.create({
        data: {
          organizationId: orgId,
          type: 'agent',
          title: 'Seguimiento IA listo para revisión',
          body: text.slice(0, 500),
          data: JSON.stringify({ clientId: ctx.clientId ?? null }),
        },
      })
      return { drafted: true, text: text.slice(0, 200) }
    }
    default:
      return { skipped: `acción desconocida: ${action.type}` }
  }
}

function renderTemplate(body: string, ctx: Record<string, unknown>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = ctx[key]
    if (v === undefined || v === null) return `{{${key}}}`
    if (v instanceof Date) return v.toLocaleDateString('es-CO')
    return String(v)
  })
}

// ---------- Orquestador principal ----------

export async function runWorkflowsForTrigger(event: WorkflowTriggerEvent) {
  const automations = await db.automation.findMany({
    where: { organizationId: event.orgId, isActive: true, triggerType: event.type },
  })
  const results: Array<{ automationId: string; status: string; error?: string }> = []

  for (const automation of automations) {
    const run = await db.automationRun.create({
      data: { organizationId: event.orgId, automationId: automation.id, input: JSON.stringify(event.payload).slice(0, 5000) },
    })
    try {
      const conditions = safeParse<Condition[]>(automation.conditions)
      if (!evaluateConditions(conditions, event.payload)) {
        await db.automationRun.update({ where: { id: run.id }, data: { status: 'success', output: JSON.stringify({ skipped: 'condiciones no cumplidas' }), finishedAt: new Date() } })
        results.push({ automationId: automation.id, status: 'skipped' })
        continue
      }
      const actions = safeParse<WorkflowAction[]>(automation.actions) || []
      const outputs: Record<string, unknown>[] = []
      for (const action of actions) {
        outputs.push(await executeAction(event.orgId, automation.createdById, action, event.payload))
      }
      await db.automationRun.update({ where: { id: run.id }, data: { status: 'success', output: JSON.stringify(outputs).slice(0, 5000), finishedAt: new Date() } })
      await db.automation.update({ where: { id: automation.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } })
      results.push({ automationId: automation.id, status: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db.automationRun.update({ where: { id: run.id }, data: { status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() } })
      results.push({ automationId: automation.id, status: 'failed', error: message })
    }
  }
  return results
}

function safeParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
