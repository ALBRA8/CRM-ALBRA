import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { enqueueWorkflowOutboundMessage } from './workflow-outbox'

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
 *  - wait: pausa durable el run N días/horas/minutos y lo reanuda después
 *    (patrón DELAY de Twenty: status='waiting' + resumeAt + barrido del scheduler)
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
  /** Limita la ejecución a una automatización concreta (scheduler). */
  automationId?: string
  /** Run de schedule creado en la misma transacción que el claim. */
  existingRunId?: string
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

/** Estado de ejecución por acción (estilo Twenty: stepInfos/stepLogs). */
export interface StepState {
  type: string
  status: 'success' | 'queued' | 'failed' | 'skipped' | 'waiting'
  error?: string
  ms?: number
}

/** Milisegundos de una acción wait (config: days | hours | minutes). */
export function waitDurationMs(config: Record<string, unknown> | undefined): number {
  const c = config || {}
  const days = Number(c.days) || 0
  const hours = Number(c.hours) || 0
  const minutes = Number(c.minutes) || 0
  const total = days * 86_400_000 + hours * 3_600_000 + minutes * 60_000
  return total > 0 ? total : 86_400_000 // default: 1 día
}

export function describeWait(config: Record<string, unknown> | undefined): string {
  const c = config || {}
  const parts: string[] = []
  const days = Number(c.days) || 0
  const hours = Number(c.hours) || 0
  const minutes = Number(c.minutes) || 0
  if (days) parts.push(`${days} ${days === 1 ? 'día' : 'días'}`)
  if (hours) parts.push(`${hours} h`)
  if (minutes) parts.push(`${minutes} min`)
  return parts.length > 0 ? parts.join(' ') : '1 día'
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

/**
 * Enriquece el payload del evento con datos frescos del cliente
 * (clientName, name, phone, email) para que las acciones de mensaje puedan
 * usar {{clientName}} y enviar al teléfono correcto (p. ej. secuencias
 * post-venta disparadas por opportunity_stage_changed).
 */
async function buildActionContext(orgId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const safePayload = { ...payload }
  const clientId = payload.clientId as string | undefined
  if (!clientId) {
    // No permitir que un payload de evento arbitrario inyecte destinatarios
    // de canales. Solo un cliente resuelto dentro del tenant puede aportar
    // teléfono/email para acciones externas.
    delete safePayload.phone
    delete safePayload.email
    delete safePayload.clientName
    return safePayload
  }
  try {
    // Nunca enriquecer un workflow con datos de un cliente de otro tenant,
    // incluso si un trigger interno recibe un clientId ajeno o manipulado.
    const client = await db.client.findFirst({
      where: { id: clientId, organizationId: orgId },
      select: { name: true, phone: true, email: true },
    })
    if (!client) {
      // El ID foráneo tampoco debe llegar a acciones que creen timeline,
      // oportunidades o notificaciones dentro de la organización actual.
      delete safePayload.clientId
      delete safePayload.clientName
      delete safePayload.name
      delete safePayload.phone
      delete safePayload.email
      return safePayload
    }
    return { ...safePayload, clientName: client.name, name: client.name, phone: client.phone, email: client.email }
  } catch {
    // Ante fallo de lectura, fallar cerrado respecto al vínculo con el cliente.
    delete safePayload.clientId
    delete safePayload.clientName
    delete safePayload.name
    delete safePayload.phone
    delete safePayload.email
    return safePayload
  }
}

async function recordWorkflowOutboundPending(
  execution: { runId: string; orgId: string; leaseToken: string; fencingVersion: number },
  channel: string,
  ctx: Record<string, unknown>,
  rendered: string,
  error: string,
) {
  await withWorkflowLeaseMutation(execution, async (tx) => {
    await tx.notification.create({
      data: {
        organizationId: execution.orgId,
        type: 'automation',
        title: `Mensaje ${channel} PENDIENTE (destinatario no disponible)`,
        body: 'No se pudo encolar el mensaje porque falta un destinatario válido.',
        data: JSON.stringify({ channel, clientId: ctx.clientId ?? null, phone: ctx.phone ?? null, email: ctx.email ?? null, sent: false, queued: false, error }),
      },
    })
    await tx.timelineEvent.create({ data: {
      organizationId: execution.orgId,
      clientId: (ctx.clientId as string) || null,
      type: channel,
      title: `Mensaje ${channel} (automatización) — pendiente: destinatario no disponible`,
      description: 'No se pudo encolar: destinatario no disponible.',
      source: 'automation',
    } })
  })
}

async function executeAction(orgId: string, action: WorkflowAction, ctx: Record<string, unknown>, execution: { automationId: string; runId: string; stepIndex: number; orgId: string; leaseToken: string; fencingVersion: number }): Promise<Record<string, unknown>> {
  const config = action.config || {}
  switch (action.type) {
    case 'create_task_like_notification': {
      await withWorkflowLeaseMutation(execution, (tx) => tx.notification.create({
        data: {
          organizationId: orgId,
          userId: null,
          type: 'automation',
          title: String(config.title || 'Nueva tarea de seguimiento'),
          body: renderTemplate(String(config.body || ''), ctx),
          data: JSON.stringify({ clientId: ctx.clientId ?? null, source: 'automation' }),
        },
      }))
      return { notification: true }
    }
    case 'notify_admin': {
      await withWorkflowLeaseMutation(execution, (tx) => tx.notification.create({
        data: {
          organizationId: orgId,
          type: 'automation',
          title: String(config.title || 'Aviso de automatización'),
          body: renderTemplate(String(config.body || ''), ctx),
        },
      }))
      return { notified: true }
    }
    case 'send_whatsapp':
    case 'send_telegram':
    case 'send_email': {
      const channel = action.type === 'send_whatsapp' ? 'whatsapp' : action.type === 'send_telegram' ? 'telegram' : 'email'
      const templateId = config.templateId as string | undefined
      let body = String(config.body || config.text || '')
      if (templateId) {
        const tpl = await db.template.findFirst({ where: { id: templateId, organizationId: orgId } })
        if (tpl) body = tpl.body
      }
      const rendered = renderTemplate(body, ctx)
      let payload: { to: string; text: string } | { chatId: string | number; text: string } | { to: string; subject: string; html: string; text: string }
      if (channel === 'whatsapp') {
        const to = typeof ctx.phone === 'string' ? ctx.phone.trim() : ''
        if (!to) { await recordWorkflowOutboundPending(execution, channel, ctx, rendered, 'WORKFLOW_RECIPIENT_NOT_AVAILABLE'); return { queued: false, pending: true, channel, error: 'WORKFLOW_RECIPIENT_NOT_AVAILABLE' } }
        payload = { to, text: rendered.slice(0, 4096) }
      } else if (channel === 'telegram') {
        const chatId = config.chatId
        if ((typeof chatId !== 'string' && typeof chatId !== 'number') || !String(chatId).trim()) {
          await recordWorkflowOutboundPending(execution, channel, ctx, rendered, 'WORKFLOW_RECIPIENT_NOT_AVAILABLE')
          return { queued: false, pending: true, channel, error: 'WORKFLOW_RECIPIENT_NOT_AVAILABLE' }
        }
        payload = { chatId, text: rendered.slice(0, 4096) }
      } else {
        const to = typeof ctx.email === 'string' ? ctx.email.trim() : ''
        if (!to) { await recordWorkflowOutboundPending(execution, channel, ctx, rendered, 'WORKFLOW_RECIPIENT_NOT_AVAILABLE'); return { queued: false, pending: true, channel, error: 'WORKFLOW_RECIPIENT_NOT_AVAILABLE' } }
        const subject = renderTemplate(String(config.subject || 'Seguimiento'), ctx).replace(/[\r\n]/g, ' ').slice(0, 200)
        payload = {
          to,
          subject,
          html: '<div>' + escapeWorkflowEmailHtml(rendered).replace(/\n/g, '<br/>') + '</div>',
          text: rendered.slice(0, 50000),
        }
      }

      const intent = await enqueueWorkflowOutboundMessage({
        organizationId: orgId,
        automationId: execution.automationId,
        automationRunId: execution.runId,
        stepIndex: execution.stepIndex,
        channel,
        payload,
        lease: { runId: execution.runId, orgId: execution.orgId, leaseToken: execution.leaseToken, fencingVersion: execution.fencingVersion },
      })
      await withWorkflowLeaseMutation(execution, async (tx) => {
        await tx.notification.create({
          data: {
            organizationId: orgId,
            type: 'automation',
            title: `Mensaje ${channel} en cola durable`,
            body: 'Intención persistida en outbox para despacho.',
            data: JSON.stringify({ channel, outboundId: intent.id, status: intent.status, clientId: ctx.clientId ?? null }),
          },
        })
        await tx.timelineEvent.create({ data: {
          organizationId: orgId,
          clientId: (ctx.clientId as string) || null,
          type: channel,
          title: `Mensaje ${channel} (automatización) — en cola`,
          description: 'Intención ' + intent.id + ' persistida en outbox.',
          source: 'automation',
        } })
      })
      return { queued: true, pending: true, channel, outboundId: intent.id, status: intent.status }
    }
    case 'create_opportunity': {
      const requestedStageId = config.stageId as string | undefined
      const [requestedStage, firstStage] = await Promise.all([
        requestedStageId
          ? db.pipelineStage.findFirst({ where: { id: requestedStageId, organizationId: orgId }, select: { id: true } })
          : Promise.resolve(null),
        db.pipelineStage.findFirst({ where: { organizationId: orgId }, orderBy: { order: 'asc' }, select: { id: true } }),
      ])
      const opp = await withWorkflowLeaseMutation(execution, (tx) => tx.opportunity.create({
        data: {
          organizationId: orgId,
          title: renderTemplate(String(config.title || 'Nueva oportunidad'), ctx),
          clientId: (ctx.clientId as string) || null,
          stageId: requestedStage?.id || firstStage?.id || null,
          amount: Number(config.amount || 0),
          source: 'automation',
        },
      }))
      return { opportunityId: opp.id }
    }
    case 'update_client_status': {
      const clientId = ctx.clientId as string | undefined
      if (clientId) {
        await withWorkflowLeaseMutation(execution, (tx) => tx.client.updateMany({ where: { id: clientId, organizationId: orgId }, data: { status: String(config.status || 'active') } }))
        return { updated: clientId }
      }
      return { skipped: 'sin clientId' }
    }
    case 'move_opportunity_stage': {
      const opportunityId = (ctx.opportunityId as string) || (config.opportunityId as string)
      const stageId = config.stageId as string
      if (opportunityId && stageId) {
        const [validOpportunity, validStage] = await Promise.all([
          db.opportunity.findFirst({ where: { id: opportunityId, organizationId: orgId }, select: { id: true } }),
          db.pipelineStage.findFirst({ where: { id: stageId, organizationId: orgId }, select: { id: true } }),
        ])
        if (!validOpportunity) return { skipped: 'oportunidad no pertenece a la organización' }
        if (!validStage) return { skipped: 'etapa no pertenece a la organización' }
        await withWorkflowLeaseMutation(execution, async (tx) => {
          await tx.opportunity.updateMany({ where: { id: validOpportunity.id, organizationId: orgId }, data: { stageId: validStage.id } })
          await tx.timelineEvent.create({ data: {
            organizationId: orgId,
            opportunityId,
            clientId: (ctx.clientId as string) || null,
            type: 'stage_change',
            title: 'Etapa actualizada por automatización',
            source: 'automation',
          } })
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
      await withWorkflowLeaseMutation(execution, (tx) => tx.notification.create({
        data: {
          organizationId: orgId,
          type: 'agent',
          title: 'Seguimiento IA listo para revisión',
          body: text.slice(0, 500),
          data: JSON.stringify({ clientId: ctx.clientId ?? null }),
        },
      }))
      return { drafted: true, text: text.slice(0, 200) }
    }
    default:
      return { skipped: `acción desconocida: ${action.type}` }
  }
}

/** Escapa contenido plano antes de insertarlo en el HTML de correo. */
export function escapeWorkflowEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function renderTemplate(body: string, ctx: Record<string, unknown>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = ctx[key]
    if (v === undefined || v === null) return `{{${key}}}`
    if (v instanceof Date) return v.toLocaleDateString('es-CO')
    return String(v)
  })
}

// All first-party database side effects must be fenced in the same transaction
// as their write. A preflight lease check alone leaves a race with lease reclaim.
async function withWorkflowLeaseMutation<T>(
  execution: { runId: string; orgId: string; leaseToken: string; fencingVersion: number },
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const now = new Date()
    const owner = await tx.automationRun.updateMany({
      where: {
        id: execution.runId,
        organizationId: execution.orgId,
        status: 'processing',
        leaseToken: execution.leaseToken,
        fencingVersion: execution.fencingVersion,
        leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt: new Date(now.getTime() + WORKFLOW_LEASE_MS) },
    })
    if (owner.count !== 1) throw new Error('WORKFLOW_LEASE_LOST: side effect rejected by fencing')
    return mutate(tx)
  })
}

