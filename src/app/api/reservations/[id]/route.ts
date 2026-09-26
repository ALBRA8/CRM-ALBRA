import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str, dateOrNull, numOrNull } from '../../_lib/shared'
import { buildResMeta, parseResMeta, serializeReservation } from '../../_lib/reservations'

/** PUT /api/reservations/:id — actualización parcial (estado, fecha, duración, etc.). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.reservation.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) throw new HttpError(404, 'Reserva no encontrada')
    const body = await readBody(req)

    const data: Record<string, unknown> = {}
    if ('title' in body) data.title = str(body.title) ?? existing.title
    if ('status' in body) data.status = str(body.status) ?? existing.status
    if ('location' in body) data.location = str(body.location)
    if ('description' in body || 'serviceType' in body || 'notes' in body) {
      data.description = buildResMeta(body, parseResMeta(existing.description))
    }
    if ('clientId' in body) {
      const clientId = str(body.clientId)
      if (clientId) {
        const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.orgId }, select: { id: true } })
        if (!client) throw new HttpError(400, 'Cliente no encontrado')
      }
      data.clientId = clientId
    }

    // Fecha/duración: recalcula endsAt si cambia alguna
    const newStart = dateOrNull(body.date) ?? dateOrNull(body.startsAt)
    const newDuration = numOrNull(body.duration)
    if (newStart) {
      const durationMins = newDuration ?? Math.max(1, Math.round(((existing.endsAt?.getTime() ?? existing.startsAt.getTime()) - existing.startsAt.getTime()) / 60_000))
      data.startsAt = newStart
      data.endsAt = new Date(newStart.getTime() + durationMins * 60_000)
    } else if (newDuration !== null) {
      data.endsAt = new Date(existing.startsAt.getTime() + newDuration * 60_000)
    }
    if ('endsAt' in body) data.endsAt = dateOrNull(body.endsAt)

    const updated = await db.reservation.update({
      where: { id },
      data,
      include: { client: { select: { id: true, name: true, email: true, phone: true, address: true } } },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'reservation',
      entityId: id,
      details: { name: updated.title, fields: Object.keys(body).slice(0, 10) },
      clientId: updated.clientId,
      reservationId: id,
      ...(data.status && data.status !== existing.status
        ? { timelineType: 'system', timelineTitle: `Reserva "${updated.title}" → ${String(data.status)}` }
        : {}),
    })

    return json({ reservation: serializeReservation(updated) })
  })
}

/** DELETE /api/reservations/:id — cancela la reserva (status=cancelled). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.reservation.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) throw new HttpError(404, 'Reserva no encontrada')

    const updated = await db.reservation.update({
      where: { id },
      data: { status: 'cancelled' },
      include: { client: { select: { id: true, name: true, email: true, phone: true, address: true } } },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'reservation',
      entityId: id,
      details: { name: existing.title, cancelled: true },
      clientId: updated.clientId,
    })
    return json({ success: true, reservation: serializeReservation(updated) })
  })
}
