import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json, qparam } from '../_lib/shared'
import { describeActivity } from '../_lib/activity'
import { parseIntParam } from '@/lib/api-helpers'

/**
 * GET /api/activity — registro de auditoría paginado.
 * Acepta page o limit/offset, y filtros entity/action/entityId.
 * Responde { logs, activities, total }: `logs` lo usa el dashboard,
 * `activities` la página de actividad.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const limit = parseIntParam(req, 'limit', 50, 1, 200)
    const page = parseIntParam(req, 'page', 1)
    const offsetParam = qparam(req, 'offset')
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : (page - 1) * limit

    const entity = qparam(req, 'entity')
    const action = qparam(req, 'action')
    const entityId = qparam(req, 'entityId')

    const where = {
      organizationId: auth.orgId,
      ...(entity ? { entity } : {}),
      ...(action ? { action } : {}),
      ...(entityId ? { entityId } : {}),
    }

    const [total, logs] = await Promise.all([
      db.activityLog.count({ where }),
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ])

    const userIds = Array.from(new Set(logs.map((l) => l.userId).filter(Boolean))) as string[]
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : []
    const userMap = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]))

    const serialized = logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      description: describeActivity(log.action, log.entity, log.details),
      metadata: log.details,
      createdAt: log.createdAt,
      user: log.userId ? userMap.get(log.userId) ?? null : null,
    }))

    return json({ logs: serialized, activities: serialized, total })
  })
}