// ---------- Lease distribuido del workflow ----------
// El token identifica al propietario y fencingVersion es la generación monotónica.
// Cada checkpoint renueva el lease mediante compare-and-swap en la base de datos.
const WORKFLOW_LEASE_MS = 30 * 60_000

async function claimWorkflowRun(runId: string, orgId: string) {
  const now = new Date()
  const token = randomUUID()
  const claimed = await db.automationRun.updateMany({
    where: { id: runId, organizationId: orgId, status: 'running',
      OR: [{ leaseToken: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
    data: { status: 'processing', leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + WORKFLOW_LEASE_MS), fencingVersion: { increment: 1 } },
  })
  if (claimed.count !== 1) return null
  const run = await db.automationRun.findFirst({ where: { id: runId, organizationId: orgId, leaseToken: token } })
  return run ? { leaseToken: token, fencingVersion: run.fencingVersion } : null
}

async function assertWorkflowLease(runId: string, orgId: string, leaseToken: string, fencingVersion: number) {
  const now = new Date()
  const renewed = await db.automationRun.updateMany({
    where: { id: runId, organizationId: orgId, status: 'processing', leaseToken, fencingVersion, leaseExpiresAt: { gt: now } },
    data: { leaseExpiresAt: new Date(now.getTime() + WORKFLOW_LEASE_MS) },
  })
  if (renewed.count !== 1) throw new Error('WORKFLOW_LEASE_LOST: el worker perdió el lease; se detiene la ejecución')
}

async function updateRunWithLease(runId: string, orgId: string, leaseToken: string, fencingVersion: number, data: Record<string, unknown>) {
  const now = new Date()
  const updated = await db.automationRun.updateMany({
    where: { id: runId, organizationId: orgId, status: 'processing', leaseToken, fencingVersion, leaseExpiresAt: { gt: now } },
    data: data as never,
  })
  if (updated.count !== 1) throw new Error('WORKFLOW_LEASE_LOST: escritura rechazada por fencing')
}

async function createStepWithLease(runId: string, orgId: string, leaseToken: string, fencingVersion: number, stepIndex: number, actionType: string) {
  return db.$transaction(async (tx) => {
    const now = new Date()
    const owner = await tx.automationRun.updateMany({
      where: { id: runId, organizationId: orgId, status: 'processing', leaseToken, fencingVersion, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + WORKFLOW_LEASE_MS) },
    })
    if (owner.count !== 1) throw new Error('WORKFLOW_LEASE_LOST: claim de paso rechazado')
    return tx.workflowStepExecution.create({
      data: { automationRunId: runId, stepIndex, actionType, status: 'started' },
    })
  })
}

async function updateStepWithLease(
  runId: string, orgId: string, leaseToken: string, fencingVersion: number,
  stepId: string, data: { status: string; output?: string; error?: string; finishedAt: Date },
) {
  return db.$transaction(async (tx) => {
    const now = new Date()
    const owner = await tx.automationRun.updateMany({
      where: { id: runId, organizationId: orgId, status: 'processing', leaseToken, fencingVersion, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + WORKFLOW_LEASE_MS) },
    })
    if (owner.count !== 1) throw new Error('WORKFLOW_LEASE_LOST: escritura de paso rechazada')
    const step = await tx.workflowStepExecution.updateMany({ where: { id: stepId, automationRunId: runId }, data })
    if (step.count !== 1) throw new Error('WORKFLOW_STEP_WRITE_REJECTED: paso inexistente o ya no pertenece al run')
    return step
  })
}

