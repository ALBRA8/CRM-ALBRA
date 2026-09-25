import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str, qparam } from '../_lib/shared'

/** GET /api/notifications — últimas 50 + contador de no leídas. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const limit = Math.min(parseInt(qparam(req, 'limit') ?? '50', 10) || 50, 200)
    const [notifications, unread] = await Promise.all([
      db.notification.findMany({
        where: { organizationId: auth.orgId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.notification.count({ where: { organizationId: auth.orgId, isRead: false } }),
    ])

    return json({
      notifications: notifications.map((n) => {
        const data = n.data ? (JSON.parse(n.data) as Record<string, unknown>) : null
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.body,
          body: n.body,
          link: data && typeof data.link === 'string' ? data.link : null,
          data: n.data,
          isRead: n.isRead,
          createdAt: n.createdAt,
        }
      }),
      unreadCount: unread,
    })
  })
}

/** POST /api/notifications — crea una notificación interna. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    if (!str(body.title)) {
      return json({ error: 'El título es requerido' }, { status: 400 })
    }
    const created = await db.notification.create({
      data: {
        organizationId: auth.orgId,
        userId: str(body.userId),
        type: str(body.type) ?? 'system',
        title: str(body.title) as string,
        body: str(body.message) ?? str(body.body),
        data: body.data ? JSON.stringify(body.data) : undefined,
      },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'notification',
      entityId: created.id,
      details: { name: created.title },
    })
    return json({ notification: { ...created, message: created.body, link: null } }, { status: 201 })
  })
}
