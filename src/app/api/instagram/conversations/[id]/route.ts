import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, parseIntParam } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET /api/instagram/conversations/:id — historial de una conversación (id = clientId).
 * Respuesta: { conversation: { id, contactId, contactName, messages: [...] } }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const limit = parseIntParam(req, 'limit', 100, 1, 300)

    const client = await db.client.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, name: true, phone: true },
    })
    if (!client) return json({ error: 'Conversación no encontrada' }, { status: 404 })

    const events = await db.timelineEvent.findMany({
      where: { organizationId: auth.orgId, type: 'instagram', clientId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const messages = events.reverse().map((e) => {
      let meta: Record<string, unknown> = {}
      try {
        meta = e.metadata ? (JSON.parse(e.metadata) as Record<string, unknown>) : {}
      } catch {
        meta = {}
      }
      return {
        id: e.id,
        text: e.description || e.title,
        direction: (meta.direction as string) || (e.source === 'agent' ? 'out' : 'in'),
        senderType: e.source === 'agent' ? 'ai' : meta.direction === 'out' ? 'user' : 'contact',
        isRead: !!meta.readAt,
        createdAt: e.createdAt.toISOString(),
        metadata: e.metadata,
      }
    })

    const lastMeta = (() => {
      try {
        return messages.length && messages[messages.length - 1].metadata
          ? (JSON.parse(messages[messages.length - 1].metadata as string) as Record<string, unknown>)
          : {}
      } catch {
        return {}
      }
    })()

    return json({
      conversation: {
        id: client.id,
        contactId: (lastMeta.senderId as string) || client.phone || client.id,
        contactName: client.name,
        messages,
      },
    })
  })
}

/** PUT /api/instagram/conversations/:id — marca la conversación como leída (metadata.readAt) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const client = await db.client.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
    if (!client) return json({ error: 'Conversación no encontrada' }, { status: 404 })

    const incoming = await db.timelineEvent.findMany({
      where: { organizationId: auth.orgId, type: 'instagram', clientId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    let marked = 0
    for (const event of incoming) {
      let meta: Record<string, unknown> = {}
      if (event.metadata) {
        try {
          meta = JSON.parse(event.metadata) as Record<string, unknown>
        } catch {
          meta = {}
        }
      }
      if (meta.direction === 'in' && !meta.readAt) {
        meta.readAt = new Date().toISOString()
        await db.timelineEvent.update({ where: { id: event.id }, data: { metadata: JSON.stringify(meta) } })
        marked++
      }
    }
    return json({ success: true, marked })
  })
}