// ---------- Orquestador principal ----------

/**
 * Ejecuta las acciones desde startIndex, acumulando stepStates y outputs.
 * Si encuentra una acción 'wait', PAUSA: devuelve done=false con el tiempo de
 * espera y el índice de la siguiente acción (el run queda 'waiting' en BD,
 * igual que el step DELAY de Twenty termina el batch y lo reanuda un job).
 */
async function runActionSteps(
  orgId: string,
  actions: WorkflowAction[],
  ctx: Record<string, unknown>,
  startIndex: number,
  prevStates: StepState[],
  prevOutputs: Record<string, unknown>[],
  execution: { automationId: string; runId: string; orgId: string; leaseToken: string; fencingVersion: number }
): Promise<
  | { done: true; stepStates: StepState[]; outputs: Record<string, unknown>[] }
  | { done: false; stepStates: StepState[]; outputs: Record<string, unknown>[]; waitMs: number; nextStep: number }
> {
  const stepStates: StepState[] = [...prevStates]
  const outputs: Record<string, unknown>[] = [...prevOutputs]

  for (let i = startIndex; i < actions.length; i++) {
    const action = actions[i]
    const t0 = Date.now()

    if (action.type === 'wait') {
      stepStates[i] = { type: action.type, status: 'waiting' }
      return { done: false, stepStates, outputs, waitMs: waitDurationMs(action.config), nextStep: i + 1 }
    }

    // WRITE-AHEAD y ownership se confirman en la misma transacción.
    let stepRecord
    try {
      stepRecord = await createStepWithLease(execution.runId, execution.orgId, execution.leaseToken, execution.fencingVersion, i, action.type)
    } catch (claimError) {
      await assertWorkflowLease(execution.runId, execution.orgId, execution.leaseToken, execution.fencingVersion)
      const existing = await db.workflowStepExecution.findUnique({
        where: { automationRunId_stepIndex: { automationRunId: execution.runId, stepIndex: i } },
      })
      if (existing?.status === 'succeeded') {
        const saved = safeParse<Record<string, unknown>>(existing.output) || {}
        outputs.push(saved)
        stepStates[i] = { type: action.type, status: saved.pending === true ? (saved.queued === true ? 'queued' : 'skipped') : 'success' }
        continue
      }
      const message = existing?.status === 'started' || existing?.status === 'unknown'
        ? 'WORKFLOW_STEP_OUTCOME_UNKNOWN: paso previamente iniciado; no se reejecuta'
        : (claimError instanceof Error ? claimError.message : String(claimError))
      const blocked = new Error(message) as Error & { stepStates?: StepState[] }
      stepStates[i] = { type: action.type, status: 'failed', error: message.slice(0, 300) }
      blocked.stepStates = stepStates
      throw blocked
    }

    try {
      const out = await executeAction(orgId, action, ctx, { automationId: execution.automationId, runId: execution.runId, stepIndex: i, orgId: execution.orgId, leaseToken: execution.leaseToken, fencingVersion: execution.fencingVersion })
      await updateStepWithLease(execution.runId, execution.orgId, execution.leaseToken, execution.fencingVersion,
        stepRecord.id, { status: 'succeeded', output: JSON.stringify(out).slice(0, 5000), finishedAt: new Date() })
      outputs.push(out)
      // "queued" confirma persistencia durable de la intención, no entrega al proveedor.
      const stepStatus = out.pending === true
        ? (out.queued === true ? 'queued' : 'skipped')
        : 'success'
      stepStates[i] = { type: action.type, status: stepStatus, ms: Date.now() - t0 }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // No se puede probar si el efecto ocurrió antes del error: dejar unknown.
      await updateStepWithLease(execution.runId, execution.orgId, execution.leaseToken, execution.fencingVersion,
        stepRecord.id, { status: 'unknown', error: message.slice(0, 300), finishedAt: new Date() }).catch(() => undefined)
      stepStates[i] = { type: action.type, status: 'failed', error: message.slice(0, 300), ms: Date.now() - t0 }
      const wrapped = err instanceof Error ? err : new Error(message)
      ;(wrapped as Error & { stepStates?: StepState[] }).stepStates = stepStates
      throw wrapped
    }
  }

  return { done: true, stepStates, outputs }
}

