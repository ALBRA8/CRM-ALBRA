import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, parseIntParam } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET /api/timeline?clientId=&opportunityId=&quoteId=&reservationId=&limit=
 * Timeline unificado por registro — consumido por el detalle de cliente/oportunidad.
 * Eventos: { id, type, title, description, source, metadata, createdAt } orden desc.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId') || undefined
    const opportunityId = url.searchParams.get('opportunityId') || undefined
    const quoteId = url.searchParams.get('quoteId') || undefined
    const reservationId = url.searchParams.get('reservationId') || undefined
    const type = url.searchParams.get('type') || undefined
    const limit = parseIntParam(req, 'limit', 50, 1, 200)

    const events = await db.timelineEvent.findMany({
      where: {
        organizationId: auth.orgId,
        ...(clientId ? { clientId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        ...(quoteId ? { quoteId } : {}),
        ...(reservationId ? { reservationId } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        clientId: true,
        opportunityId: true,
        quoteId: true,
        reservationId: true,
        type: true,
        title: true,
        description: true,
        metadata: true,
        source: true,
        userId: true,
        createdAt: true,
      },
    })

    return json({ events })
  })
}
