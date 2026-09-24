import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, parseIntParam } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET /api/instagram/conversations — conversaciones derivadas del timeline
 * (TimelineEvent type="instagram" agrupado por cliente). Shape consistente con
 * el inbox de WhatsApp: { conversations: [{ id, contactId, contactName, lastMessage, lastMessageAt, unreadCount, isAutoReply }] }
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const limit = parseIntParam(req, 'limit', 50, 1, 200)

    const events = await db.timelineEvent.findMany({
      where: { organizationId: auth.orgId, type: 'instagram' },
      orderBy: { createdAt: 'desc' },
      take: limit * 10,
    })

    const clientIds = [...new Set(events.map((e) => e.clientId).filter((v): v is string => !!v))]
    const clients = clientIds.length
      ? await db.client.findMany({
          where: { organizationId: auth.orgId, id: { in: clientIds } },
          select: { id: true, name: true, phone: true },
        })
      : []
    const clientById = new Map(clients.map((c) => [c.id, c]))

    const conversations = clientIds.slice(0, limit).map((clientId) => {
      const clientEvents = events.filter((e) => e.clientId === clientId)
      const last = clientEvents[0]
      const client = clientById.get(clientId)
      const unread = clientEvents.filter((e) => {
        try {
          const meta = e.metadata ? (JSON.parse(e.metadata) as Record<string, unknown>) : {}
          return meta.direction === 'in' && !meta.readAt
        } catch {
          return false
        }
      }).length
      const lastMeta = (() => {
        try {
          return last?.metadata ? (JSON.parse(last.metadata) as Record<string, unknown>) : {}
        } catch {
          return {}
        }
      })()
      return {
        id: clientId,
        contactId: (lastMeta.senderId as string) || client?.phone || clientId,
        contactName: client?.name || 'Contacto Instagram',
        lastMessage: last?.description || last?.title || '',
        lastMessageAt: last?.createdAt?.toISOString() || null,
        lastMessageFrom: (lastMeta.direction as string) || 'in',
        unreadCount: unread,
        isAutoReply: clientEvents.some((e) => e.source === 'agent'),
        clientId,
      }
    })

    return json({ conversations })
  })
}
