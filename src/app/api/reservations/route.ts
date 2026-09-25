import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline, parseIntParam } from '@/lib/api-helpers'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { handle, json, readBody, requireFields, str, dateOrNull, numOrNull, qparam } from '../_lib/shared'
import { buildResMeta, serializeReservation } from '../_lib/reservations'

/** GET /api/reservations — filtros: upcoming, clientId, startDate, endDate, status. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const upcoming = qparam(req, 'upcoming')
    const clientId = qparam(req, 'clientId')
    const status = qparam(req, 'status')
    const startDate = qparam(req, 'startDate')
    const endDate = qparam(req, 'endDate')
    const limit = parseIntParam(req, 'limit', 100, 1, 500)

    const now = new Date()
    const startsAt: { gte?: Date; lt?: Date; } = {}
    if (upcoming) startsAt.gte = now
    if (startDate) startsAt.gte = new Date(`${startDate}T00:00:00`)
    if (endDate) startsAt.lt = new Date(new Date(`${endDate}T00:00:00`).getTime() + 86_400_000)

    const where = {
      organizationId: auth.orgId,
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
      ...(upcoming ? { status: { not: 'cancelled' } } : {}),
      ...(Object.keys(startsAt).length > 0 ? { startsAt } : {}),
    }

    const reservations = await db.reservation.findMany({
      where,
      orderBy: { startsAt: upcoming || startDate ? 'asc' : 'desc' },
      take: limit,
      include: { client: { select: { id: true, name: true, email: true, phone: true, address: true } } },
    })

    return json({ reservations: reservations.map(serializeReservation) })
  })
}

/** POST /api/reservations — { clientId?, title, serviceType?, date, duration?, location?, notes? } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['title'])

    const startsAt = dateOrNull(body.date) ?? dateOrNull(body.startsAt)
    if (!startsAt) throw new HttpError(400, 'Fecha de la reserva inválida')

    const clientId = str(body.clientId)
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.orgId }, select: { id: true, name: true } })
      if (!client) throw new HttpError(400, 'Cliente no encontrado')
    }

    const duration = numOrNull(body.duration) ?? 60
    const endsAt = dateOrNull(body.endsAt) ?? new Date(startsAt.getTime() + duration * 60_000)

    const created = await db.reservation.create({
      data: {
        organizationId: auth.orgId,
        clientId: clientId || null,
        title: str(body.title) as string,
        description: buildResMeta(body),
        startsAt,
        endsAt,
        status: str(body.status) ?? 'confirmed',
        location: str(body.location),
        userId: auth.userId,
      },
      include: { client: { select: { id: true, name: true, email: true, phone: true, address: true } } },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'reservation',
      entityId: created.id,
      details: { name: created.title },
      clientId: created.clientId,
      reservationId: created.id,
      timelineType: 'meeting',
      timelineTitle: `Reserva: ${created.title}`,
      timelineDescription: created.location ?? undefined,
    })
    await runWorkflowsForTrigger({
      orgId: auth.orgId,
      type: 'reservation_created',
      payload: {
        reservationId: created.id,
        clientId: created.clientId,
        title: created.title,
        startsAt: created.startsAt.toISOString(),
        clientName: created.client?.name,
      },
    })

    return json({ reservation: serializeReservation(created) }, { status: 201 })
  })
}
