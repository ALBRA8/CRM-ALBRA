import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'
import { normalizeTrigger, toJsonString, normalizeActions, intervalMinutesFrom, serializeAutomation } from '@/lib/automations'

/**
 * GET  /api/automations — lista (shape del frontend: { automations })
 * POST /api/automations — crea. Acepta triggers del workflow-engine
 *   (manual | client_created | opportunity_stage_changed | message_received |
 *    reservation_created | quote_status_changed | schedule) y alias del UI
 *   (days_inactive | before_appointment | after_service → schedule, stage_change → opportunity_stage_changed).
 */

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const automations = await db.automation.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: 'desc' },
    })

    // Última ejecución por automatización (estado por paso para debugging)
    const lastRuns = await db.automationRun.findMany({
      where: { automationId: { in: automations.map((a) => a.id) } },
      orderBy: { startedAt: 'desc' },
      take: automations.length * 3,
    })
    const lastRunByAutomation = new Map<string, (typeof lastRuns)[number]>()
    for (const r of lastRuns) {
      if (!lastRunByAutomation.has(r.automationId)) lastRunByAutomation.set(r.automationId, r)
    }

    return json({
      automations: automations.map((a) =>
        serializeAutomation(a, lastRunByAutomation.get(a.id) ?? null)
      ),
    })
  })
}

interface AutomationBody {
  name?: string
  type?: string
  category?: string
  description?: string | null
  trigger?: string
  triggerType?: string
  triggerConfig?: unknown
  conditions?: unknown
  actions?: unknown
  message?: string | null
  isActive?: boolean
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as AutomationBody
    requireFields(body as unknown as Record<string, unknown>, ['name'])

    const trigger = normalizeTrigger(body.trigger ?? body.triggerType)
    if (!trigger) {
      return json(
        { error: `trigger inválido. Válidos: ${[...['manual', 'client_created', 'opportunity_stage_changed', 'message_received', 'reservation_created', 'quote_status_changed', 'schedule'], 'days_inactive', 'before_appointment', 'after_service', 'stage_change'].join(', ')}` },
        { status: 400 }
      )
    }

    // triggerConfig: conserva message + intervalMinutes para schedules
    let triggerConfigObj: Record<string, unknown> = {}
    if (body.triggerConfig !== undefined && body.triggerConfig !== null) {
      try {
        const parsed = typeof body.triggerConfig === 'string' ? JSON.parse(body.triggerConfig) : body.triggerConfig
        if (parsed && typeof parsed === 'object') triggerConfigObj = { ...(parsed as Record<string, unknown>) }
      } catch {
        return json({ error: 'triggerConfig debe ser JSON válido' }, { status: 400 })
      }
    }
    if (body.message) triggerConfigObj.message = String(body.message).slice(0, 2000)

    const isActive = body.isActive !== false
    if (trigger === 'schedule' && isActive) {
      triggerConfigObj.intervalMinutes = intervalMinutesFrom(triggerConfigObj)
    }

    const actionsJson = normalizeActions(body.actions, body.message)
    if (body.actions && !actionsJson) {
      return json({ error: 'actions debe ser JSON válido (objeto o array de { type, config })' }, { status: 400 })
    }

    const automation = await db.automation.create({
      data: {
        organizationId: auth.orgId,
        name: String(body.name).slice(0, 160),
        description: body.description ? String(body.description).slice(0, 500) : null,
        category: String(body.type || body.category || 'custom').slice(0, 60),
        triggerType: trigger,
        triggerConfig: Object.keys(triggerConfigObj).length ? JSON.stringify(triggerConfigObj) : null,
        conditions: toJsonString(body.conditions, null),
        actions: actionsJson,
        isActive,
        createdById: auth.userId,
        // Los schedules activos quedan listos para el scheduler
        ...(trigger === 'schedule' && isActive ? { nextRunAt: new Date() } : {}),
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'automation',
      entityId: automation.id,
      details: { name: automation.name, triggerType: trigger },
    })

    return json({ automation: serializeAutomation(automation) }, { status: 201 })
  })
}
