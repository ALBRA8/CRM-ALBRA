import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * POST /api/push/unsubscribe — elimina la suscripción push por endpoint.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { endpoint?: string }
    requireFields(body as unknown as Record<string, unknown>, ['endpoint'])

    const deleted = await db.notification.deleteMany({
      where: {
        organizationId: auth.orgId,
        type: 'push_subscription',
        OR: [{ userId: auth.userId }, { userId: null }],
        data: { contains: body.endpoint },
      },
    })
    return json({ success: true, removed: deleted.count })
  })
}
