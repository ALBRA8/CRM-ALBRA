import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'
import { normalizeVariables } from '@/lib/templates'

/** PUT /api/templates/:id */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.template.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) return json({ error: 'Plantilla no encontrada' }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
    if (typeof body.channel === 'string' && ['whatsapp', 'telegram', 'instagram', 'email', 'sms', 'generic'].includes(body.channel)) {
      data.channel = body.channel
    }
    if (body.subject !== undefined) data.subject = body.subject === null ? null : String(body.subject).slice(0, 200)
    const content = body.content ?? body.body
    if (typeof content === 'string' && content.trim()) data.body = content.trim().slice(0, 5000)
    if (body.variables !== undefined) data.variables = normalizeVariables(body.variables)
    if (typeof body.category === 'string') data.category = body.category.slice(0, 60)
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive

    const updated = await db.template.update({ where: { id }, data })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'template',
      entityId: id,
      details: { fields: Object.keys(data) },
    })
    return json({
      template: {
        ...updated,
        content: updated.body,
      },
    })
  })
}

/** DELETE /api/templates/:id */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.template.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, name: true } })
    if (!existing) return json({ error: 'Plantilla no encontrada' }, { status: 404 })
    await db.template.delete({ where: { id } })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'template',
      entityId: id,
      details: { name: existing.name },
    })
    return json({ success: true })
  })
}
