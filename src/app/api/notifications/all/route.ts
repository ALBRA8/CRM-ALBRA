import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { handle, json } from '../../_lib/shared'

/** DELETE /api/notifications/all — borra todas las notificaciones de la organización. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    // (fusión B-RBAC) borrar TODAS las notificaciones de la org es operación
    // administrativa: exige la capacidad 'notifications.manage' (un agent NO puede).
    const auth = await requirePermission(req, 'notifications.manage')
    const result = await db.notification.deleteMany({ where: { organizationId: auth.orgId } })
    return json({ success: true, deleted: result.count })
  })
}
