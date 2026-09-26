import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../../_lib/shared'

/** DELETE /api/notifications/all — borra todas las notificaciones de la organización. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const result = await db.notification.deleteMany({ where: { organizationId: auth.orgId } })
    return json({ success: true, deleted: result.count })
  })
}
