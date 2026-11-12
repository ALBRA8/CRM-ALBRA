import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str, dateOrNull } from '../../_lib/shared'
import { loadClientAttrs, saveClientAttrs, serializeClient } from '../../_lib/clients'

async function getClientOr404(orgId: string, id: string) {
  const client = await db.client.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { opportunities: true, reservations: true } } },
  })
  if (!client) throw new HttpError(404, 'Cliente no encontrado')
  return client
}

/** GET /api/clients/:id — detalle del cliente con atributos extendidos. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await params
    const client = await getClientOr404(auth.orgId, id)
    const attrsMap = await loadClientAttrs(auth.orgId, [client.id])
    return json({ client: serializeClient(client, attrsMap.get(client.id)) })
  })
}

/** PUT /api/clients/:id — actualización parcial (inline edit del detalle). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await params
    await getClientOr404(auth.orgId, id)
    const body = await readBody(req)

    const data: Record<string, unknown> = {}
    if ('name' in body) data.name = str(body.name)
    if ('email' in body) data.email = str(body.email)
    if ('phone' in body) data.phone = str(body.phone)
    if ('address' in body) data.address = str(body.address)
    if ('notes' in body) data.notes = str(body.notes)
    if ('source' in body) data.source = str(body.source) ?? 'manual'
    if ('status' in body) data.status = str(body.status) ?? 'prospect'
    if ('lastContactAt' in body) data.lastContactAt = dateOrNull(body.lastContactAt)
    if ('assignedToId' in body) {
      // (segunda reparación §2.B) El responsable debe pertenecer a la organización
      const assigneeId = str(body.assignedToId)
      if (assigneeId) {
        const assignee = await db.user.findFirst({ where: { id: assigneeId, organizationId: auth.orgId }, select: { id: true } })
        if (!assignee) throw new HttpError(400, 'El responsable no pertenece a tu organización')
      }
      data.assignedToId = assigneeId
    }
    if ('identifier' in body || 'cedula' in body) data.cedula = str(body.identifier) ?? str(body.cedula)

    const updated = await db.client.update({
      where: { id },
      data,
      include: { _count: { select: { opportunities: true, reservations: true } } },
    })
    await saveClientAttrs(auth.orgId, id, body)
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'client',
      entityId: id,
      details: { name: updated.name, fields: Object.keys(body).slice(0, 10) },
    })

    const attrs = await loadClientAttrs(auth.orgId, [id])
    return json({ client: serializeClient(updated, attrs.get(id)) })
  })
}

/** DELETE /api/clients/:id — elimina el cliente y sus datos en cascada. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await params
    const client = await getClientOr404(auth.orgId, id)

    // (A2-22, auditoría 2026-11-11) El timeline del cliente NO tiene FK con
    // borrado en cascada: sin esto quedaban eventos huérfanos (fantasmas en el
    // historial y referencias a un cliente inexistente). Misma transacción:
    // o se borra todo, o nada.
    await db.$transaction([
      db.timelineEvent.deleteMany({ where: { clientId: client.id, organizationId: auth.orgId } }),
      db.client.delete({ where: { id: client.id } }),
    ])
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'client',
      entityId: id,
      details: { name: client.name },
    })
    return json({ success: true })
  })
}
