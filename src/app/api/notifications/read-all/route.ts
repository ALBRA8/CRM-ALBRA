import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../../_lib/shared'

/** PUT /api/notifications/read-all — marca todas las de la organización como leídas. */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const result = await db.notification.updateMany({
      where: { organizationId: auth.orgId, isRead: false },
      data: { isRead: true },
    })
    return json({ success: true, updated: result.count })
  })
}
