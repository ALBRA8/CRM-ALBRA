import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, requireFields, str, numOrNull, bool, qparam } from '../_lib/shared'

/** GET /api/services — catálogo de servicios/productos de la organización. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const services = await db.service.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return json({ services })
  })
}

/** POST /api/services — { name, description?, category?, price?, duration?, unit?, isActive? } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['name'])

    const created = await db.service.create({
      data: {
        organizationId: auth.orgId,
        name: str(body.name) as string,
        description: str(body.description),
        category: str(body.category),
        price: numOrNull(body.price) ?? 0,
        duration: numOrNull(body.duration),
        unit: str(body.unit) ?? 'unidad',
        isActive: 'isActive' in body ? bool(body.isActive, true) : true,
      },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'service',
      entityId: created.id,
      details: { name: created.name, price: created.price },
    })
    return json({ service: created }, { status: 201 })
  })
}

/** PUT /api/services — { id, ...campos } (según lib/api.ts el id va en el body). */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    const id = str(body.id)
    if (!id) throw new HttpError(400, 'Falta el id del servicio')

    const existing = await db.service.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) throw new HttpError(404, 'Servicio no encontrado')

    const data: Record<string, unknown> = {}
    if ('name' in body) data.name = str(body.name) ?? existing.name
    if ('description' in body) data.description = str(body.description)
    if ('category' in body) data.category = str(body.category)
    if ('price' in body) data.price = numOrNull(body.price) ?? existing.price
    if ('duration' in body) data.duration = numOrNull(body.duration)
    if ('unit' in body) data.unit = str(body.unit) ?? existing.unit
    if ('isActive' in body) data.isActive = bool(body.isActive, existing.isActive)

    const updated = await db.service.update({ where: { id }, data })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'service',
      entityId: id,
      details: { name: updated.name, fields: Object.keys(body).slice(0, 10) },
    })
    return json({ service: updated })
  })
}

/** DELETE /api/services?id=... */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const id = qparam(req, 'id')
    if (!id) throw new HttpError(400, 'Falta el parámetro id')

    const existing = await db.service.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, name: true } })
    if (!existing) throw new HttpError(404, 'Servicio no encontrado')

    await db.service.delete({ where: { id } })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'service',
      entityId: id,
      details: { name: existing.name },
    })
    return json({ success: true })
  })
}
