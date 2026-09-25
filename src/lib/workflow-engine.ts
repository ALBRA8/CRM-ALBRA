import { db } from './db'
import { recordTimelineEvent } from './timeline'
import { decryptSecret } from './crypto'

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
  status: 'success' | 'failed' | 'skipped' | 'waiting'
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
  const clientId = payload.clientId as string | undefined
  if (!clientId) return { ...payload }
  try {
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { name: true, phone: true, email: true },
    })
    if (!client) return { ...payload }
    return { ...payload, clientName: client.name, name: client.name, phone: client.phone, email: client.email }
  } catch {
    return { ...payload }
  }
}

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
      let body = String(config.body || config.text || '')
      if (templateId) {
        const tpl = await db.template.findFirst({ where: { id: templateId, organizationId: orgId } })
        if (tpl) body = tpl.body
      }
      const rendered = renderTemplate(body, ctx)
      // ENVÍO REAL (auditoría Antigravity, importante #3 — antes email/telegram eran
      // stubs que solo creaban una notificación interna):
      //  - whatsapp → daemon Baileys (POST /send con secreto server-to-server)
      //  - email    → SMTP de la organización (mail.ts trySendSmtp)
      //  - telegram → Bot API con el token cifrado de la organización
      // Los fallos quedan registrados como notificación en cola para revisión.
      let sent = false
      let sendError: string | undefined
      if (channel === 'whatsapp' && ctx.phone) {
        try {
          const daemonUrl = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'
          const daemonSecret = process.env.INTERNAL_API_SECRET
          if (!daemonSecret) {
            sendError = 'INTERNAL_API_SECRET no configurado'
          } else {
            const res = await fetch(`${daemonUrl}/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemonSecret}` },
              body: JSON.stringify({ to: ctx.phone, text: rendered }),
              signal: AbortSignal.timeout(8000),
            })
            if (res.ok) {
              sent = true
            } else {
              sendError = `daemon ${res.status}`
            }
          }
        } catch (err) {
          sendError = err instanceof Error ? err.message.slice(0, 120) : 'daemon no disponible'
        }
      } else if (channel === 'email' && ctx.email) {
        try {
          const { getSmtpConfig, trySendSmtp } = await import('./mail')
          const cfg = await getSmtpConfig(orgId)
          if (!cfg) {
            sendError = 'SMTP no configurado (Configuración → Email)'
          } else {
            const subject = String(config.subject || `Mensaje de ${cfg.from}`)
            const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${rendered.replace(/\n/g, '<br>')}</div>`
            const result = await trySendSmtp(cfg, String(ctx.email), subject, html, rendered)
            sent = result.ok
            if (!result.ok) sendError = (result.error || 'fallo SMTP').slice(0, 120)
          }
        } catch (err) {
          sendError = err instanceof Error ? err.message.slice(0, 120) : 'error de email'
        }
      } else if (channel === 'telegram') {
        try {
          const integration = await db.integration.findFirst({
            where: { organizationId: orgId, telegramBotTokenEnc: { not: null } },
            select: { telegramBotTokenEnc: true },
          })
          const token = integration ? decryptSecret(integration.telegramBotTokenEnc) : null
          const chatId = (ctx.telegramChatId || ctx.chatId || ctx.phone) as string | undefined
          if (!token) {
            sendError = 'Telegram no configurado (falta token del bot)'
          } else if (!chatId) {
            sendError = 'falta chatId de Telegram para el destinatario'
          } else {
            const { sendTelegramBotMessage } = await import('./integrations')
            const result = await sendTelegramBotMessage({ token, chatId: String(chatId), text: rendered })
            sent = result.ok
            if (!result.ok) sendError = (result.error || 'fallo Telegram').slice(0, 120)
          }
        } catch (err) {
          sendError = err instanceof Error ? err.message.slice(0, 120) : 'error de telegram'
        }
      }
      // Registro del intento + evento de timeline (auditable). El título deja claro
      // si el mensaje SALIÓ de verdad o quedó pendiente — nada de engaños.
      const { db: database } = await import('./db')
      await database.notification.create({
        data: {
          organizationId: orgId,
          type: 'automation',
          title: `Mensaje ${channel} ${sent ? 'enviado' : 'PENDIENTE de envío (fallo de canal)'}`,
          body: rendered.slice(0, 500),
          data: JSON.stringify({ channel, clientId: ctx.clientId ?? null, phone: ctx.phone ?? null, email: ctx.email ?? null, sent, error: sendError ?? null }),
        },
      })
      await recordTimelineEvent({
        orgId,
        clientId: (ctx.clientId as string) || null,
        type: channel,
        title: `Mensaje ${channel} (automatización)${sent ? '' : ' — no entregado'}`,
        description: rendered.slice(0, 300),
        source: 'automation',
      })
      return { queued: true, channel, sent, error: sendError }
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

/**
 * Ejecuta las acciones desde startIndex, acumulando stepStates y outputs.
 * Si encuentra una acción 'wait', PAUSA: devuelve done=false con el tiempo de
 * espera y el índice de la siguiente acción (el run queda 'waiting' en BD,
 * igual que el step DELAY de Twenty termina el batch y lo reanuda un job).
 */
async function runActionSteps(
  orgId: string,
  userId: string | null,
  actions: WorkflowAction[],
  ctx: Record<string, unknown>,
  startIndex: number,
  prevStates: StepState[],
  prevOutputs: Record<string, unknown>[]
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

    try {
      const out = await executeAction(orgId, userId, action, ctx)
      outputs.push(out)
      stepStates[i] = { type: action.type, status: 'success', ms: Date.now() - t0 }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stepStates[i] = { type: action.type, status: 'failed', error: message.slice(0, 300), ms: Date.now() - t0 }
      // Propaga el error llevando los stepStates parciales para persistirlos
      const wrapped = err instanceof Error ? err : new Error(message)
      ;(wrapped as Error & { stepStates?: StepState[] }).stepStates = stepStates
      throw wrapped
    }
  }

  return { done: true, stepStates, outputs }
}

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
      const ctx = await buildActionContext(event.orgId, event.payload)
      const res = await runActionSteps(event.orgId, automation.createdById, actions, ctx, 0, [], [])

      if (!res.done) {
        // PAUSA durable (patrón DELAY de Twenty): el run queda 'waiting' y el
        // scheduler lo reanuda cuando venza resumeAt.
        await db.automationRun.update({
          where: { id: run.id },
          data: {
            status: 'waiting',
            stepStates: JSON.stringify(res.stepStates),
            currentStep: res.nextStep,
            output: JSON.stringify(res.outputs).slice(0, 5000),
            resumeAt: new Date(Date.now() + res.waitMs),
          },
        })
        results.push({ automationId: automation.id, status: 'waiting' })
        continue
      }

      await db.automationRun.update({
        where: { id: run.id },
        data: {
          status: 'success',
          output: JSON.stringify(res.outputs).slice(0, 5000),
          stepStates: JSON.stringify(res.stepStates),
          finishedAt: new Date(),
        },
      })
      await db.automation.update({ where: { id: automation.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } })
      results.push({ automationId: automation.id, status: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const partialStates = (err as Error & { stepStates?: StepState[] }).stepStates
      await db.automationRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: message.slice(0, 1000),
          stepStates: partialStates ? JSON.stringify(partialStates) : undefined,
          finishedAt: new Date(),
        },
      })
      results.push({ automationId: automation.id, status: 'failed', error: message })
    }
  }
  return results
}

/**
 * Reanuda los runs en espera cuyo resumeAt venció (invocado por el scheduler).
 * Continúa desde currentStep con el payload original guardado en run.input.
 * Devuelve cuántos runs se completaron o re-pausaron.
 */
export async function resumeWaitingRuns(): Promise<number> {
  const now = new Date()
  const waiting = await db.automationRun.findMany({
    where: { status: 'waiting', resumeAt: { lte: now } },
    orderBy: { resumeAt: 'asc' },
    take: 25,
  })

  let processed = 0
  for (const run of waiting) {
    const automation = await db.automation.findUnique({ where: { id: run.automationId } })
    if (!automation || !automation.isActive) {
      await db.automationRun.update({
        where: { id: run.id },
        data: { status: 'success', output: JSON.stringify({ skipped: 'automación inactiva al reanudar' }), finishedAt: new Date() },
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
      const res = await runActionSteps(automation.organizationId, automation.createdById, actions, ctx, run.currentStep, prevStates, prevOutputs)
      if (!res.done) {
        // Otra espera encadenada: vuelve a pausar (secuencias multi-touch)
        await db.automationRun.update({
          where: { id: run.id },
          data: {
            status: 'waiting',
            stepStates: JSON.stringify(res.stepStates),
            currentStep: res.nextStep,
            output: JSON.stringify(res.outputs).slice(0, 5000),
            resumeAt: new Date(Date.now() + res.waitMs),
          },
        })
      } else {
        await db.automationRun.update({
          where: { id: run.id },
          data: {
            status: 'success',
            output: JSON.stringify(res.outputs).slice(0, 5000),
            stepStates: JSON.stringify(res.stepStates),
            finishedAt: new Date(),
          },
        })
        await db.automation.update({ where: { id: automation.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } })
      }
      processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const partialStates = (err as Error & { stepStates?: StepState[] }).stepStates
      await db.automationRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: message.slice(0, 1000),
          stepStates: partialStates ? JSON.stringify(partialStates) : undefined,
          finishedAt: new Date(),
        },
      })
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