export async function runWorkflowsForTrigger(event: WorkflowTriggerEvent) {
  const automations = await db.automation.findMany({
    where: {
      organizationId: event.orgId,
      isActive: true,
      triggerType: event.type,
      ...(event.automationId ? { id: event.automationId } : {}),
    },
  })
  const results: Array<{ automationId: string; status: string; error?: string }> = []

  for (const automation of automations) {
    // IDEMPOTENCIA (P0): webhooks (Meta/Telegram) pueden re-entregar el mismo
    // evento; un retry de red NUNCA debe disparar el workflow dos veces.
    // Clave = tipo:entidad (id del cliente/mensaje/cotización/scheduledAt) con
    // unique (automationId, idempotencyKey) → dedup PERMANENTE por evento:
    // la misma re-entrega queda 'deduplicated' siempre; un evento distinto
    // (id distinto) ejecuta normal. Los schedules usan scheduledAt en la clave
    // (único por disparo) y el claim atómico de nextRunAt del scheduler.
    const p = (event.payload ?? {}) as Record<string, unknown>
    const entityKey = String(p.id ?? p.messageId ?? p.reservationId ?? p.quoteId ?? p.scheduledAt ?? '')
    const idempotencyKey = entityKey ? `${event.type}:${entityKey}`.slice(0, 180) : null
    let run
    try {
      if (event.existingRunId) {
        run = await db.automationRun.findFirst({
          where: { id: event.existingRunId, organizationId: event.orgId, automationId: automation.id },
        })
        if (!run) throw new Error('El run durable no pertenece a esta automatización/organización')
      } else {
        run = await db.automationRun.create({
          data: {
            organizationId: event.orgId,
            automationId: automation.id,
            input: JSON.stringify(event.payload).slice(0, 5000),
            stepLedgerVersion: 1,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        })
      }
    } catch (err) {
      // P2002: ese MISMO evento ya ejecutó esta automatización → no duplicar
      if ((err as { code?: string }).code === 'P2002') {
        results.push({ automationId: automation.id, status: 'deduplicated' })
        continue
      }
      throw err
    }
    const lease = await claimWorkflowRun(run.id, event.orgId)
    if (!lease) {
      results.push({ automationId: automation.id, status: 'already_claimed' })
      continue
    }
    try {
      const conditions = safeParse<Condition[]>(automation.conditions)
      if (!evaluateConditions(conditions, event.payload)) {
        await updateRunWithLease(run.id, event.orgId, lease.leaseToken, lease.fencingVersion, { status: 'success', output: JSON.stringify({ skipped: 'condiciones no cumplidas' }), finishedAt: new Date(), leaseExpiresAt: new Date() })
        results.push({ automationId: automation.id, status: 'skipped' })
        continue
      }
      const actions = safeParse<WorkflowAction[]>(automation.actions) || []
      const ctx = await buildActionContext(event.orgId, event.payload)
      const res = await runActionSteps(event.orgId, actions, ctx, 0, [], [], { automationId: automation.id, runId: run.id, orgId: event.orgId, ...lease })

      if (!res.done) {
        // PAUSA durable (patrón DELAY de Twenty): el run queda 'waiting' y el
        // scheduler lo reanuda cuando venza resumeAt.
        await updateRunWithLease(run.id, event.orgId, lease.leaseToken, lease.fencingVersion, {
          status: 'waiting', stepStates: JSON.stringify(res.stepStates), currentStep: res.nextStep,
          output: JSON.stringify(res.outputs).slice(0, 5000),
          resumeAt: new Date(Date.now() + res.waitMs), leaseExpiresAt: new Date(),
        })
        results.push({ automationId: automation.id, status: 'waiting' })
        continue
      }

      await updateRunWithLease(run.id, event.orgId, lease.leaseToken, lease.fencingVersion, {
        status: 'success', output: JSON.stringify(res.outputs).slice(0, 5000),
        stepStates: JSON.stringify(res.stepStates), finishedAt: new Date(), leaseExpiresAt: new Date(),
      })
      await db.automation.update({ where: { id: automation.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } })
      results.push({ automationId: automation.id, status: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const partialStates = (err as Error & { stepStates?: StepState[] }).stepStates
      await updateRunWithLease(run.id, event.orgId, lease.leaseToken, lease.fencingVersion, {
        status: 'failed', error: message.slice(0, 1000),
        stepStates: partialStates ? JSON.stringify(partialStates) : undefined,
        finishedAt: new Date(), leaseExpiresAt: new Date(),
      }).catch(() => undefined)
      results.push({ automationId: automation.id, status: 'failed', error: message })
    }
  }
  return results
}

/**
 * Reanuda los runs en espera cuyo resumeAt venció (invocado por el scheduler).
 * Continúa desde currentStep con el payload original guardado en run.input.
 * Devuelve cuántos runs se completaron o re-pausaron.
 * @param scope.orgId Scope de tenant (plan v1.0 P-03): cuando se define,
 *   solo se reanudan runs de esa organización.
 */
export async function resumeWaitingRuns(scope?: { orgId?: string }): Promise<number> {
  const now = new Date()
  const waiting = await db.automationRun.findMany({
    where: {
      status: 'waiting',
      resumeAt: { lte: now },
      ...(scope?.orgId ? { organizationId: scope.orgId } : {}),
    },
    orderBy: { resumeAt: 'asc' },
    take: 25,
  })

  let processed = 0
  for (const run of waiting) {
    // CLAIM atómico: solo una instancia reanuda cada run (concurrentes → count=0)
    const claim = await db.automationRun.updateMany({
      where: { id: run.id, organizationId: run.organizationId, status: 'waiting', resumeAt: { lte: now } },
      data: { status: 'running' },
    })
    if (claim.count === 0) continue
    const lease = await claimWorkflowRun(run.id, run.organizationId)
    if (!lease) continue

    const automation = await db.automation.findFirst({ where: { id: run.automationId, organizationId: run.organizationId } })
    if (!automation || !automation.isActive) {
      await updateRunWithLease(run.id, run.organizationId, lease.leaseToken, lease.fencingVersion, {
        status: 'success', output: JSON.stringify({ skipped: 'automatización inactiva al reanudar' }),
        finishedAt: new Date(), leaseExpiresAt: new Date(),
      })
      processed++
      continue
    }

    const actions = safeParse<WorkflowAction[]>(automation.actions) || []
    const payload = safeParse<Record<string, unknown>>(run.input) || {}
    const prevStates = safeParse<StepState[]>(run.stepStates) || []
    const prevOutputs = safeParse<Record<string, unknown>[]>(run.output) || []

    try {
      const ctx = await buildActionContext(automation.organizationId, payload)
      const res = await runActionSteps(automation.organizationId, actions, ctx, run.currentStep, prevStates, prevOutputs, { automationId: automation.id, runId: run.id, orgId: run.organizationId, ...lease })
      if (!res.done) {
        // Otra espera encadenada: vuelve a pausar (secuencias multi-touch)
        await updateRunWithLease(run.id, run.organizationId, lease.leaseToken, lease.fencingVersion, {
          status: 'waiting', stepStates: JSON.stringify(res.stepStates), currentStep: res.nextStep,
          output: JSON.stringify(res.outputs).slice(0, 5000),
          resumeAt: new Date(Date.now() + res.waitMs), leaseExpiresAt: new Date(),
        })
      } else {
        await updateRunWithLease(run.id, run.organizationId, lease.leaseToken, lease.fencingVersion, {
          status: 'success', output: JSON.stringify(res.outputs).slice(0, 5000),
          stepStates: JSON.stringify(res.stepStates), finishedAt: new Date(), leaseExpiresAt: new Date(),
        })
        await db.automation.update({ where: { id: automation.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } })
      }
      processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const partialStates = (err as Error & { stepStates?: StepState[] }).stepStates
      await updateRunWithLease(run.id, run.organizationId, lease.leaseToken, lease.fencingVersion, {
        status: 'failed', error: message.slice(0, 1000),
        stepStates: partialStates ? JSON.stringify(partialStates) : undefined,
        finishedAt: new Date(), leaseExpiresAt: new Date(),
      }).catch(() => undefined)
      processed++
    }
  }
  return processed
}

function safeParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
