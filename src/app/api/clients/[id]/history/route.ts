import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, requireFields, str, numOrNull } from '../../../_lib/shared'

/**
 * Historial de servicios del cliente (ClientHistory) anclado además al timeline.
 * `amount`/`notes` del frontend se guardan como envelope JSON en `description`.
 */

interface HistoryEntry {
  id: string
  serviceType: string
  type: string
  title: string
  description: string
  amount: number | null
  date: Date
  notes: string | null
}

function serialize(h: { id: string; type: string; title: string; description: string | null; createdAt: Date }): HistoryEntry {
  let text = h.description
  let amount: number | null = null
  let notes: string | null = null
  try {
    const parsed = h.description ? (JSON.parse(h.description) as Record<string, unknown>) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      text = typeof parsed.text === 'string' ? parsed.text : null
      amount = typeof parsed.amount === 'number' ? parsed.amount : null
      notes = typeof parsed.notes === 'string' ? parsed.notes : null
    }
  } catch {
    // description era texto plano
  }
  return {
    id: h.id,
    serviceType: h.type,
    type: h.type,
    title: h.title,
    description: text ?? '',
    amount,
    date: h.createdAt,
    notes,
  }
}

/** GET /api/clients/:id/history */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const client = await db.client.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
    if (!client) throw new HttpError(404, 'Cliente no encontrado')

    const rows = await db.clientHistory.findMany({
      where: { clientId: id, organizationId: auth.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return json({ history: rows.map(serialize) })
  })
}

/** POST /api/clients/:id/history — { serviceType, description, amount?, notes? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const client = await db.client.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, name: true } })
    if (!client) throw new HttpError(404, 'Cliente no encontrado')

    const body = await readBody(req)
    requireFields(body, ['description'])
    const serviceType = str(body.serviceType) ?? str(body.type) ?? 'note'
    const description = str(body.description) as string
    const amount = numOrNull(body.amount)
    const notes = str(body.notes)

    const created = await db.clientHistory.create({
      data: {
        organizationId: auth.orgId,
        clientId: id,
        type: serviceType,
        title: description.slice(0, 120),
        description: JSON.stringify({ text: description, amount, notes }),
        userId: auth.userId,
      },
    })

    const timelineType = serviceType === 'call' ? 'call' : 'note'
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'note_added',
      entity: 'client',
      entityId: id,
      details: { name: client.name, serviceType },
      clientId: id,
      timelineType,
      timelineTitle: description.slice(0, 120),
      timelineDescription: amount !== null ? `${description} — Monto: ${amount}` : description,
    })

    return json({ history: serialize(created) }, { status: 201 })
  })
}
