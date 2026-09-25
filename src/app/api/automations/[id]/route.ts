import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'
import { normalizeTrigger, normalizeActions, toJsonString } from '@/lib/automations'

/** PUT /api/automations/:id — actualiza campos del frontend (isActive, name, ...) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.automation.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) return json({ error: 'Automatización no encontrada' }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const data: Record<string, unknown> = {}

    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 160)
    if (typeof body.description === 'string' || body.description === null) data.description = body.description
    if (typeof body.type === 'string' || typeof body.category === 'string') {
      data.category = String(body.type || body.category).slice(0, 60)
    }
    if (typeof body.isActive === 'boolean') {
      data.isActive = body.isActive
      if (body.isActive && existing.triggerType === 'schedule' && !existing.nextRunAt) {
        data.nextRunAt = new Date()
      }
    }

    const trigger = normalizeTrigger(body.trigger ?? body.triggerType)
    if (trigger) data.triggerType = trigger

    if (body.triggerConfig !== undefined) {
      if (body.triggerConfig === null) data.triggerConfig = null
      else if (typeof body.triggerConfig === 'string' || typeof body.triggerConfig === 'object') {
        data.triggerConfig = toJsonString(body.triggerConfig, existing.triggerConfig)
      }
    }
    if (body.message !== undefined) {
      // message vive dentro de triggerConfig.message (round-trip del formulario)
      let cfg: Record<string, unknown> = {}
      try {
        cfg = data.triggerConfig
          ? typeof data.triggerConfig === 'string'
            ? (JSON.parse(data.triggerConfig) as Record<string, unknown>)
            : (data.triggerConfig as Record<string, unknown>)
          : existing.triggerConfig
            ? (JSON.parse(existing.triggerConfig) as Record<string, unknown>)
            : {}
      } catch {
        cfg = {}
      }
      if (body.message) cfg.message = String(body.message).slice(0, 2000)
      else delete cfg.message
      data.triggerConfig = Object.keys(cfg).length ? JSON.stringify(cfg) : null
    }
    if (body.conditions !== undefined) data.conditions = toJsonString(body.conditions, body.conditions === null ? null : existing.conditions)
    if (body.actions !== undefined) {
      const actionsJson = body.actions === null ? null : normalizeActions(body.actions, typeof body.message === 'string' ? body.message : null)
      if (body.actions && !actionsJson) return json({ error: 'actions debe ser JSON válido' }, { status: 400 })
      data.actions = actionsJson
    }

    const updated = await db.automation.update({ where: { id }, data })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'automation',
      entityId: id,
      details: { fields: Object.keys(data) },
    })

    return json({ automation: updated })
  })
}

/** DELETE /api/automations/:id */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.automation.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, name: true } })
    if (!existing) return json({ error: 'Automatización no encontrada' }, { status: 404 })
    await db.automation.delete({ where: { id } })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'automation',
      entityId: id,
      details: { name: existing.name },
    })
    return json({ success: true })
  })
}
